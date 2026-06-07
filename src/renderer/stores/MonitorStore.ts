import { makeAutoObservable, runInAction } from 'mobx';
import type {
  LayoutSnapshot,
  VariableSnapshot,
  WireLogSnapshot,
  NotificationLogSnapshot,
  NotificationKind,
  KeystrokeLogSnapshot,
  PromptLogSnapshot,
  FocusLogSnapshot,
  ScreenSnapshot,
} from '@shared/rpc';

const EMPTY_LAYOUT: LayoutSnapshot = { windows: [], lastUpdatedAt: 0 };
const EMPTY_VARIABLES: VariableSnapshot = { sessionId: null, variables: [] };
const EMPTY_WIRE: WireLogSnapshot = { entries: [], totalSeen: 0, capacity: 0 };
const EMPTY_NOTIFICATIONS: NotificationLogSnapshot = {
  entries: [],
  totalSeen: 0,
  capacity: 0,
};
const EMPTY_KEYSTROKES: KeystrokeLogSnapshot = {
  entries: [],
  totalSeen: 0,
  capacity: 0,
  advanced: false,
};
const EMPTY_PROMPTS: PromptLogSnapshot = {
  entries: [],
  totalSeen: 0,
  capacity: 0,
};
const EMPTY_FOCUS: FocusLogSnapshot = {
  entries: [],
  totalSeen: 0,
  capacity: 0,
};
const EMPTY_SCREEN: ScreenSnapshot = {
  sessionId: null,
  lines: [],
  cursor: null,
  lastUpdatedAt: 0,
  requestsInflight: 0,
  updatesReceived: 0,
  lastError: null,
};

export type ActiveEventTab = 'keystrokes' | 'prompts' | 'notifications' | 'focus' | 'wire';

export class MonitorStore {
  layout: LayoutSnapshot = EMPTY_LAYOUT;
  variables: VariableSnapshot = EMPTY_VARIABLES;
  wire: WireLogSnapshot = EMPTY_WIRE;
  notifications: NotificationLogSnapshot = EMPTY_NOTIFICATIONS;
  keystrokes: KeystrokeLogSnapshot = EMPTY_KEYSTROKES;
  prompts: PromptLogSnapshot = EMPTY_PROMPTS;
  focus: FocusLogSnapshot = EMPTY_FOCUS;
  screen: ScreenSnapshot = EMPTY_SCREEN;
  notificationKindFilter: NotificationKind | 'all' = 'all';
  wireDirectionFilter: 'all' | 'out' | 'in' = 'all';
  activeEventTab: ActiveEventTab = 'keystrokes';
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

  applyKeystrokes(snap: KeystrokeLogSnapshot): void {
    this.keystrokes = snap;
  }

  applyPrompts(snap: PromptLogSnapshot): void {
    this.prompts = snap;
  }

  applyFocus(snap: FocusLogSnapshot): void {
    this.focus = snap;
  }

  applyScreen(snap: ScreenSnapshot): void {
    this.screen = snap;
  }

  setNotificationKindFilter(k: NotificationKind | 'all'): void {
    this.notificationKindFilter = k;
  }

  setWireDirectionFilter(d: 'all' | 'out' | 'in'): void {
    this.wireDirectionFilter = d;
  }

  setActiveEventTab(tab: ActiveEventTab): void {
    this.activeEventTab = tab;
  }

  filteredNotifications(sessionFilter: string | null) {
    const kindFilter = this.notificationKindFilter;
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
    const [layout, variables, wire, notifications, keystrokes, prompts, focus, screen] =
      await Promise.all([
        window.ipc.invoke('monitor/layout', undefined as never),
        window.ipc.invoke('monitor/variables', undefined as never),
        window.ipc.invoke('monitor/wire-log', undefined as never),
        window.ipc.invoke('monitor/notifications', undefined as never),
        window.ipc.invoke('monitor/keystrokes', undefined as never),
        window.ipc.invoke('monitor/prompts', undefined as never),
        window.ipc.invoke('monitor/focus-log', undefined as never),
        window.ipc.invoke('monitor/screen', undefined as never),
      ]);
    runInAction(() => {
      this.layout = layout;
      this.variables = variables;
      this.wire = wire;
      this.notifications = notifications;
      this.keystrokes = keystrokes;
      this.prompts = prompts;
      this.focus = focus;
      this.screen = screen;
      this.mirrorsHydrated = true;
    });
  }

  async loadSessionFocus(sessionId: string | null): Promise<string | null> {
    const { focusedSessionId } = await window.ipc.invoke('monitor/focus-session', {
      sessionId,
    });
    return focusedSessionId;
  }

  async setKeystrokeAdvanced(advanced: boolean): Promise<void> {
    await window.ipc.invoke('monitor/set-keystroke-advanced', { advanced });
  }

  async refreshKeystrokes(): Promise<void> {
    const snap = await window.ipc.invoke('monitor/keystrokes', undefined as never);
    runInAction(() => this.applyKeystrokes(snap));
  }

  async refreshPrompts(): Promise<void> {
    const snap = await window.ipc.invoke('monitor/prompts', undefined as never);
    runInAction(() => this.applyPrompts(snap));
  }

  async refreshFocus(): Promise<void> {
    const snap = await window.ipc.invoke('monitor/focus-log', undefined as never);
    runInAction(() => this.applyFocus(snap));
  }

  async refreshWire(): Promise<void> {
    const snap = await window.ipc.invoke('monitor/wire-log', undefined as never);
    runInAction(() => this.applyWire(snap));
  }

  async refreshNotifications(): Promise<void> {
    const snap = await window.ipc.invoke('monitor/notifications', undefined as never);
    runInAction(() => this.applyNotifications(snap));
  }
}
