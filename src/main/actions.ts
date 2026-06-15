import { create, fromJsonString, toJson } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  SendTextRequestSchema,
  InjectRequestSchema,
  ActivateRequestSchema,
  ActivateRequest_AppSchema,
  MenuItemRequestSchema,
  MenuItemResponse_Status,
  InvokeFunctionRequestSchema,
  InvokeFunctionResponse_Status,
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
  PreferencesRequestSchema,
  ColorPresetRequestSchema,
  ColorPresetResponse_Status,
  SetProfilePropertyRequestSchema,
  SetProfilePropertyResponse_Status,
  type ServerOriginatedMessage,
  type ActivateRequest,
  type InvokeFunctionRequest,
  type CloseRequest,
  type ColorPresetResponse_GetPreset_ColorSetting,
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

// What an extractPayload tells fire about a transport-delivered response: the payload to surface, and
// whether — though no 'error' submessage came back — the response carries an action-level refusal.
// [LAW:single-enforcer] fire is the one seam that maps a refusal to ok:false, so 'ok' means the same
// thing for every action: the action actually happened. The alternative (each action re-checking the
// status after fire returns) is the same invariant enforced at every callsite, and the two actions
// that forgot to check reported iTerm2's refusals as success.
interface Extraction {
  payload: Record<string, unknown> | null;
  refusal: string | null;
}

// A response on the wrong submessage arm carries no status to trust, so the action's outcome is
// unknown — itself a refusal. The expected/got message matches what the read paths report.
function wrongArm(expected: string, got: string | undefined): Extraction {
  return { payload: null, refusal: `expected ${expected}, got ${got ?? '<none>'}` };
}

// [LAW:one-source-of-truth] One verdict for every status-bearing response: OK is success, anything
// else is a refusal rendered the one house way. The enum table and its OK member vary per response;
// the verdict does not.
function statusRefusal(status: number, okStatus: number, name: Record<number, string>): string | null {
  return status === okStatus ? null : `iTerm2 refused: ${name[status] ?? status}`;
}

async function fire(
  orchestrator: ConnectionOrchestrator,
  envelope: Envelope,
  extractPayload: (msg: ServerOriginatedMessage) => Extraction = () => ({
    payload: null,
    refusal: null,
  }),
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
    const { payload, refusal } = extractPayload(response);
    const responseCase = response.submessage.case ?? null;
    return {
      ok: refusal === null,
      error: refusal,
      latencyMs,
      responseCase,
      payload,
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
      if (msg.submessage.case !== 'menuItemResponse') return wrongArm('menuItemResponse', msg.submessage.case);
      const r = msg.submessage.value;
      // queryOnly asks iTerm2 to report a menu item's state without activating it, so a non-OK status
      // (DISABLED, BAD_IDENTIFIER) is legitimate query data, not a refusal. An activating invoke that
      // comes back non-OK never ran the item — that is a refusal, not a success with a status field.
      const refusal =
        args.queryOnly ?? false
          ? null
          : statusRefusal(r.status, MenuItemResponse_Status.OK, MenuItemResponse_Status);
      return {
        payload: { status: String(r.status), checked: r.checked, enabled: r.enabled },
        refusal,
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
      if (msg.submessage.case !== 'invokeFunctionResponse')
        return wrongArm('invokeFunctionResponse', msg.submessage.case);
      const disposition = msg.submessage.value.disposition;
      if (disposition.case === 'success') {
        return { payload: { success: true, jsonResult: disposition.value.jsonResult }, refusal: null };
      }
      // An error disposition (TIMEOUT, FAILED, REQUEST_MALFORMED, INVALID_ID) means the invocation
      // failed; the success:false payload is the detail, but the action did not happen — ok is false.
      if (disposition.case === 'error') {
        const status = disposition.value.status;
        return {
          payload: {
            success: false,
            status: String(status),
            message: disposition.value.errorReason,
          },
          refusal: `iTerm2 refused: ${InvokeFunctionResponse_Status[status] ?? status}`,
        };
      }
      return wrongArm('invokeFunctionResponse disposition', disposition.case);
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
  // [LAW:no-silent-failure] Transport success is not action success: a response that never carried a
  // savedArrangementResponse has no status to trust, and a refusal status (arrangement or window not
  // found, malformed request) is a failed action, not a success with fine print.
  return fire(
    orchestrator,
    { submessage: { case: 'savedArrangementRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'savedArrangementResponse')
        return wrongArm('savedArrangementResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      return {
        payload: { status: SavedArrangementResponse_Status[status] ?? String(status) },
        refusal: statusRefusal(status, SavedArrangementResponse_Status.OK, SavedArrangementResponse_Status),
      };
    },
  );
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
  // [LAW:no-silent-failure] Transport success is not action success: no setBroadcastDomainsResponse
  // means no status to trust, and a refusal status (session not found, domains not disjoint, sessions
  // spanning windows) is a failed action, not a success with fine print.
  return fire(
    orchestrator,
    { submessage: { case: 'setBroadcastDomainsRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'setBroadcastDomainsResponse')
        return wrongArm('setBroadcastDomainsResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      return {
        payload: { status: SetBroadcastDomainsResponse_Status[status] ?? String(status) },
        refusal: statusRefusal(status, SetBroadcastDomainsResponse_Status.OK, SetBroadcastDomainsResponse_Status),
      };
    },
  );
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
    payload: { responseJson: JSON.stringify(toJson(ServerOriginatedMessageSchema, msg), null, 2) },
    refusal: null,
  }));
}

export async function actionGetSelection(
  orchestrator: ConnectionOrchestrator,
  args: { sessionId: string },
): Promise<ActionResult> {
  const value = create(SelectionRequestSchema, {
    request: { case: 'getSelectionRequest', value: { sessionId: args.sessionId } },
  });
  // [LAW:no-silent-failure] non-OK status is a failed action, not ok-with-fine-print.
  return fire(
    orchestrator,
    { submessage: { case: 'selectionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'selectionResponse') return wrongArm('selectionResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      const resp = msg.submessage.value.response;
      const selectionJson =
        resp.case === 'getSelectionResponse' && resp.value.selection
          ? JSON.stringify(toJson(SelectionSchema, resp.value.selection), null, 2)
          : null;
      return {
        payload: {
          status: SelectionResponse_Status[status] ?? String(status),
          ...(selectionJson != null ? { selectionJson } : {}),
        },
        refusal: statusRefusal(status, SelectionResponse_Status.OK, SelectionResponse_Status),
      };
    },
  );
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
  return fire(
    orchestrator,
    { submessage: { case: 'selectionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'selectionResponse') return wrongArm('selectionResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      return {
        payload: { status: SelectionResponse_Status[status] ?? String(status) },
        refusal: statusRefusal(status, SelectionResponse_Status.OK, SelectionResponse_Status),
      };
    },
  );
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
  return fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return wrongArm('tmuxResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      const p = msg.submessage.value.payload;
      return {
        payload: {
          status: TmuxResponse_Status[status] ?? String(status),
          ...(p.case === 'sendCommand' ? { output: p.value.output } : {}),
        },
        refusal: statusRefusal(status, TmuxResponse_Status.OK, TmuxResponse_Status),
      };
    },
  );
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
  return fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return wrongArm('tmuxResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      const p = msg.submessage.value.payload;
      return {
        payload: {
          status: TmuxResponse_Status[status] ?? String(status),
          ...(p.case === 'createWindow' ? { tabId: p.value.tabId } : {}),
        },
        refusal: statusRefusal(status, TmuxResponse_Status.OK, TmuxResponse_Status),
      };
    },
  );
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
  return fire(
    orchestrator,
    { submessage: { case: 'tmuxRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'tmuxResponse') return wrongArm('tmuxResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      return {
        payload: { status: TmuxResponse_Status[status] ?? String(status) },
        refusal: statusRefusal(status, TmuxResponse_Status.OK, TmuxResponse_Status),
      };
    },
  );
}

export async function actionTransaction(
  orchestrator: ConnectionOrchestrator,
  args: { op: TransactionOp },
): Promise<ActionResult> {
  const value = create(TransactionRequestSchema, { begin: args.op === 'begin' });
  return fire(
    orchestrator,
    { submessage: { case: 'transactionRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'transactionResponse')
        return wrongArm('transactionResponse', msg.submessage.case);
      const status = msg.submessage.value.status;
      return {
        payload: { status: TransactionResponse_Status[status] ?? String(status) },
        refusal: statusRefusal(status, TransactionResponse_Status.OK, TransactionResponse_Status),
      };
    },
  );
}

// Raw preference-key inspection: the read arm of PreferencesRequest. iTerm2's Settings edits known
// preferences through controls but never exposes a raw key's stored JSON — this does. The wire batches
// requests; a single key is one request, and results[0] is its result. [LAW:no-silent-failure] an empty
// jsonValue alongside a getPreferenceResult is the honest "no value set" for that key, not a failure;
// a response that is not a preferencesResponse, or whose first result is the wrong arm (an unrecognized
// request), is a failed read.
export async function actionGetPreference(
  orchestrator: ConnectionOrchestrator,
  args: { key: string },
): Promise<ActionResult> {
  if (!args.key) {
    return {
      ok: false,
      error: 'preference key required',
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  const value = create(PreferencesRequestSchema, {
    requests: [{ request: { case: 'getPreferenceRequest', value: { key: args.key } } }],
  });
  return fire(
    orchestrator,
    { submessage: { case: 'preferencesRequest', value } },
    (msg) => {
      if (msg.submessage.case !== 'preferencesResponse')
        return wrongArm('preferencesResponse', msg.submessage.case);
      const first = msg.submessage.value.results[0];
      if (first?.result.case === 'getPreferenceResult') {
        return { payload: { key: args.key, jsonValue: first.result.value.jsonValue }, refusal: null };
      }
      // A wrong result arm (an unrecognized request) is a failed read. The refusal carries no payload,
      // the invariant every other structural-failure path in this file keeps.
      return {
        payload: null,
        refusal: `iTerm2 returned ${first?.result.case ?? 'no results'} for a getPreference request`,
      };
    },
  );
}

// [LAW:one-source-of-truth] iTerm2 encodes a profile color as this plist dict (NSColor components);
// it is the same shape the RPC color-knob default uses. The apply round-trips exactly the components
// getPreset returned, so the written color is the preset's color, not a re-derived one.
function colorAssignmentJson(cs: ColorPresetResponse_GetPreset_ColorSetting): string {
  return JSON.stringify({
    'Red Component': cs.red,
    'Green Component': cs.green,
    'Blue Component': cs.blue,
    'Alpha Component': cs.alpha,
    'Color Space': cs.colorSpace || 'sRGB',
  });
}

// Bulk color-preset application: the capability iTerm2 has no native UI for — applying one preset to
// many profiles at once via the API. It is two wire arms in sequence, never fused into one: getPreset
// (read the preset's colors) then SetProfilePropertyRequest (write them to a guid list as color
// assignments). [LAW:no-silent-failure] each step's refusal stops the action — a refused or empty
// preset read never proceeds to a half-applied write, and a refused write is a failed action. The
// recorded requestId is the mutation's (the write is the action's effect on the wire); a failed read
// reports the read's id so the spine still joins to the frame it produced.
export async function actionApplyColorPreset(
  orchestrator: ConnectionOrchestrator,
  args: { presetName: string; guids: string[] },
): Promise<ActionResult> {
  const guids = args.guids.filter(Boolean);
  const failNoWire = (error: string): ActionResult => ({
    ok: false,
    error,
    latencyMs: 0,
    responseCase: null,
    payload: null,
    requestId: null,
  });
  if (!args.presetName) return failNoWire('color preset name required');
  if (guids.length === 0) return failNoWire('at least one profile guid required');

  const started = Date.now();
  const failWire = (error: string, responseCase: string | null, requestId: string | null): ActionResult => ({
    ok: false,
    error,
    latencyMs: Date.now() - started,
    responseCase,
    payload: null,
    requestId,
  });
  try {
    const presetReq = create(ColorPresetRequestSchema, {
      request: { case: 'getPreset', value: { name: args.presetName } },
    });
    const presetResp = await orchestrator.sendRequest({
      submessage: { case: 'colorPresetRequest', value: presetReq },
    });
    if (presetResp.submessage.case === 'error') {
      return failWire(presetResp.submessage.value, 'error', presetResp.id.toString());
    }
    if (presetResp.submessage.case !== 'colorPresetResponse') {
      return failWire(
        `expected colorPresetResponse, got ${presetResp.submessage.case ?? '<none>'}`,
        presetResp.submessage.case ?? null,
        presetResp.id.toString(),
      );
    }
    const preset = presetResp.submessage.value;
    if (preset.status !== ColorPresetResponse_Status.OK) {
      return failWire(
        `iTerm2 refused color preset read: ${ColorPresetResponse_Status[preset.status] ?? preset.status}`,
        'colorPresetResponse',
        presetResp.id.toString(),
      );
    }
    if (preset.response.case !== 'getPreset') {
      return failWire(
        `expected getPreset payload, got ${preset.response.case ?? '<none>'}`,
        'colorPresetResponse',
        presetResp.id.toString(),
      );
    }
    const colorSettings = preset.response.value.colorSettings;
    if (colorSettings.length === 0) {
      return failWire(
        `color preset '${args.presetName}' has no color settings`,
        'colorPresetResponse',
        presetResp.id.toString(),
      );
    }

    const setReq = create(SetProfilePropertyRequestSchema, {
      target: { case: 'guidList', value: { guids } },
      assignments: colorSettings.map((cs) => ({ key: cs.key, jsonValue: colorAssignmentJson(cs) })),
    });
    const setResp = await orchestrator.sendRequest({
      submessage: { case: 'setProfilePropertyRequest', value: setReq },
    });
    const latencyMs = Date.now() - started;
    const requestId = setResp.id.toString();
    if (setResp.submessage.case === 'error') {
      return { ok: false, error: setResp.submessage.value, latencyMs, responseCase: 'error', payload: null, requestId };
    }
    if (setResp.submessage.case !== 'setProfilePropertyResponse') {
      return {
        ok: false,
        error: `expected setProfilePropertyResponse, got ${setResp.submessage.case ?? '<none>'}`,
        latencyMs,
        responseCase: setResp.submessage.case ?? null,
        payload: null,
        requestId,
      };
    }
    const status = setResp.submessage.value.status;
    if (status !== SetProfilePropertyResponse_Status.OK) {
      return {
        ok: false,
        error: `iTerm2 refused: ${SetProfilePropertyResponse_Status[status] ?? status}`,
        latencyMs,
        responseCase: 'setProfilePropertyResponse',
        payload: null,
        requestId,
      };
    }
    return {
      ok: true,
      error: null,
      latencyMs,
      responseCase: 'setProfilePropertyResponse',
      payload: { presetName: args.presetName, profileCount: guids.length, colorCount: colorSettings.length },
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
