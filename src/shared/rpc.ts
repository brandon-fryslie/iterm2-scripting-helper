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

export interface CellStyleRun {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  repeats: number;
}

export interface StyledLine {
  index: number;
  text: string;
  styles: CellStyleRun[];
}

export interface ScreenLine {
  index: number;
  text: string;
  styles: CellStyleRun[];
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

export interface ActionResult {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  responseCase: string | null;
  payload: Record<string, unknown> | null;
}

export type ActivateTarget =
  | { kind: 'window'; id: string }
  | { kind: 'tab'; id: string }
  | { kind: 'session'; id: string }
  | { kind: 'app' };

export type InvokeScope =
  | { kind: 'app' }
  | { kind: 'session'; id: string }
  | { kind: 'tab'; id: string }
  | { kind: 'window'; id: string };

export type CloseTargetKind = 'sessions' | 'tabs' | 'windows';

export interface ProfileSummary {
  guid: string;
  name: string;
  properties: Record<string, string>;
}

export interface ProfileListResult {
  ok: boolean;
  error?: string;
  profiles: ProfileSummary[];
}

export interface DynamicProfileFile {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  body: string;
  parseError: string | null;
  topLevelKeys: string[];
  profileCount: number;
}

export interface DynamicProfileSnapshot {
  folder: string;
  folderExists: boolean;
  files: DynamicProfileFile[];
  lastError: string | null;
}

export type RegistrationRole =
  | 'generic'
  | 'session-title'
  | 'status-bar'
  | 'context-menu';

export interface KnobSpec {
  name: string;
  type: 'Checkbox' | 'String' | 'PositiveFloatingPoint' | 'Color';
  placeholder: string;
  jsonDefaultValue: string;
  key: string;
}

export interface StatusBarAttrs {
  shortDescription: string;
  detailedDescription: string;
  knobs: KnobSpec[];
  exemplar: string;
  updateCadence: number;
  uniqueIdentifier: string;
  format: 'PLAIN_TEXT' | 'HTML';
}

export interface SessionTitleAttrs {
  displayName: string;
  uniqueIdentifier: string;
}

export interface ContextMenuAttrs {
  displayName: string;
  uniqueIdentifier: string;
}

export interface RegistrationSpec {
  id: string;
  role: RegistrationRole;
  name: string;
  arguments: string[];
  defaults: Array<{ name: string; path: string }>;
  timeout: number;
  statusBar?: StatusBarAttrs;
  sessionTitle?: SessionTitleAttrs;
  contextMenu?: ContextMenuAttrs;
  responseTemplate: string;
}

export interface Invocation {
  seq: number;
  at: number;
  registrationId: string;
  requestId: string;
  args: Record<string, unknown>;
  responded: boolean;
  responseJson: string;
  error: string | null;
}

export interface RegistrationSnapshot {
  registrations: RegistrationSpec[];
  invocations: Invocation[];
  totalInvocations: number;
}

export interface CustomEscapeSubscription {
  id: string;
  sessionId: string;
  identity: string;
  createdAt: number;
}

export interface CustomEscapeEntry {
  seq: number;
  at: number;
  subscriptionId: string;
  sessionId: string;
  identity: string;
  payload: string;
}

export interface CustomEscapeSnapshot {
  subscriptions: CustomEscapeSubscription[];
  entries: CustomEscapeEntry[];
  totalSeen: number;
  capacity: number;
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
  'actions/send-text': {
    args: { sessionId: string; text: string; suppressBroadcast?: boolean };
    result: ActionResult;
  };
  'actions/inject': {
    args: { sessionIds: string[]; bytesHex: string };
    result: ActionResult;
  };
  'actions/activate': {
    args: {
      target: ActivateTarget;
      orderWindowFront?: boolean;
      selectSession?: boolean;
      selectTab?: boolean;
      activateApp?: boolean;
    };
    result: ActionResult;
  };
  'actions/menu-item': {
    args: { identifier: string; queryOnly?: boolean };
    result: ActionResult;
  };
  'actions/invoke-function': {
    args: { invocation: string; scope: InvokeScope; timeout?: number };
    result: ActionResult;
  };
  'actions/restart-session': {
    args: { sessionId: string; onlyIfExited?: boolean };
    result: ActionResult;
  };
  'actions/close': {
    args: { kind: CloseTargetKind; ids: string[]; force?: boolean };
    result: ActionResult;
  };
  'actions/raw-protobuf': {
    args: { envelopeJson: string };
    result: ActionResult;
  };
  'workbench/list-profiles': {
    args: void;
    result: ProfileListResult;
  };
  'workbench/set-profile-property': {
    args: {
      guids: string[];
      assignments: Array<{ key: string; jsonValue: string }>;
    };
    result: ActionResult;
  };
  'workbench/dynamic-profiles': {
    args: void;
    result: DynamicProfileSnapshot;
  };
  'workbench/save-dynamic-profile': {
    args: { basename: string; body: string };
    result: { ok: boolean; error: string | null; path: string | null };
  };
  'workbench/delete-dynamic-profile': {
    args: { basename: string };
    result: { ok: boolean; error: string | null };
  };
  'workbench/register-rpc': {
    args: RegistrationSpec;
    result: { ok: boolean; error: string | null; registrationId: string | null };
  };
  'workbench/unregister-rpc': {
    args: { id: string };
    result: { ok: boolean; error: string | null };
  };
  'workbench/registrations': {
    args: void;
    result: RegistrationSnapshot;
  };
  'workbench/subscribe-custom-escape': {
    args: { sessionId: string; identity: string };
    result: { ok: boolean; error: string | null; subscriptionId: string | null };
  };
  'workbench/unsubscribe-custom-escape': {
    args: { subscriptionId: string };
    result: { ok: boolean; error: string | null };
  };
  'workbench/custom-escape': {
    args: void;
    result: CustomEscapeSnapshot;
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
  'dynamic-profiles-snapshot': DynamicProfileSnapshot;
  'registrations-snapshot': RegistrationSnapshot;
  'custom-escape-snapshot': CustomEscapeSnapshot;
};

export type EventKind = keyof EventSchema;
export type EventPayload<K extends EventKind> = EventSchema[K];
