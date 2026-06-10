import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { create, fromBinary } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  ListSessionsRequestSchema,
  NotificationRequestSchema,
  VariableRequestSchema,
  GetBufferRequestSchema,
  LineRangeSchema,
  RPCRegistrationRequestSchema,
  RPCRegistrationRequest_RPCArgumentSignatureSchema,
  RPCRegistrationRequest_RPCArgumentSchema,
  RPCRegistrationRequest_StatusBarComponentAttributesSchema,
  RPCRegistrationRequest_StatusBarComponentAttributes_KnobSchema,
  RPCRegistrationRequest_SessionTitleAttributesSchema,
  RPCRegistrationRequest_ContextMenuAttributesSchema,
  ServerOriginatedRPCResultRequestSchema,
  InvokeFunctionRequestSchema,
  InvokeFunctionRequest_AppSchema,
  InvokeFunctionRequest_SessionSchema,
  InvokeFunctionRequest_TabSchema,
  InvokeFunctionRequest_WindowSchema,
  InvokeFunctionResponse_Status,
  NotificationType,
  VariableScope,
  VariableResponse_Status,
  PromptMonitorMode,
  RPCRegistrationRequest_Role,
  RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type,
  RPCRegistrationRequest_StatusBarComponentAttributes_Format,
  type ServerOriginatedMessage,
  type Notification,
  type InvokeFunctionRequest,
} from '@shared/proto/gen/api_pb';
import {
  convertLayout,
  convertGetBuffer,
  classifyNotification,
  variableScopeName,
} from '@shared/converters';
import { AppleScriptDriver, AppleScriptError } from './AppleScriptDriver';
import {
  ProtocolDriver,
  ProtocolError,
  type WireFrame,
  type ProtocolNotification,
} from './ProtocolDriver';
import type { ConnectionStore } from '../stores/ConnectionStore';
import type { LayoutStore } from '../stores/LayoutStore';
import type { VariableStore } from '../stores/VariableStore';
import type { WatchlistStore } from '../stores/WatchlistStore';
import { AppEventLog } from '../stores/AppEventLog';
import type { ScreenStreamStore } from '../stores/ScreenStreamStore';
import type {
  RegistrationStore,
  RegistrationSpec,
} from '../stores/RegistrationStore';
import type { CustomEscapeStore } from '../stores/CustomEscapeStore';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppProbeResult,
  type AppInvocationPayload,
} from '@shared/domain';
import {
  normalizeProbeTarget,
  describeVariableStatus,
  buildProbeEvalInvocation,
  PROBE_EVAL_FUNCTION,
  PROBE_EVAL_ARG,
} from '../probe';

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

const SCREEN_COALESCE_MS = 16;

// Seconds iTerm2 waits for probe_eval to answer before failing the invocation. The handler echoes
// the already-interpolated value immediately, so this only bounds a stalled connection.
const PROBE_EVAL_TIMEOUT = 5;

export interface OrchestratorOptions {
  advisoryName: string;
  libraryVersion: string;
  socketPath?: string;
}

export interface MonitorStores {
  layout: LayoutStore;
  variables: VariableStore;
  watchlist: WatchlistStore;
  appEvents: AppEventLog;
  screen: ScreenStreamStore;
  registrations: RegistrationStore;
  customEscape: CustomEscapeStore;
}

export class ConnectionOrchestrator extends EventEmitter {
  private readonly applescript = new AppleScriptDriver();
  private readonly protocol = new ProtocolDriver();
  private readonly options: Required<OrchestratorOptions>;
  private credentials: { cookie: string; key: string } | null = null;
  private activeGlobalSubscriptions: NotificationType[] = [];
  private activeVariableSubs: Array<{ name: string; sessionId: string }> = [];
  private sessionScopedSubscriptions: Array<{
    type: NotificationType;
    sessionId: string;
  }> = [];
  private screenCoalesceTimer: NodeJS.Timeout | null = null;
  private screenFetchPending = false;
  // [LAW:no-ambient-temporal-coupling] Single owner of the probe_eval registration lifecycle: the
  // in-flight (or settled) registration promise for this connection. Template probes await it so the
  // function is registered exactly once before the first invoke; it is nulled on close so the next
  // connection re-registers, and on failure so a later probe retries.
  private probeRegistration: Promise<void> | null = null;

  constructor(
    private readonly store: ConnectionStore,
    private readonly monitor: MonitorStores,
    options: OrchestratorOptions,
  ) {
    super();
    this.options = {
      socketPath: DEFAULT_SOCKET_PATH,
      ...options,
    };
    this.store.advisoryName = this.options.advisoryName;
    this.store.setSocket(this.options.socketPath, existsSync(this.options.socketPath));
    this.monitor.variables.setLiveNames(this.monitor.watchlist.names());

    this.protocol.on('frame', (frame: WireFrame) => {
      this.store.recordFrame();
      // [LAW:one-source-of-truth] The wire frame is one AppEvent in the spine, decoded once here at
      // the boundary; the wire pane is a projection of these, not a separate ring.
      const decoded = decodeWireFrame(frame.direction, frame.bytes);
      this.monitor.appEvents.append({
        kind: 'wire-frame',
        at: frame.at,
        frameSeq: frame.frameSeq,
        entity: APP_ENTITY,
        causedBy: null,
        payload: {
          direction: frame.direction,
          size: frame.bytes.byteLength,
          messageKind: decoded.messageKind,
          requestId: decoded.requestId,
        },
      });
      this.emit('frame', frame);
    });
    this.protocol.on('notification', ({ notification: n, frameSeq }: ProtocolNotification) => {
      const classified = classifyNotification(n);
      // [LAW:no-ambient-temporal-coupling] The notification carries the frameSeq of the frame it was
      // decoded from, so it joins to that wire frame (and any resulting variable change) by foreign
      // key, never by timestamp window or emit order.
      const notifEvent = this.monitor.appEvents.append({
        kind: 'notification',
        at: Date.now(),
        frameSeq,
        entity: notificationEntity(classified.sessionId),
        causedBy: null,
        payload: {
          kind: classified.kind,
          sessionId: classified.sessionId,
          summary: classified.summary,
          detail: classified.payload,
        },
      });
      // A server-originated RPC invocation (handled inside routeNotification) is the effect of THIS
      // notification, so it links back to it via causedBy — the spine's one honest seq-pointer
      // causal edge. The notification's seq travels as a value, not a timestamp guess.
      this.routeNotification(n, frameSeq, notifEvent.seq);
      this.emit('notification', { notification: n, frameSeq });
    });
    this.protocol.on('state', () =>
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion()),
    );
    this.protocol.on('close', ({ code, reason }) => {
      this.monitor.layout.clear();
      this.monitor.variables.clearAll();
      this.monitor.appEvents.clear();
      this.monitor.screen.clear();
      this.monitor.registrations.clearAll();
      this.monitor.customEscape.clearAll();
      this.probeRegistration = null;
      this.activeGlobalSubscriptions = [];
      this.activeVariableSubs = [];
      this.sessionScopedSubscriptions = [];
      this.cancelScreenCoalesce();
      this.emit('close', { code, reason });
    });
    this.protocol.on('error', (err) => {
      this.store.setError(errString(err));
      this.emit('error', err);
    });
  }

  async connect(): Promise<void> {
    try {
      this.store.setState('detecting');
      const exists = existsSync(this.options.socketPath);
      this.store.setSocket(this.options.socketPath, exists);
      if (!exists) {
        throw new ProtocolError(
          `iTerm2 private socket not found at ${this.options.socketPath}. Is iTerm2 running?`,
        );
      }

      this.store.setState('requesting-cookie');
      this.store.noteCookieRequested();
      this.credentials = await this.applescript.requestCookieAndKey(
        this.options.advisoryName,
      );

      this.store.setState('connecting');
      await this.protocol.connect({
        socketPath: this.options.socketPath,
        advisoryName: this.options.advisoryName,
        libraryVersion: this.options.libraryVersion,
        cookie: this.credentials.cookie,
        key: this.credentials.key,
      });
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion());

      await this.refreshLayout();
      await this.subscribeGlobalNotifications();
    } catch (err) {
      this.store.setError(errString(err));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelScreenCoalesce();
    await this.protocol.disconnect();
    this.credentials = null;
  }

  async sendRequest(
    msg: Parameters<ProtocolDriver['send']>[0],
  ): Promise<ServerOriginatedMessage> {
    const started = Date.now();
    // External callers (actions, workbench, ipc) want only the decoded message; the frame identity
    // is internal provenance used by the variable dump path, so it is unwrapped here.
    const { message } = await this.protocol.send(msg);
    this.store.setLatency(Date.now() - started);
    return message;
  }

  async setFocusedSession(sessionId: string | null): Promise<void> {
    const prevSession = this.monitor.variables.focusedSessionId;
    if (prevSession === sessionId) return;

    await this.tearDownSessionSubscriptions(prevSession);
    this.monitor.variables.setFocused(sessionId);
    this.monitor.screen.setFocused(sessionId);

    if (!sessionId || this.protocol.getState() !== 'ready') return;

    try {
      const { dict, frameSeq } = await this.fetchAllVariablesForSession(sessionId);
      this.monitor.variables.applyDump(sessionVariableEntity(sessionId), dict, frameSeq);
    } catch (err) {
      this.emit('error', err);
    }

    await this.reconcileWatchSubscriptions(sessionId);

    await this.subscribeSessionScoped(sessionId);
    await this.fetchScreenBuffer(sessionId).catch(() => void 0);
  }

  async setFocusedVariables(entity: AppEntityRef): Promise<void> {
    this.monitor.variables.setFocusedEntity(entity);
    if (this.protocol.getState() !== 'ready') return;

    try {
      const { dict, frameSeq } = await this.fetchAllVariablesForEntity(entity);
      this.monitor.variables.applyDump(entity, dict, frameSeq);
    } catch (err) {
      this.emit('error', err);
    }
  }

  // [LAW:composability] Resolve one variable path against any entity scope and return a
  // self-describing result. Sibling of fetchAllVariablesForEntity (get:['*']); both flow through the
  // single variableRequestScope enforcer. The result IS the error surface — there is no fire-and-
  // forget path here, so a bad scope or path comes back as an `error` outcome the caller renders in
  // context, not an emit('error') the user has to correlate. [LAW:no-silent-failure]
  async probeVariable(entity: AppEntityRef, expression: string): Promise<AppProbeResult> {
    const target = normalizeProbeTarget(expression);
    if (target.kind === 'reject') {
      return { outcome: 'error', entity, expression, message: target.reject };
    }
    if (this.protocol.getState() !== 'ready') {
      return { outcome: 'error', entity, expression, message: 'Not connected to iTerm2.' };
    }
    // [LAW:dataflow-not-control-flow] Dispatch on the target's shape, decided once in the pure
    // normalizer: a single path resolves exactly; a template round-trips through probe_eval.
    return target.kind === 'path'
      ? this.probeVariablePath(entity, expression, target.path)
      : this.probeInterpolatedTemplate(entity, expression, target.template);
  }

  private async probeVariablePath(
    entity: AppEntityRef,
    expression: string,
    path: string,
  ): Promise<AppProbeResult> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(entity),
      get: [path],
    });
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'variableRequest' as const, value: req },
      });
      if (response.submessage.case === 'error') {
        return { outcome: 'error', entity, expression, message: response.submessage.value };
      }
      if (response.submessage.case !== 'variableResponse') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected response: ${response.submessage.case ?? '<none>'}`,
        };
      }
      const variableResponse = response.submessage.value;
      if (variableResponse.status !== VariableResponse_Status.OK) {
        return {
          outcome: 'error',
          entity,
          expression,
          message: describeVariableStatus(variableResponse.status),
        };
      }
      // iTerm2 encodes an unset variable as the JSON string "null"; surface it verbatim.
      return { outcome: 'value', entity, expression, value: variableResponse.values[0] ?? 'null' };
    } catch (err) {
      return { outcome: 'error', entity, expression, message: errString(err) };
    }
  }

  // Evaluate a full interpolated template through the registered probe_eval round-trip: iTerm2 has
  // no interpolated-string eval message, so we invoke probe_eval passing the template as an
  // interpolated argument. iTerm2 interpolates it against the focused scope, calls our handler with
  // the evaluated value (handleServerRpc echoes it back), and that value returns here as the
  // invocation's jsonResult. [LAW:no-ambient-temporal-coupling] The nested server RPC resolves while
  // this invoke is pending — they correlate by message identity, never by ordering or timing.
  private async probeInterpolatedTemplate(
    entity: AppEntityRef,
    expression: string,
    template: string,
  ): Promise<AppProbeResult> {
    try {
      await this.ensureProbeFunctionRegistered();
    } catch (err) {
      return {
        outcome: 'error',
        entity,
        expression,
        message: `Could not register the probe function: ${errString(err)}`,
      };
    }
    const req = create(InvokeFunctionRequestSchema, {
      invocation: buildProbeEvalInvocation(template),
      context: invokeFunctionContext(entity),
      timeout: PROBE_EVAL_TIMEOUT,
    });
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'invokeFunctionRequest' as const, value: req },
      });
      if (response.submessage.case === 'error') {
        return { outcome: 'error', entity, expression, message: response.submessage.value };
      }
      if (response.submessage.case !== 'invokeFunctionResponse') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected response: ${response.submessage.case ?? '<none>'}`,
        };
      }
      const disposition = response.submessage.value.disposition;
      if (disposition.case === 'error') {
        // [LAW:no-silent-failure] An invalid template (bad path, malformed call, wrong scope) comes
        // back as a named iTerm2 error reason, surfaced verbatim so the user can fix the expression.
        return {
          outcome: 'error',
          entity,
          expression,
          message:
            disposition.value.errorReason ||
            `Invocation failed (${InvokeFunctionResponse_Status[disposition.value.status]}).`,
        };
      }
      if (disposition.case !== 'success') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected invocation disposition: ${disposition.case ?? '<none>'}`,
        };
      }
      // The evaluated template is the JSON-encoded value probe_eval received and echoed; surface it
      // verbatim, the same shape probeVariablePath returns for a single path.
      return { outcome: 'value', entity, expression, value: disposition.value.jsonResult };
    } catch (err) {
      return { outcome: 'error', entity, expression, message: errString(err) };
    }
  }

  // [LAW:no-ambient-temporal-coupling] Register the probe_eval passthrough exactly once per
  // connection. The cached promise is the single owner of that lifecycle: concurrent template probes
  // share one in-flight registration; a failure nulls it so a later probe retries; close() nulls it
  // so the next connection re-registers. This is NOT a user registration, so it never enters
  // RegistrationStore or the invocation spine. [LAW:decomposition]
  private ensureProbeFunctionRegistered(): Promise<void> {
    if (!this.probeRegistration) {
      this.probeRegistration = this.registerProbeFunction().catch((err) => {
        this.probeRegistration = null;
        throw err;
      });
    }
    return this.probeRegistration;
  }

  private async registerProbeFunction(): Promise<void> {
    const req = create(RPCRegistrationRequestSchema, {
      name: PROBE_EVAL_FUNCTION,
      arguments: [
        create(RPCRegistrationRequest_RPCArgumentSignatureSchema, { name: PROBE_EVAL_ARG }),
      ],
      timeout: PROBE_EVAL_TIMEOUT,
      role: RPCRegistrationRequest_Role.GENERIC,
    });
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      true,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    );
  }

  async setWatched(name: string, watched: boolean): Promise<void> {
    this.monitor.watchlist.setWatched(name, watched);
    // [LAW:one-source-of-truth] The watchlist is the authority for which paths are live; both the
    // derived `live` flag and the live subscriptions flow from it, so they cannot drift.
    this.monitor.variables.setLiveNames(this.monitor.watchlist.names());
    await this.reconcileWatchSubscriptions(this.monitor.variables.focusedSessionId);
  }

  getSocketPath(): string {
    return this.options.socketPath;
  }

  async registerRpc(spec: RegistrationSpec): Promise<void> {
    const req = buildRegistrationRequest(spec);
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      true,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    );
    this.monitor.registrations.upsert(spec);
  }

  async unregisterRpc(id: string): Promise<void> {
    const spec = this.monitor.registrations.list().find((r) => r.id === id);
    if (!spec) return;
    const req = buildRegistrationRequest({ ...spec });
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      false,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    ).catch(() => void 0);
    this.monitor.registrations.remove(id);
  }

  async subscribeCustomEscape(
    subscriptionId: string,
    sessionId: string,
    identity: string,
  ): Promise<void> {
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_CUSTOM_ESCAPE_SEQUENCE,
      sessionId,
      true,
    );
    this.monitor.customEscape.addSubscription({
      id: subscriptionId,
      sessionId,
      identity,
      createdAt: Date.now(),
    });
  }

  async unsubscribeCustomEscape(subscriptionId: string): Promise<void> {
    const snap = this.monitor.customEscape.snapshot();
    const sub = snap.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) return;
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_CUSTOM_ESCAPE_SEQUENCE,
      sub.sessionId,
      false,
    ).catch(() => void 0);
    this.monitor.customEscape.removeSubscription(subscriptionId);
  }

  async respondToServerRpc(
    requestId: string,
    jsonValue: string,
  ): Promise<void> {
    const req = create(ServerOriginatedRPCResultRequestSchema, {
      requestId,
      result: { case: 'jsonValue', value: jsonValue },
    });
    await this.protocol
      .send({ submessage: { case: 'serverOriginatedRpcResultRequest', value: req } })
      .catch((err) => this.emit('error', err));
  }

  async respondToServerRpcException(
    requestId: string,
    reason: string,
  ): Promise<void> {
    const req = create(ServerOriginatedRPCResultRequestSchema, {
      requestId,
      result: {
        case: 'jsonException',
        value: JSON.stringify({ reason }),
      },
    });
    await this.protocol
      .send({ submessage: { case: 'serverOriginatedRpcResultRequest', value: req } })
      .catch((err) => this.emit('error', err));
  }

  async refreshLayout(): Promise<void> {
    if (this.protocol.getState() !== 'ready') return;

    const { message: response } = await this.protocol.send({
      submessage: {
        case: 'listSessionsRequest' as const,
        value: create(ListSessionsRequestSchema, {}),
      },
    });
    if (response.submessage.case === 'listSessionsResponse') {
      this.monitor.layout.apply(convertLayout(response.submessage.value));
      return;
    }
    if (response.submessage.case === 'error') {
      throw new ProtocolError(response.submessage.value);
    }
  }

  private async subscribeGlobalNotifications(): Promise<void> {
    const types: NotificationType[] = [
      NotificationType.NOTIFY_ON_LAYOUT_CHANGE,
      NotificationType.NOTIFY_ON_NEW_SESSION,
      NotificationType.NOTIFY_ON_TERMINATE_SESSION,
      NotificationType.NOTIFY_ON_FOCUS_CHANGE,
      NotificationType.NOTIFY_ON_BROADCAST_CHANGE,
    ];
    for (const t of types) {
      await this.sendNotificationRequest(t, 'all', true).catch((err) => {
        this.emit('error', err);
      });
      this.activeGlobalSubscriptions.push(t);
    }
  }

  private async subscribeSessionScoped(sessionId: string): Promise<void> {
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_KEYSTROKE,
      sessionId,
      true,
      {
        arguments: {
          case: 'keystrokeMonitorRequest',
          value: {
            patternsToIgnore: [],
            advanced: false,
          },
        },
      },
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_KEYSTROKE,
      sessionId,
    });

    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_PROMPT,
      sessionId,
      true,
      {
        arguments: {
          case: 'promptMonitorRequest',
          value: {
            modes: [
              PromptMonitorMode.PROMPT,
              PromptMonitorMode.COMMAND_START,
              PromptMonitorMode.COMMAND_END,
            ],
          },
        },
      },
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_PROMPT,
      sessionId,
    });

    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_SCREEN_UPDATE,
      sessionId,
      true,
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_SCREEN_UPDATE,
      sessionId,
    });
  }

  private async tearDownSessionSubscriptions(prevSession: string | null): Promise<void> {
    if (this.protocol.getState() === 'ready') {
      for (const sub of this.activeVariableSubs) {
        await this.toggleVariableSubscription(sub.sessionId, sub.name, false).catch(
          () => void 0,
        );
      }
      for (const sub of this.sessionScopedSubscriptions) {
        await this.sendNotificationRequest(sub.type, sub.sessionId, false).catch(
          () => void 0,
        );
      }
    }
    this.activeVariableSubs = [];
    this.sessionScopedSubscriptions = [];
    this.cancelScreenCoalesce();
  }

  private async sendNotificationRequest(
    type: NotificationType,
    session: string,
    subscribe: boolean,
    args?: Parameters<typeof create<typeof NotificationRequestSchema>>[1],
  ): Promise<void> {
    await this.sendNotificationRequestRaw(type, session, subscribe, args);
  }

  private async sendNotificationRequestRaw(
    type: NotificationType,
    session: string,
    subscribe: boolean,
    args?: Parameters<typeof create<typeof NotificationRequestSchema>>[1],
  ): Promise<void> {
    const req = create(NotificationRequestSchema, {
      session,
      subscribe,
      notificationType: type,
      ...(args ?? {}),
    });
    const { message: response } = await this.protocol.send({
      submessage: { case: 'notificationRequest' as const, value: req },
    });
    if (response.submessage.case === 'error') {
      throw new ProtocolError(
        `subscribe(${NotificationType[type]}) failed: ${response.submessage.value}`,
      );
    }
  }

  // [LAW:no-ambient-temporal-coupling] Single owner of variable-subscription lifecycle. Idempotent:
  // diffs the watchlist (desired) against active subs for this session and applies the delta, so it
  // is safe to call on focus change and on every watchlist mutation regardless of ordering.
  private async reconcileWatchSubscriptions(sessionId: string | null): Promise<void> {
    if (!sessionId || this.protocol.getState() !== 'ready') return;
    const desired = new Set(this.monitor.watchlist.names());
    const sessionSubs = this.activeVariableSubs.filter((s) => s.sessionId === sessionId);
    // [LAW:one-source-of-truth] `active` tracks only confirmed-live subscriptions and is updated
    // solely from toggle outcomes, so a failed subscribe stays absent and is retried next reconcile
    // rather than being recorded as live and silently never updating.
    const active = new Set(sessionSubs.map((s) => s.name));
    const toAdd = [...desired].filter((name) => !active.has(name));
    const toRemove = sessionSubs.filter((s) => !desired.has(s.name));

    const added = await this.applyVariableToggles(sessionId, toAdd, true);
    added.forEach((name) => active.add(name));
    const removed = await this.applyVariableToggles(
      sessionId,
      toRemove.map((s) => s.name),
      false,
    );
    removed.forEach((name) => active.delete(name));

    this.activeVariableSubs = [
      ...this.activeVariableSubs.filter((s) => s.sessionId !== sessionId),
      ...[...active].map((name) => ({ name, sessionId })),
    ];
  }

  // [LAW:no-silent-failure] Surfaces every toggle failure via the same `error` channel as the
  // variable dump, and returns the names that actually toggled so the caller's tracker reflects
  // real protocol state instead of intent.
  private async applyVariableToggles(
    sessionId: string,
    names: readonly string[],
    subscribe: boolean,
  ): Promise<string[]> {
    const succeeded: string[] = [];
    for (const name of names) {
      try {
        await this.toggleVariableSubscription(sessionId, name, subscribe);
        succeeded.push(name);
      } catch (err) {
        this.emit('error', err);
      }
    }
    return succeeded;
  }

  private async toggleVariableSubscription(
    sessionId: string,
    name: string,
    subscribe: boolean,
  ): Promise<void> {
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_VARIABLE_CHANGE,
      '',
      subscribe,
      {
        arguments: {
          case: 'variableMonitorRequest',
          value: {
            name,
            scope: VariableScope.SESSION,
            identifier: sessionId,
          },
        },
      },
    );
  }

  private async fetchAllVariablesForSession(
    sessionId: string,
  ): Promise<VariableDump> {
    return this.fetchAllVariablesForEntity(sessionVariableEntity(sessionId));
  }

  // Returns the dict together with the frameSeq of the response frame, so the dump's variable-change
  // events can be attributed to the exact wire frame that carried them (a dump resolves to a frame
  // only — there is no notification — and that absence is the live-vs-dump distinction).
  private async fetchAllVariablesForEntity(
    entity: AppEntityRef,
  ): Promise<VariableDump> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(entity),
      get: ['*'],
    });
    const { message: response, frameSeq } = await this.protocol.send({
      submessage: { case: 'variableRequest' as const, value: req },
    });
    if (response.submessage.case !== 'variableResponse') return { dict: {}, frameSeq };
    const values = response.submessage.value.values;
    if (values.length === 0) return { dict: {}, frameSeq };
    try {
      return { dict: JSON.parse(values[0]) as Record<string, unknown>, frameSeq };
    } catch {
      return { dict: {}, frameSeq };
    }
  }

  private async fetchScreenBuffer(sessionId: string, incremental = false): Promise<void> {
    if (this.monitor.screen.buffer.sessionId !== sessionId) return;
    const lineRange = incremental
      ? create(LineRangeSchema, { screenContentsOnly: true })
      : create(LineRangeSchema, { trailingLines: 1000 });
    const req = create(GetBufferRequestSchema, {
      session: sessionId,
      lineRange,
      includeStyles: true,
    });
    this.monitor.screen.noteFetchStarted();
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'getBufferRequest' as const, value: req },
      });
      if (response.submessage.case === 'getBufferResponse') {
        const { lines, cursor } = convertGetBuffer(response.submessage.value);
        this.monitor.screen.applyBuffer(sessionId, lines, cursor);
      } else {
        this.monitor.screen.noteFetchFailed(
          response.submessage.case === 'error'
            ? response.submessage.value
            : `unexpected case ${response.submessage.case ?? '<none>'}`,
        );
      }
    } catch (err) {
      this.monitor.screen.noteFetchFailed((err as Error).message);
      this.emit('error', err);
    }
  }

  private scheduleScreenRefetch(sessionId: string): void {
    if (this.monitor.screen.buffer.sessionId !== sessionId) return;
    if (this.screenCoalesceTimer) return;
    this.screenCoalesceTimer = setTimeout(() => {
      this.screenCoalesceTimer = null;
      if (this.screenFetchPending) return;
      this.screenFetchPending = true;
      this.fetchScreenBuffer(sessionId, true)
        .catch(() => void 0)
        .finally(() => {
          this.screenFetchPending = false;
        });
    }, SCREEN_COALESCE_MS);
  }

  private cancelScreenCoalesce(): void {
    if (this.screenCoalesceTimer) {
      clearTimeout(this.screenCoalesceTimer);
      this.screenCoalesceTimer = null;
    }
    this.screenFetchPending = false;
  }

  private routeNotification(n: Notification, frameSeq: number, causeSeq: number): void {
    if (n.layoutChangedNotification?.listSessionsResponse) {
      this.monitor.layout.apply(convertLayout(n.layoutChangedNotification.listSessionsResponse));
    }
    if (n.variableChangedNotification) {
      const v = n.variableChangedNotification;
      if (v.identifier && v.name) {
        // [LAW:no-ambient-temporal-coupling] The change carries the notification's frameSeq, so it
        // joins to that notification and the wire frame that delivered it by foreign key.
        this.monitor.variables.applyChange(
          v.identifier,
          v.name,
          v.jsonNewValue ?? 'null',
          variableScopeName(v.scope),
          frameSeq,
        );
      }
    }
    if (n.terminateSessionNotification?.sessionId) {
      this.monitor.variables.clearSession(n.terminateSessionNotification.sessionId);
    }
    if (n.screenUpdateNotification) {
      const session = n.screenUpdateNotification.session;
      if (session && this.monitor.screen.buffer.sessionId === session) {
        this.scheduleScreenRefetch(session);
      }
    }
    if (n.customEscapeSequenceNotification) {
      this.monitor.customEscape.record(n.customEscapeSequenceNotification);
    }
    if (n.serverOriginatedRpcNotification?.rpc) {
      void this.handleServerRpc(
        n.serverOriginatedRpcNotification.requestId,
        n.serverOriginatedRpcNotification.rpc,
        frameSeq,
        causeSeq,
      );
    }
  }

  private async handleServerRpc(
    requestId: string,
    rpc: { name: string; arguments: Array<{ name: string; jsonValue: string }> },
    frameSeq: number,
    causeSeq: number,
  ): Promise<void> {
    if (rpc.name === PROBE_EVAL_FUNCTION) {
      // The probe round-trip: iTerm2 has already interpolated the template against the focused scope,
      // so the evaluated value IS the single argument. Echo it straight back as the result; it
      // returns to the waiting probe through the InvokeFunctionResponse. This is an internal probe
      // mechanism, not a user registration, so it never lands on the invocation spine.
      // [LAW:decomposition]
      await this.respondToServerRpc(requestId, rpc.arguments[0]?.jsonValue ?? 'null');
      return;
    }
    const spec = this.monitor.registrations.findByName(rpc.name);
    const args: Record<string, unknown> = {};
    for (const a of rpc.arguments) {
      try {
        args[a.name] = JSON.parse(a.jsonValue);
      } catch {
        args[a.name] = a.jsonValue;
      }
    }
    if (!spec) {
      const error = `no registration for name=${rpc.name}`;
      await this.respondToServerRpcException(requestId, error);
      this.appendInvocation(
        { rpcName: rpc.name, registrationId: '', requestId, args, responded: true, responseJson: '', error },
        frameSeq,
        causeSeq,
      );
      return;
    }
    try {
      JSON.parse(spec.responseTemplate);
      await this.respondToServerRpc(requestId, spec.responseTemplate);
      this.appendInvocation(
        {
          rpcName: rpc.name,
          registrationId: spec.id,
          requestId,
          args,
          responded: true,
          responseJson: spec.responseTemplate,
          error: null,
        },
        frameSeq,
        causeSeq,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.respondToServerRpcException(requestId, msg);
      this.appendInvocation(
        { rpcName: rpc.name, registrationId: spec.id, requestId, args, responded: true, responseJson: '', error: msg },
        frameSeq,
        causeSeq,
      );
    }
  }

  // [LAW:one-source-of-truth] An invocation is one event on the spine, carrying the frameSeq of the
  // notification frame it was decoded from and causedBy = that notification's seq. Server RPCs are
  // app-scoped registrations, so the invocation is app-scoped; its session context, when any, is
  // reachable by walking causedBy to the notification. The emit lets main re-broadcast the
  // registrations snapshot (whose invocation list is a projection of this spine).
  private appendInvocation(
    payload: AppInvocationPayload,
    frameSeq: number,
    causeSeq: number,
  ): void {
    this.monitor.appEvents.append({
      kind: 'invocation',
      at: Date.now(),
      frameSeq,
      entity: APP_ENTITY,
      causedBy: causeSeq,
      payload,
    });
    this.emit('invocation');
  }
}

function buildRegistrationRequest(spec: RegistrationSpec) {
  const roleMap = {
    generic: RPCRegistrationRequest_Role.GENERIC,
    'session-title': RPCRegistrationRequest_Role.SESSION_TITLE,
    'status-bar': RPCRegistrationRequest_Role.STATUS_BAR_COMPONENT,
    'context-menu': RPCRegistrationRequest_Role.CONTEXT_MENU,
  } as const;

  const roleAttrs = buildRoleAttrs(spec);

  return create(RPCRegistrationRequestSchema, {
    name: spec.name,
    arguments: spec.arguments.map((name) =>
      create(RPCRegistrationRequest_RPCArgumentSignatureSchema, { name }),
    ),
    defaults: spec.defaults.map((d) =>
      create(RPCRegistrationRequest_RPCArgumentSchema, { name: d.name, path: d.path }),
    ),
    timeout: spec.timeout,
    role: roleMap[spec.role],
    ...(roleAttrs ?? {}),
  });
}

type RegistrationRequestInit = Parameters<
  typeof create<typeof RPCRegistrationRequestSchema>
>[1];

function buildRoleAttrs(spec: RegistrationSpec): RegistrationRequestInit | undefined {
  if (spec.role === 'status-bar' && spec.statusBar) {
    const sb = spec.statusBar;
    const knobTypeMap = {
      Checkbox: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.Checkbox,
      String: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.String,
      PositiveFloatingPoint:
        RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.PositiveFloatingPoint,
      Color: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.Color,
    } as const;
    const value = create(
      RPCRegistrationRequest_StatusBarComponentAttributesSchema,
      {
        shortDescription: sb.shortDescription,
        detailedDescription: sb.detailedDescription,
        exemplar: sb.exemplar,
        updateCadence: sb.updateCadence,
        uniqueIdentifier: sb.uniqueIdentifier,
        format:
          sb.format === 'HTML'
            ? RPCRegistrationRequest_StatusBarComponentAttributes_Format.HTML
            : RPCRegistrationRequest_StatusBarComponentAttributes_Format.PLAIN_TEXT,
        knobs: sb.knobs.map((k) =>
          create(RPCRegistrationRequest_StatusBarComponentAttributes_KnobSchema, {
            name: k.name,
            type: knobTypeMap[k.type],
            placeholder: k.placeholder,
            jsonDefaultValue: k.jsonDefaultValue,
            key: k.key,
          }),
        ),
      },
    );
    return { RoleSpecificAttributes: { case: 'statusBarComponentAttributes', value } };
  }
  if (spec.role === 'session-title' && spec.sessionTitle) {
    const value = create(RPCRegistrationRequest_SessionTitleAttributesSchema, {
      displayName: spec.sessionTitle.displayName,
      uniqueIdentifier: spec.sessionTitle.uniqueIdentifier,
    });
    return { RoleSpecificAttributes: { case: 'sessionTitleAttributes', value } };
  }
  if (spec.role === 'context-menu' && spec.contextMenu) {
    const value = create(RPCRegistrationRequest_ContextMenuAttributesSchema, {
      displayName: spec.contextMenu.displayName,
      uniqueIdentifier: spec.contextMenu.uniqueIdentifier,
    });
    return { RoleSpecificAttributes: { case: 'contextMenuAttributes', value } };
  }
  return undefined;
}

interface VariableDump {
  dict: Record<string, unknown>;
  frameSeq: number;
}

// [LAW:one-source-of-truth] Decoded once, here at the boundary that owns the bytes — the wire pane
// reads messageKind/requestId off the stored event and never re-parses. Mirrors the decode the
// deleted WireLogStore did, now feeding the unified spine.
function decodeWireFrame(
  direction: 'out' | 'in',
  bytes: Uint8Array,
): { messageKind: string; requestId: string } {
  try {
    const schema = direction === 'out' ? ClientOriginatedMessageSchema : ServerOriginatedMessageSchema;
    const msg = fromBinary(schema, bytes);
    return { messageKind: msg.submessage.case ?? '(empty)', requestId: msg.id.toString() };
  } catch {
    return { messageKind: '(decode-failed)', requestId: '0' };
  }
}

// A notification's scope is whatever entity it names; sessionless notifications are app-scoped. This
// is best-effort scoping for the unified timeline, not a precise focus ref (window/tab are unknown
// from a session id alone).
function notificationEntity(sessionId: string | null): AppEntityRef {
  return sessionId ? sessionVariableEntity(sessionId) : APP_ENTITY;
}

function errString(err: unknown): string {
  if (err instanceof AppleScriptError || err instanceof ProtocolError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function variableRequestScope(entity: AppEntityRef):
  | { case: 'app'; value: boolean }
  | { case: 'windowId'; value: string }
  | { case: 'tabId'; value: string }
  | { case: 'sessionId'; value: string } {
  // [LAW:types-are-the-program] Variable focus and request scope share one discriminated entity shape.
  switch (entity.kind) {
    case 'app':
      return { case: 'app', value: true };
    case 'window':
      return { case: 'windowId', value: entity.windowId };
    case 'tab':
      return { case: 'tabId', value: entity.tabId };
    case 'session':
      return { case: 'sessionId', value: entity.sessionId };
  }
}

function invokeFunctionContext(entity: AppEntityRef): InvokeFunctionRequest['context'] {
  // [LAW:types-are-the-program] The same discriminated entity that scopes a VariableRequest scopes
  // the probe_eval invocation, so iTerm2 interpolates the template against the focused entity.
  switch (entity.kind) {
    case 'app':
      return { case: 'app', value: create(InvokeFunctionRequest_AppSchema, {}) };
    case 'window':
      return {
        case: 'window',
        value: create(InvokeFunctionRequest_WindowSchema, { windowId: entity.windowId }),
      };
    case 'tab':
      return {
        case: 'tab',
        value: create(InvokeFunctionRequest_TabSchema, { tabId: entity.tabId }),
      };
    case 'session':
      return {
        case: 'session',
        value: create(InvokeFunctionRequest_SessionSchema, { sessionId: entity.sessionId }),
      };
  }
}

function sessionVariableEntity(sessionId: string): AppEntityRef {
  // [LAW:single-enforcer] Session variable snapshots are keyed by protocol session identity.
  return {
    kind: 'session',
    windowId: '',
    tabId: '',
    sessionId,
  };
}
