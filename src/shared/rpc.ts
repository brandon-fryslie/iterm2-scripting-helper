export interface ConnectionSnapshot {
  state:
    | 'idle'
    | 'detecting'
    | 'requesting-cookie'
    | 'connecting'
    | 'ready'
    | 'error';
  socketPath: string;
  socketExists: boolean;
  protocolVersion: string;
  advisoryName: string;
  cookieRequestedAt: number | null;
  lastError: string | null;
  wireFramesSeen: number;
  lastLatencyMs: number | null;
}

export interface SessionSummary {
  sessionId: string;
}

export interface TabSummary {
  tabId: string;
  sessions: SessionSummary[];
}

export interface WindowSummary {
  windowId: string;
  tabs: TabSummary[];
}

export interface ListSessionsSummary {
  windows: WindowSummary[];
}

export interface WireFrameEvent {
  direction: 'out' | 'in';
  size: number;
  at: number;
}

export interface LayoutSnapshot {
  windows: WindowSummary[];
  lastUpdatedAt: number;
}

export interface VariableEntry {
  name: string;
  value: string;
  live: boolean;
  updatedAt: number;
}

export interface VariableSnapshot {
  sessionId: string | null;
  variables: VariableEntry[];
}

export interface WireLogEntry {
  seq: number;
  at: number;
  direction: 'out' | 'in';
  size: number;
  kind: string;
  id: string;
}

export interface WireLogSnapshot {
  entries: WireLogEntry[];
  totalSeen: number;
  capacity: number;
}

export type NotificationKind =
  | 'keystroke'
  | 'screen-update'
  | 'prompt'
  | 'custom-escape'
  | 'new-session'
  | 'terminate-session'
  | 'layout-changed'
  | 'focus-changed'
  | 'variable-changed'
  | 'server-rpc'
  | 'broadcast-changed'
  | 'profile-changed'
  | 'location-changed'
  | 'unknown';

export interface NotificationEntry {
  seq: number;
  at: number;
  kind: NotificationKind;
  sessionId: string | null;
  summary: string;
}

export interface NotificationLogSnapshot {
  entries: NotificationEntry[];
  totalSeen: number;
  capacity: number;
}

export type KeystrokeAction = 'key-down' | 'key-up' | 'flags-changed';
export type KeystrokeModifier =
  | 'control'
  | 'option'
  | 'command'
  | 'shift'
  | 'function'
  | 'numpad';

export interface KeystrokeEntry {
  seq: number;
  at: number;
  sessionId: string;
  characters: string;
  charactersIgnoringModifiers: string;
  modifiers: KeystrokeModifier[];
  keyCode: number;
  action: KeystrokeAction;
}

export interface KeystrokeLogSnapshot {
  entries: KeystrokeEntry[];
  totalSeen: number;
  capacity: number;
  advanced: boolean;
}

export type PromptEventKind = 'prompt' | 'command-start' | 'command-end';

export interface PromptEntry {
  seq: number;
  at: number;
  sessionId: string;
  uniquePromptId: string;
  kind: PromptEventKind;
  command: string | null;
  status: number | null;
}

export interface PromptLogSnapshot {
  entries: PromptEntry[];
  totalSeen: number;
  capacity: number;
}

export type FocusEventKind =
  | 'app-active'
  | 'app-inactive'
  | 'window'
  | 'selected-tab'
  | 'session'
  | 'unknown';

export interface FocusEntry {
  seq: number;
  at: number;
  kind: FocusEventKind;
  summary: string;
  sessionId: string | null;
  windowId: string | null;
}

export interface FocusLogSnapshot {
  entries: FocusEntry[];
  totalSeen: number;
  capacity: number;
}

export interface ScreenLine {
  index: number;
  text: string;
}

export interface ScreenSnapshot {
  sessionId: string | null;
  lines: ScreenLine[];
  cursor: { x: number; y: number } | null;
  numLinesAboveScreen: number;
  lastUpdatedAt: number;
  requestsInflight: number;
  updatesReceived: number;
  lastError: string | null;
}

export type RpcSchema = {
  'system/ping': {
    args: void;
    result: { ok: true; now: number; electron: string };
  };
  'connection/snapshot': {
    args: void;
    result: ConnectionSnapshot;
  };
  'connection/connect': {
    args: void;
    result: ConnectionSnapshot;
  };
  'connection/disconnect': {
    args: void;
    result: ConnectionSnapshot;
  };
  'connection/list-sessions': {
    args: void;
    result: ListSessionsSummary;
  };
  'monitor/layout': {
    args: void;
    result: LayoutSnapshot;
  };
  'monitor/variables': {
    args: void;
    result: VariableSnapshot;
  };
  'monitor/wire-log': {
    args: void;
    result: WireLogSnapshot;
  };
  'monitor/notifications': {
    args: void;
    result: NotificationLogSnapshot;
  };
  'monitor/focus-session': {
    args: { sessionId: string | null };
    result: { focusedSessionId: string | null };
  };
  'monitor/keystrokes': {
    args: void;
    result: KeystrokeLogSnapshot;
  };
  'monitor/prompts': {
    args: void;
    result: PromptLogSnapshot;
  };
  'monitor/focus-log': {
    args: void;
    result: FocusLogSnapshot;
  };
  'monitor/screen': {
    args: void;
    result: ScreenSnapshot;
  };
  'monitor/set-keystroke-advanced': {
    args: { advanced: boolean };
    result: { advanced: boolean };
  };
};

export type RpcMethod = keyof RpcSchema;
export type RpcArgs<M extends RpcMethod> = RpcSchema[M]['args'];
export type RpcResult<M extends RpcMethod> = RpcSchema[M]['result'];

export type EventSchema = {
  'connection-state': ConnectionSnapshot;
  'wire-frame': WireFrameEvent;
  'layout-snapshot': LayoutSnapshot;
  'variables-snapshot': VariableSnapshot;
  'wire-snapshot': WireLogSnapshot;
  'notifications-snapshot': NotificationLogSnapshot;
  'screen-snapshot': ScreenSnapshot;
  'keystrokes-snapshot': KeystrokeLogSnapshot;
  'prompts-snapshot': PromptLogSnapshot;
  'focus-snapshot': FocusLogSnapshot;
};

export type EventKind = keyof EventSchema;
export type EventPayload<K extends EventKind> = EventSchema[K];
