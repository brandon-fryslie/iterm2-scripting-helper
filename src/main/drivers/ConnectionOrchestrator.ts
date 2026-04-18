import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { create } from '@bufbuild/protobuf';
import {
  ListSessionsRequestSchema,
  NotificationRequestSchema,
  VariableRequestSchema,
  NotificationType,
  VariableScope,
  type ServerOriginatedMessage,
  type Notification,
  type ListSessionsResponse,
} from '@shared/proto/gen/api_pb';
import { AppleScriptDriver, AppleScriptError } from './AppleScriptDriver';
import {
  ProtocolDriver,
  ProtocolError,
  type WireFrame,
} from './ProtocolDriver';
import type { ConnectionStore } from '../stores/ConnectionStore';
import type { LayoutStore } from '../stores/LayoutStore';
import type { VariableStore } from '../stores/VariableStore';
import type { WireLogStore } from '../stores/WireLogStore';
import type { NotificationHub } from '../stores/NotificationHub';

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

export const LIVE_VARIABLE_WATCHLIST = [
  'hostname',
  'username',
  'path',
  'jobName',
  'jobPid',
  'lastCommand',
  'bellCount',
  'rows',
  'columns',
  'tty',
] as const;

export interface OrchestratorOptions {
  advisoryName: string;
  libraryVersion: string;
  socketPath?: string;
}

export interface MonitorStores {
  layout: LayoutStore;
  variables: VariableStore;
  wire: WireLogStore;
  notifications: NotificationHub;
}

export class ConnectionOrchestrator extends EventEmitter {
  private readonly applescript = new AppleScriptDriver();
  private readonly protocol = new ProtocolDriver();
  private readonly options: Required<OrchestratorOptions>;
  private credentials: { cookie: string; key: string } | null = null;
  private activeGlobalSubscriptions: NotificationType[] = [];
  private activeVariableSubs: Array<{ name: string; sessionId: string }> = [];

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
    this.monitor.variables.setLiveNames(LIVE_VARIABLE_WATCHLIST);

    this.protocol.on('frame', (frame: WireFrame) => {
      this.store.recordFrame();
      this.monitor.wire.recordFrame(frame.direction, frame.bytes, frame.at);
      this.emit('frame', frame);
    });
    this.protocol.on('notification', (n: Notification) => {
      const entry = this.monitor.notifications.record(n);
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
      this.activeGlobalSubscriptions = [];
      this.activeVariableSubs = [];
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

      await this.fetchInitialLayout();
      await this.subscribeGlobalNotifications();
    } catch (err) {
      this.store.setError(errString(err));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
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
    if (this.monitor.variables.focusedSessionId === sessionId) return;

    if (this.protocol.getState() === 'ready') {
      for (const sub of this.activeVariableSubs) {
        await this.toggleVariableSubscription(sub.sessionId, sub.name, false).catch(
          () => void 0,
        );
      }
    }
    this.activeVariableSubs = [];

    this.monitor.variables.setFocused(sessionId);
    if (!sessionId || this.protocol.getState() !== 'ready') return;

    try {
      const dump = await this.fetchAllVariablesForSession(sessionId);
      this.monitor.variables.applyDump(sessionId, dump);
    } catch (err) {
      this.emit('error', err);
    }

    for (const name of LIVE_VARIABLE_WATCHLIST) {
      await this.toggleVariableSubscription(sessionId, name, true).catch(() => void 0);
      this.activeVariableSubs.push({ name, sessionId });
    }
  }

  getSocketPath(): string {
    return this.options.socketPath;
  }

  private async fetchInitialLayout(): Promise<void> {
    const response = await this.protocol.send({
      submessage: {
        case: 'listSessionsRequest' as const,
        value: create(ListSessionsRequestSchema, {}),
      },
    });
    if (response.submessage.case === 'listSessionsResponse') {
      this.monitor.layout.apply(response.submessage.value);
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

  private async sendNotificationRequest(
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
    const req = create(VariableRequestSchema, {
      scope: { case: 'sessionId', value: sessionId },
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

  private routeNotification(n: Notification): void {
    if (n.layoutChangedNotification?.listSessionsResponse) {
      this.monitor.layout.apply(
        n.layoutChangedNotification.listSessionsResponse satisfies ListSessionsResponse,
      );
    }
    if (n.variableChangedNotification) {
      const v = n.variableChangedNotification;
      if (v.identifier && v.name) {
        this.monitor.variables.applyChange(v.identifier, v.name, v.jsonNewValue ?? 'null');
      }
    }
    if (n.terminateSessionNotification?.sessionId) {
      this.monitor.variables.clearSession(n.terminateSessionNotification.sessionId);
    }
  }
}

function errString(err: unknown): string {
  if (err instanceof AppleScriptError || err instanceof ProtocolError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
