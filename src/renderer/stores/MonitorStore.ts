import { makeAutoObservable, runInAction } from 'mobx';
import type {
  LayoutSnapshot,
  VariableSnapshot,
  WireLogSnapshot,
  NotificationLogSnapshot,
  NotificationKind,
} from '@shared/rpc';

const EMPTY_LAYOUT: LayoutSnapshot = { windows: [], lastUpdatedAt: 0 };
const EMPTY_VARIABLES: VariableSnapshot = { sessionId: null, variables: [] };
const EMPTY_WIRE: WireLogSnapshot = { entries: [], totalSeen: 0, capacity: 0 };
const EMPTY_NOTIFICATIONS: NotificationLogSnapshot = {
  entries: [],
  totalSeen: 0,
  capacity: 0,
};

export class MonitorStore {
  layout: LayoutSnapshot = EMPTY_LAYOUT;
  variables: VariableSnapshot = EMPTY_VARIABLES;
  wire: WireLogSnapshot = EMPTY_WIRE;
  notifications: NotificationLogSnapshot = EMPTY_NOTIFICATIONS;
  focusSessionId: string | null = null;
  notificationKindFilter: NotificationKind | 'all' = 'all';
  wireDirectionFilter: 'all' | 'out' | 'in' = 'all';
  mirrorsHydrated = false;

  constructor() {
    makeAutoObservable(this);
  }

  applyLayout(snap: LayoutSnapshot): void {
    this.layout = snap;
  }

  applyVariables(snap: VariableSnapshot): void {
    this.variables = snap;
  }

  applyWire(snap: WireLogSnapshot): void {
    this.wire = snap;
  }

  applyNotifications(snap: NotificationLogSnapshot): void {
    this.notifications = snap;
  }

  setFocus(sessionId: string | null): void {
    this.focusSessionId = sessionId;
  }

  setNotificationKindFilter(k: NotificationKind | 'all'): void {
    this.notificationKindFilter = k;
  }

  setWireDirectionFilter(d: 'all' | 'out' | 'in'): void {
    this.wireDirectionFilter = d;
  }

  get filteredNotifications() {
    const kindFilter = this.notificationKindFilter;
    const sessionFilter = this.focusSessionId;
    return this.notifications.entries.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (sessionFilter && e.sessionId && e.sessionId !== sessionFilter) return false;
      return true;
    });
  }

  get filteredWire() {
    const dir = this.wireDirectionFilter;
    return this.wire.entries.filter((e) => dir === 'all' || e.direction === dir);
  }

  async hydrate(): Promise<void> {
    const [layout, variables, wire, notifications] = await Promise.all([
      window.ipc.invoke('monitor/layout', undefined as never),
      window.ipc.invoke('monitor/variables', undefined as never),
      window.ipc.invoke('monitor/wire-log', undefined as never),
      window.ipc.invoke('monitor/notifications', undefined as never),
    ]);
    runInAction(() => {
      this.layout = layout;
      this.variables = variables;
      this.wire = wire;
      this.notifications = notifications;
      this.mirrorsHydrated = true;
    });
  }

  async focusSession(sessionId: string | null): Promise<void> {
    this.setFocus(sessionId);
    const { focusedSessionId } = await window.ipc.invoke('monitor/focus-session', {
      sessionId,
    });
    runInAction(() => {
      this.focusSessionId = focusedSessionId;
    });
  }
}
