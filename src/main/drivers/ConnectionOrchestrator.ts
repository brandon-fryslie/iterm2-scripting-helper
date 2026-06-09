import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { create } from '@bufbuild/protobuf';
import {
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
  NotificationType,
  VariableScope,
  PromptMonitorMode,
  RPCRegistrationRequest_Role,
  RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type,
  RPCRegistrationRequest_StatusBarComponentAttributes_Format,
  type ServerOriginatedMessage,
  type Notification,
} from '@shared/proto/gen/api_pb';
import {
  convertLayout,
  convertGetBuffer,
  convertKeystroke,
  convertPrompt,
  convertFocus,
  classifyNotification,
  variableScopeName,
} from '@shared/converters';
import { AppleScriptDriver, AppleScriptError } from './AppleScriptDriver';
import {
  ProtocolDriver,
  ProtocolError,
  type WireFrame,
} from './ProtocolDriver';
import type { ConnectionStore } from '../stores/ConnectionStore';
import type { LayoutStore } from '../stores/LayoutStore';
import type { VariableStore } from '../stores/VariableStore';
import type { WatchlistStore } from '../stores/WatchlistStore';
import type { WireLogStore } from '../stores/WireLogStore';
import type { NotificationHub } from '../stores/NotificationHub';
import type { KeystrokeLogStore } from '../stores/KeystrokeLogStore';
import type { PromptLogStore } from '../stores/PromptLogStore';
import type { FocusLogStore } from '../stores/FocusLogStore';
import type { ScreenStreamStore } from '../stores/ScreenStreamStore';
import type {
  RegistrationStore,
  RegistrationSpec,
} from '../stores/RegistrationStore';
import type { CustomEscapeStore } from '../stores/CustomEscapeStore';
import type { AppEntityRef } from '@shared/domain';

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

const SCREEN_COALESCE_MS = 16;

export interface OrchestratorOptions {
  advisoryName: string;
  libraryVersion: string;
  socketPath?: string;
}

export interface MonitorStores {
  layout: LayoutStore;
  variables: VariableStore;
  watchlist: WatchlistStore;
  wire: WireLogStore;
  notifications: NotificationHub;
  keystrokes: KeystrokeLogStore;
  prompts: PromptLogStore;
  focus: FocusLogStore;
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
      this.monitor.wire.recordFrame(frame.direction, frame.bytes, frame.at);
      this.emit('frame', frame);
    });
    this.protocol.on('notification', (n: Notification) => {
      const classified = classifyNotification(n);
      const entry = this.monitor.notifications.record(classified);
      this.routeNotification(n);
      this.emit('notification', { notification: n, entry });
    });
    this.protocol.on('state', () =>
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion()),
    );
    this.protocol.on('close', ({ code, reason }) => {
      this.monitor.layout.clear();
      this.monitor.variables.clearAll();
      this.monitor.wire.clear();
      this.monitor.notifications.clear();
      this.monitor.keystrokes.clear();
      this.monitor.prompts.clear();
      this.monitor.focus.clear();
      this.monitor.screen.clear();
      this.monitor.registrations.clearAll();
      this.monitor.customEscape.clearAll();
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
    const response = await this.protocol.send(msg);
    this.store.setLatency(Date.now() - started);
    return response;
  }

  async setFocusedSession(sessionId: string | null): Promise<void> {
    const prevSession = this.monitor.variables.focusedSessionId;
    if (prevSession === sessionId) return;

    await this.tearDownSessionSubscriptions(prevSession);
    this.monitor.variables.setFocused(sessionId);
    this.monitor.screen.setFocused(sessionId);

    if (!sessionId || this.protocol.getState() !== 'ready') return;

    try {
      const dump = await this.fetchAllVariablesForSession(sessionId);
      this.monitor.variables.applyDump(sessionVariableEntity(sessionId), dump);
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
      const dump = await this.fetchAllVariablesForEntity(entity);
      this.monitor.variables.applyDump(entity, dump);
    } catch (err) {
      this.emit('error', err);
    }
  }

  async setWatched(name: string, watched: boolean): Promise<void> {
    this.monitor.watchlist.setWatched(name, watched);
    // [LAW:one-source-of-truth] The watchlist is the authority for which paths are live; both the
    // derived `live` flag and the live subscriptions flow from it, so they cannot drift.
    this.monitor.variables.setLiveNames(this.monitor.watchlist.names());
    await this.reconcileWatchSubscriptions(this.monitor.variables.focusedSessionId);
  }

  async setKeystrokeAdvanced(advanced: boolean): Promise<void> {
    if (this.monitor.keystrokes.advanced === advanced) return;
    this.monitor.keystrokes.setAdvanced(advanced);
    const focused = this.monitor.variables.focusedSessionId;
    if (!focused || this.protocol.getState() !== 'ready') return;
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_KEYSTROKE,
      focused,
      false,
    ).catch(() => void 0);
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_KEYSTROKE,
      focused,
      true,
      {
        arguments: {
          case: 'keystrokeMonitorRequest',
          value: { patternsToIgnore: [], advanced },
        },
      },
    ).catch((err) => this.emit('error', err));
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
    const spec = this.monitor.registrations
      .snapshot()
      .registrations.find((r) => r.id === id);
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

    const response = await this.protocol.send({
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
            advanced: this.monitor.keystrokes.advanced,
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
    if (prevSession) {
      this.monitor.keystrokes.clear();
      this.monitor.prompts.clear();
    }
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
    const response = await this.protocol.send({
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
    const active = new Set(sessionSubs.map((s) => s.name));
    const toAdd = [...desired].filter((name) => !active.has(name));
    const toRemove = sessionSubs.filter((s) => !desired.has(s.name));

    for (const name of toAdd) {
      await this.toggleVariableSubscription(sessionId, name, true).catch(() => void 0);
    }
    for (const sub of toRemove) {
      await this.toggleVariableSubscription(sessionId, sub.name, false).catch(() => void 0);
    }

    this.activeVariableSubs = [
      ...this.activeVariableSubs.filter((s) => s.sessionId !== sessionId),
      ...[...desired].map((name) => ({ name, sessionId })),
    ];
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
  ): Promise<Record<string, unknown>> {
    return this.fetchAllVariablesForEntity(sessionVariableEntity(sessionId));
  }

  private async fetchAllVariablesForEntity(
    entity: AppEntityRef,
  ): Promise<Record<string, unknown>> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(entity),
      get: ['*'],
    });
    const response = await this.protocol.send({
      submessage: { case: 'variableRequest' as const, value: req },
    });
    if (response.submessage.case !== 'variableResponse') return {};
    const values = response.submessage.value.values;
    if (values.length === 0) return {};
    try {
      return JSON.parse(values[0]) as Record<string, unknown>;
    } catch {
      return {};
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
      const response = await this.protocol.send({
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

  private routeNotification(n: Notification): void {
    if (n.layoutChangedNotification?.listSessionsResponse) {
      this.monitor.layout.apply(convertLayout(n.layoutChangedNotification.listSessionsResponse));
    }
    if (n.variableChangedNotification) {
      const v = n.variableChangedNotification;
      if (v.identifier && v.name) {
        this.monitor.variables.applyChange(v.identifier, v.name, v.jsonNewValue ?? 'null', variableScopeName(v.scope));
      }
    }
    if (n.terminateSessionNotification?.sessionId) {
      this.monitor.variables.clearSession(n.terminateSessionNotification.sessionId);
    }
    if (n.keystrokeNotification) {
      this.monitor.keystrokes.record(convertKeystroke(n.keystrokeNotification));
    }
    if (n.promptNotification) {
      this.monitor.prompts.record(convertPrompt(n.promptNotification));
    }
    if (n.focusChangedNotification) {
      this.monitor.focus.record(convertFocus(n.focusChangedNotification));
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
      );
    }
  }

  private async handleServerRpc(
    requestId: string,
    rpc: { name: string; arguments: Array<{ name: string; jsonValue: string }> },
  ): Promise<void> {
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
      await this.respondToServerRpcException(
        requestId,
        `no registration for name=${rpc.name}`,
      );
      this.monitor.registrations.recordInvocation({
        at: Date.now(),
        registrationId: '',
        requestId,
        args,
        responded: true,
        responseJson: '',
        error: `no registration for name=${rpc.name}`,
      });
      return;
    }
    try {
      JSON.parse(spec.responseTemplate);
      await this.respondToServerRpc(requestId, spec.responseTemplate);
      this.monitor.registrations.recordInvocation({
        at: Date.now(),
        registrationId: spec.id,
        requestId,
        args,
        responded: true,
        responseJson: spec.responseTemplate,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.respondToServerRpcException(requestId, msg);
      this.monitor.registrations.recordInvocation({
        at: Date.now(),
        registrationId: spec.id,
        requestId,
        args,
        responded: true,
        responseJson: '',
        error: msg,
      });
    }
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

function sessionVariableEntity(sessionId: string): AppEntityRef {
  // [LAW:single-enforcer] Session variable snapshots are keyed by protocol session identity.
  return {
    kind: 'session',
    windowId: '',
    tabId: '',
    sessionId,
  };
}
