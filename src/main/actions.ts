import { create, fromJsonString, toJson } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  SendTextRequestSchema,
  InjectRequestSchema,
  ActivateRequestSchema,
  ActivateRequest_AppSchema,
  MenuItemRequestSchema,
  InvokeFunctionRequestSchema,
  InvokeFunctionRequest_AppSchema,
  InvokeFunctionRequest_SessionSchema,
  InvokeFunctionRequest_TabSchema,
  InvokeFunctionRequest_WindowSchema,
  RestartSessionRequestSchema,
  CloseRequestSchema,
  CloseRequest_CloseSessionsSchema,
  CloseRequest_CloseTabsSchema,
  CloseRequest_CloseWindowsSchema,
  SavedArrangementRequestSchema,
  SavedArrangementRequest_Action,
  SavedArrangementResponse_Status,
  BroadcastDomainSchema,
  SetBroadcastDomainsRequestSchema,
  SetBroadcastDomainsResponse_Status,
  SelectionRequestSchema,
  SelectionSchema,
  SelectionResponse_Status,
  TransactionRequestSchema,
  TransactionResponse_Status,
  TmuxRequestSchema,
  TmuxResponse_Status,
  type ServerOriginatedMessage,
  type ActivateRequest,
  type InvokeFunctionRequest,
  type CloseRequest,
} from '@shared/proto/gen/api_pb';
import type {
  ActionResult,
  ActivateTarget,
  ArrangementOp,
  CloseTargetKind,
  InvokeScope,
  TransactionOp,
} from '@shared/rpc';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

type Envelope = Parameters<ConnectionOrchestrator['sendRequest']>[0];

async function fire(
  orchestrator: ConnectionOrchestrator,
  envelope: Envelope,
  extractPayload: (msg: ServerOriginatedMessage) => Record<string, unknown> | null = () => null,
): Promise<ActionResult> {
  const started = Date.now();
  try {
    const response = await orchestrator.sendRequest(envelope);
    const latencyMs = Date.now() - started;
    // The response echoes the request's protocol id — the foreign key joining this action to the
    // request/response wire frames it produced.
    const requestId = response.id.toString();
    if (response.submessage.case === 'error') {
      return {
        ok: false,
        error: response.submessage.value,
        latencyMs,
        responseCase: 'error',
        payload: null,
        requestId,
      };
    }
    return {
      ok: true,
      error: null,
      latencyMs,
      responseCase: response.submessage.case ?? null,
      payload: extractPayload(response),
      requestId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
}

export async function actionSendText(
  orchestrator: ConnectionOrchestrator,
  args: { sessionId: string; text: string; suppressBroadcast?: boolean },
): Promise<ActionResult> {
  const value = create(SendTextRequestSchema, {
    session: args.sessionId,
    text: args.text,
    suppressBroadcast: args.suppressBroadcast ?? false,
  });
  return fire(orchestrator, {
    submessage: { case: 'sendTextRequest', value },
  });
}

export async function actionInject(
  orchestrator: ConnectionOrchestrator,
  args: { sessionIds: string[]; bytesHex: string },
): Promise<ActionResult> {
  const clean = args.bytesHex.replace(/\s+/g, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(clean)) {
    return {
      ok: false,
      error: `invalid hex: ${clean.slice(0, 24)}…`,
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  const data = new Uint8Array(clean.length / 2);
  for (let i = 0; i < data.length; i++) {
    data[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const value = create(InjectRequestSchema, {
    sessionId: args.sessionIds,
    data,
  });
  return fire(orchestrator, {
    submessage: { case: 'injectRequest', value },
  });
}

export async function actionActivate(
  orchestrator: ConnectionOrchestrator,
  args: {
    target: ActivateTarget;
    orderWindowFront?: boolean;
    selectSession?: boolean;
    selectTab?: boolean;
    activateApp?: boolean;
  },
): Promise<ActionResult> {
  let identifier: ActivateRequest['identifier'];
  switch (args.target.kind) {
    case 'window':
      identifier = { case: 'windowId', value: args.target.id };
      break;
    case 'tab':
      identifier = { case: 'tabId', value: args.target.id };
      break;
    case 'session':
      identifier = { case: 'sessionId', value: args.target.id };
      break;
    case 'app':
      identifier = { case: undefined };
      break;
  }
  const value = create(ActivateRequestSchema, {
    identifier,
    orderWindowFront: args.orderWindowFront ?? false,
    selectSession: args.selectSession ?? false,
    selectTab: args.selectTab ?? false,
    activateApp: args.activateApp
      ? create(ActivateRequest_AppSchema, {
          raiseAllWindows: true,
          ignoringOtherApps: false,
        })
      : undefined,
  });
  return fire(orchestrator, {
    submessage: { case: 'activateRequest', value },
  });
}

export async function actionMenuItem(
  orchestrator: ConnectionOrchestrator,
  args: { identifier: string; queryOnly?: boolean },
): Promise<ActionResult> {
  const value = create(MenuItemRequestSchema, {
    identifier: args.identifier,
    queryOnly: args.queryOnly ?? false,
  });
  return fire(
    orchestrator,
    { submessage: { case: 'menuItemRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'menuItemResponse') return null;
      const r = msg.submessage.value;
      return {
        status: String(r.status),
        checked: r.checked,
        enabled: r.enabled,
      };
    },
  );
}

export async function actionInvokeFunction(
  orchestrator: ConnectionOrchestrator,
  args: { invocation: string; scope: InvokeScope; timeout?: number },
): Promise<ActionResult> {
  let context: InvokeFunctionRequest['context'];
  switch (args.scope.kind) {
    case 'app':
      context = { case: 'app', value: create(InvokeFunctionRequest_AppSchema, {}) };
      break;
    case 'session':
      context = {
        case: 'session',
        value: create(InvokeFunctionRequest_SessionSchema, { sessionId: args.scope.id }),
      };
      break;
    case 'tab':
      context = {
        case: 'tab',
        value: create(InvokeFunctionRequest_TabSchema, { tabId: args.scope.id }),
      };
      break;
    case 'window':
      context = {
        case: 'window',
        value: create(InvokeFunctionRequest_WindowSchema, { windowId: args.scope.id }),
      };
      break;
  }
  const value = create(InvokeFunctionRequestSchema, {
    invocation: args.invocation,
    context,
    timeout: args.timeout ?? 0,
  });
  return fire(
    orchestrator,
    { submessage: { case: 'invokeFunctionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'invokeFunctionResponse') return null;
      const disposition = msg.submessage.value.disposition;
      if (disposition.case === 'success') {
        return { success: true, jsonResult: disposition.value.jsonResult };
      }
      if (disposition.case === 'error') {
        return {
          success: false,
          status: String(disposition.value.status),
          message: disposition.value.errorReason,
        };
      }
      return null;
    },
  );
}

export async function actionRestartSession(
  orchestrator: ConnectionOrchestrator,
  args: { sessionId: string; onlyIfExited?: boolean },
): Promise<ActionResult> {
  const value = create(RestartSessionRequestSchema, {
    sessionId: args.sessionId,
    onlyIfExited: args.onlyIfExited ?? false,
  });
  return fire(orchestrator, {
    submessage: { case: 'restartSessionRequest', value },
  });
}

export async function actionClose(
  orchestrator: ConnectionOrchestrator,
  args: { kind: CloseTargetKind; ids: string[]; force?: boolean },
): Promise<ActionResult> {
  let target: CloseRequest['target'];
  switch (args.kind) {
    case 'sessions':
      target = {
        case: 'sessions',
        value: create(CloseRequest_CloseSessionsSchema, { sessionIds: args.ids }),
      };
      break;
    case 'tabs':
      target = {
        case: 'tabs',
        value: create(CloseRequest_CloseTabsSchema, { tabIds: args.ids }),
      };
      break;
    case 'windows':
      target = {
        case: 'windows',
        value: create(CloseRequest_CloseWindowsSchema, { windowIds: args.ids }),
      };
      break;
  }
  const value = create(CloseRequestSchema, {
    target,
    force: args.force ?? false,
  });
  return fire(orchestrator, {
    submessage: { case: 'closeRequest', value },
  });
}

const ARRANGEMENT_OP_TO_WIRE: Record<ArrangementOp, SavedArrangementRequest_Action> = {
  save: SavedArrangementRequest_Action.SAVE,
  restore: SavedArrangementRequest_Action.RESTORE,
};

export async function actionSavedArrangement(
  orchestrator: ConnectionOrchestrator,
  args: { op: ArrangementOp; name: string; windowId?: string },
): Promise<ActionResult> {
  if (!args.name) {
    return {
      ok: false,
      error: 'arrangement name required',
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  const value = create(SavedArrangementRequestSchema, {
    name: args.name,
    action: ARRANGEMENT_OP_TO_WIRE[args.op],
    ...(args.windowId ? { windowId: args.windowId } : {}),
  });
  let wireStatus: SavedArrangementResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'savedArrangementRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'savedArrangementResponse') return null;
      wireStatus = msg.submessage.value.status;
      return { status: SavedArrangementResponse_Status[wireStatus] ?? String(wireStatus) };
    },
  );
  if (!result.ok) return result;
  // [LAW:no-silent-failure] Transport success is not action success: a response that never carried
  // a savedArrangementResponse has no status to trust, and a refusal status (arrangement or window
  // not found, malformed request) is a failed action, not a success with fine print. The check
  // compares the wire enum value itself, same encoding the LIST read uses.
  if (wireStatus === null) {
    return {
      ...result,
      ok: false,
      error: `expected savedArrangementResponse, got ${result.responseCase ?? '<none>'}`,
    };
  }
  if (wireStatus !== SavedArrangementResponse_Status.OK) {
    return {
      ...result,
      ok: false,
      error: `iTerm2 refused: ${SavedArrangementResponse_Status[wireStatus] ?? wireStatus}`,
    };
  }
  return result;
}

export async function actionSetBroadcastDomains(
  orchestrator: ConnectionOrchestrator,
  args: { domains: string[][] },
): Promise<ActionResult> {
  // An empty table is a legal value (it clears all broadcasting); an empty *domain* is not a
  // statement the wire models, so it is rejected here before it can confuse the engine.
  if (args.domains.some((domain) => domain.length === 0)) {
    return {
      ok: false,
      error: 'every domain must contain at least one session id',
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  const value = create(SetBroadcastDomainsRequestSchema, {
    broadcastDomains: args.domains.map((sessionIds) =>
      create(BroadcastDomainSchema, { sessionIds }),
    ),
  });
  let wireStatus: SetBroadcastDomainsResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'setBroadcastDomainsRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'setBroadcastDomainsResponse') return null;
      wireStatus = msg.submessage.value.status;
      return { status: SetBroadcastDomainsResponse_Status[wireStatus] ?? String(wireStatus) };
    },
  );
  if (!result.ok) return result;
  // [LAW:no-silent-failure] Transport success is not action success: no setBroadcastDomainsResponse
  // means no status to trust, and a refusal status (session not found, domains not disjoint,
  // sessions spanning windows) is a failed action, not a success with fine print.
  if (wireStatus === null) {
    return {
      ...result,
      ok: false,
      error: `expected setBroadcastDomainsResponse, got ${result.responseCase ?? '<none>'}`,
    };
  }
  if (wireStatus !== SetBroadcastDomainsResponse_Status.OK) {
    return {
      ...result,
      ok: false,
      error: `iTerm2 refused: ${SetBroadcastDomainsResponse_Status[wireStatus] ?? wireStatus}`,
    };
  }
  return result;
}

export async function actionRawProtobuf(
  orchestrator: ConnectionOrchestrator,
  args: { envelopeJson: string },
): Promise<ActionResult> {
  let envelope: Envelope;
  try {
    const parsed = fromJsonString(ClientOriginatedMessageSchema, args.envelopeJson);
    if (parsed.submessage.case === undefined) {
      return {
        ok: false,
        error: 'envelope is missing a submessage',
        latencyMs: 0,
        responseCase: null,
        payload: null,
        requestId: null,
      };
    }
    envelope = { submessage: parsed.submessage };
  } catch (err) {
    // The envelope parse is the only phase unique to raw-protobuf; on parse failure there is no
    // request, so no requestId.
    return {
      ok: false,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  // [LAW:single-enforcer] The send/response/error/latency/requestId handling is `fire`'s job; this
  // action only differs in how it renders the response payload, which is exactly what extractPayload is.
  return fire(orchestrator, envelope, (msg) => ({
    responseJson: JSON.stringify(toJson(ServerOriginatedMessageSchema, msg), null, 2),
  }));
}

export async function actionGetSelection(
  orchestrator: ConnectionOrchestrator,
  args: { sessionId: string },
): Promise<ActionResult> {
  const value = create(SelectionRequestSchema, {
    request: { case: 'getSelectionRequest', value: { sessionId: args.sessionId } },
  });
  let wireStatus: SelectionResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'selectionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'selectionResponse') return null;
      wireStatus = msg.submessage.value.status;
      const resp = msg.submessage.value.response;
      const selectionJson =
        resp.case === 'getSelectionResponse' && resp.value.selection
          ? JSON.stringify(toJson(SelectionSchema, resp.value.selection), null, 2)
          : null;
      return {
        status: SelectionResponse_Status[wireStatus] ?? String(wireStatus),
        ...(selectionJson != null ? { selectionJson } : {}),
      };
    },
  );
  if (!result.ok) return result;
  if (wireStatus === null) {
    return {
      ...result,
      ok: false,
      error: `expected selectionResponse, got ${result.responseCase ?? '<none>'}`,
    };
  }
  // [LAW:no-silent-failure] non-OK status is a failed action, not ok-with-fine-print.
  if (wireStatus !== SelectionResponse_Status.OK) {
    return {
      ...result,
      ok: false,
      error: `iTerm2 refused: ${SelectionResponse_Status[wireStatus] ?? wireStatus}`,
    };
  }
  return result;
}

export async function actionSetSelection(
  orchestrator: ConnectionOrchestrator,
  args: { sessionId: string; selectionJson: string },
): Promise<ActionResult> {
  let selection;
  try {
    selection = fromJsonString(SelectionSchema, args.selectionJson || '{}');
  } catch (err) {
    return {
      ok: false,
      error: `invalid selection JSON: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  const value = create(SelectionRequestSchema, {
    request: {
      case: 'setSelectionRequest',
      value: { sessionId: args.sessionId, selection },
    },
  });
  let wireStatus: SelectionResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'selectionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'selectionResponse') return null;
      wireStatus = msg.submessage.value.status;
      return { status: SelectionResponse_Status[wireStatus] ?? String(wireStatus) };
    },
  );
  if (!result.ok) return result;
  if (wireStatus === null) {
    return {
      ...result,
      ok: false,
      error: `expected selectionResponse, got ${result.responseCase ?? '<none>'}`,
    };
  }
  if (wireStatus !== SelectionResponse_Status.OK) {
    return {
      ...result,
      ok: false,
      error: `iTerm2 refused: ${SelectionResponse_Status[wireStatus] ?? wireStatus}`,
    };
  }
  return result;
}

// [LAW:single-enforcer] One place that decides whether a tmux round-trip succeeded: a response that
// never carried a tmuxResponse has no status to trust, and any non-OK status (invalid request,
// connection, or window) is a failed action, not a success with fine print ([LAW:no-silent-failure]).
// Returns the error string, or null when the action genuinely succeeded.
function tmuxStatusError(
  wireStatus: TmuxResponse_Status | null,
  responseCase: string | null,
): string | null {
  if (wireStatus === null) return `expected tmuxResponse, got ${responseCase ?? '<none>'}`;
  if (wireStatus !== TmuxResponse_Status.OK) {
    return `iTerm2 refused: ${TmuxResponse_Status[wireStatus] ?? wireStatus}`;
  }
  return null;
}

export async function actionTmuxSendCommand(
  orchestrator: ConnectionOrchestrator,
  args: { connectionId: string; command: string },
): Promise<ActionResult> {
  const value = create(TmuxRequestSchema, {
    payload: {
      case: 'sendCommand',
      value: { connectionId: args.connectionId, command: args.command },
    },
  });
  let wireStatus: TmuxResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return null;
      wireStatus = msg.submessage.value.status;
      const p = msg.submessage.value.payload;
      return {
        status: TmuxResponse_Status[wireStatus] ?? String(wireStatus),
        ...(p.case === 'sendCommand' ? { output: p.value.output } : {}),
      };
    },
  );
  if (!result.ok) return result;
  const error = tmuxStatusError(wireStatus, result.responseCase);
  return error === null ? result : { ...result, ok: false, error };
}

export async function actionTmuxCreateWindow(
  orchestrator: ConnectionOrchestrator,
  args: { connectionId: string; affinity: string },
): Promise<ActionResult> {
  const value = create(TmuxRequestSchema, {
    payload: {
      case: 'createWindow',
      value: { connectionId: args.connectionId, affinity: args.affinity },
    },
  });
  let wireStatus: TmuxResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return null;
      wireStatus = msg.submessage.value.status;
      const p = msg.submessage.value.payload;
      return {
        status: TmuxResponse_Status[wireStatus] ?? String(wireStatus),
        ...(p.case === 'createWindow' ? { tabId: p.value.tabId } : {}),
      };
    },
  );
  if (!result.ok) return result;
  const error = tmuxStatusError(wireStatus, result.responseCase);
  return error === null ? result : { ...result, ok: false, error };
}

export async function actionTmuxSetWindowVisible(
  orchestrator: ConnectionOrchestrator,
  args: { connectionId: string; windowId: string; visible: boolean },
): Promise<ActionResult> {
  const value = create(TmuxRequestSchema, {
    payload: {
      case: 'setWindowVisible',
      value: {
        connectionId: args.connectionId,
        windowId: args.windowId,
        visible: args.visible,
      },
    },
  });
  let wireStatus: TmuxResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return null;
      wireStatus = msg.submessage.value.status;
      return { status: TmuxResponse_Status[wireStatus] ?? String(wireStatus) };
    },
  );
  if (!result.ok) return result;
  const error = tmuxStatusError(wireStatus, result.responseCase);
  return error === null ? result : { ...result, ok: false, error };
}

export async function actionTransaction(
  orchestrator: ConnectionOrchestrator,
  args: { op: TransactionOp },
): Promise<ActionResult> {
  const value = create(TransactionRequestSchema, { begin: args.op === 'begin' });
  let wireStatus: TransactionResponse_Status | null = null;
  const result = await fire(
    orchestrator,
    { submessage: { case: 'transactionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'transactionResponse') return null;
      wireStatus = msg.submessage.value.status;
      return { status: TransactionResponse_Status[wireStatus] ?? String(wireStatus) };
    },
  );
  if (!result.ok) return result;
  if (wireStatus === null) {
    return {
      ...result,
      ok: false,
      error: `expected transactionResponse, got ${result.responseCase ?? '<none>'}`,
    };
  }
  if (wireStatus !== TransactionResponse_Status.OK) {
    return {
      ...result,
      ok: false,
      error: `iTerm2 refused: ${TransactionResponse_Status[wireStatus] ?? wireStatus}`,
    };
  }
  return result;
}
