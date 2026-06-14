import type { PlistJson } from './plist';
import type { SpanRange } from './fixture';
import type {
  AppEntityRef,
  AppLayout,
  AppWindow,
  AppSession,
  AppVariableEntry,
  AppVariableChange,
  AppVariableScope,
  AppProbeResult,
  AppCellStyleRun,
  AppLine,
  AppEvent,
  AppEventKind,
  AppEventLogSnapshot,
  AppActionKind,
  AppActionResult,
} from './domain';

export type {
  AppEntityRef,
  AppLayout,
  AppWindow,
  AppSession,
  AppVariableEntry,
  AppVariableChange,
  AppVariableScope,
  AppProbeResult,
  AppCellStyleRun,
  AppLine,
  AppEvent,
  AppEventKind,
  AppEventLogSnapshot,
  AppActionKind,
  AppActionResult,
};

// Re-export domain types under old names for backward compat during migration
export type SessionSummary = AppSession;
export interface LayoutSnapshot {
  windows: AppWindow[];
  buriedSessions: AppSession[];
  lastUpdatedAt: number;
}

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

export interface ListSessionsSummary {
  windows: AppWindow[];
  buriedSessions: AppSession[];
}

export interface WireFrameEvent {
  direction: 'out' | 'in';
  size: number;
  at: number;
}

export interface VariableSnapshot {
  entity: AppEntityRef;
  variables: AppVariableEntry[];
}

export interface WatchlistSnapshot {
  names: string[];
}

export interface ScreenSnapshot {
  sessionId: string | null;
  lines: AppLine[];
  cursor: { x: number; y: number } | null;
  lastUpdatedAt: number;
  requestsInflight: number;
  updatesReceived: number;
  lastError: string | null;
}

// [LAW:one-source-of-truth] One ActionResult shape, defined in domain.ts (the lower layer) and reused
// here so the value returned to the renderer and the value recorded on the spine cannot drift.
export type ActionResult = AppActionResult;

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

// [LAW:dataflow-not-control-flow] begin/end transaction is ONE op value over ONE wire message;
// two action kinds would be two types for the same behavior.
export type TransactionOp = 'begin' | 'end';

// The two scripting runtime values accepted by osascript's -l flag. 'JavaScript' is JXA
// (JavaScript for Automation). Values match the flag argument verbatim.
export type OsascriptLanguage = 'AppleScript' | 'JavaScript';

// [LAW:types-are-the-program] text and error are mutually exclusive — success carries the XML
// string, failure carries the real cause from the main-process subprocess.
export type SdefTextResult = { text: string; error: null } | { text: null; error: string };

// The two verbs of the SavedArrangementRequest wire message that mutate state; LIST is a read and
// belongs to the workbench snapshot, not the action. windowId follows the wire's dual semantics:
// with 'save' it scopes the save to one window's tabs, with 'restore' it restores into an existing
// window (absent = restore as new windows — the "apply to new window" workflow is this value).
export type ArrangementOp = 'save' | 'restore';

// [LAW:one-source-of-truth] An arrangement has two independent authorities: iTerm2's engine answers
// "which names exist" (the LIST wire message), and the com.googlecode.iterm2 defaults domain holds
// the saved content under 'Window Arrangements'. The snapshot carries both results separately —
// each side can fail on its own and is never synthesized from the other ([LAW:no-silent-failure]).
export type ArrangementNamesResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

export type ArrangementContentsResult =
  | { ok: true; arrangements: Record<string, PlistJson> }
  | { ok: false; error: string };

export interface ArrangementSnapshot {
  names: ArrangementNamesResult;
  contents: ArrangementContentsResult;
}

// The engine's broadcast-domain table, verbatim: each domain is the session-id set iTerm2 reports
// for it. One authority (GetBroadcastDomainsRequest); the editor's draft is derived from this and
// explicitly applied back, never a second source of truth. [LAW:one-source-of-truth]
export type BroadcastDomainsResult =
  | { ok: true; domains: string[][] }
  | { ok: false; error: string };

// [LAW:one-source-of-truth] Key bindings and snippets live only in the defaults domain;
// there is no engine authority to disagree with — one source, one result.
export interface KeyBindingEntry {
  key: string;       // raw GlobalKeyMap key (e.g. "0x61-0x100000")
  action: number;    // action integer
  parameter: string; // action-specific parameter
  label: string;     // user-visible label (if any)
  version: number;
}

export interface SnippetEntry {
  title: string;
  value: string;
  tags: string[];
}

export type KeyBindingsSnapshot =
  | {
      ok: true;
      globalBindings: KeyBindingEntry[];
      snippets: SnippetEntry[];
      pasteConfig: Record<string, PlistJson>;
    }
  | { ok: false; error: string };

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

// [LAW:one-source-of-truth] The snapshot carries raw file facts only; everything a body *means*
// (JSON validity, profile shape, parent refs) is derived in the renderer by the single shared
// analyzer in shared/dynamicProfiles.ts, so disk files and the live editor buffer are judged by
// the same enforcer and there is no second derived copy to drift.
export interface DynamicProfileFile {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  body: string;
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
  | 'context-menu'
  | 'toolbelt';

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

// [LAW:one-type-per-behavior] Session title providers and context menu providers expose the same
// attributes and behave identically on the wire; they are two role values over one attrs type, not
// two types.
export interface DisplayIdentityAttrs {
  displayName: string;
  uniqueIdentifier: string;
}

export interface ToolbeltAttrs {
  displayName: string;
  identifier: string;
  url: string;
  revealIfAlreadyRegistered: boolean;
}

// The fields shared by every server-originated-RPC registration. Toolbelt tools are webviews —
// they have no function name, no arguments, and nothing to respond with, so the union below keeps
// those fields off the toolbelt arm entirely.
export interface RpcRegistrationCommon {
  name: string;
  arguments: string[];
  defaults: Array<{ name: string; path: string }>;
  timeout: number;
  responseTemplate: string;
}

// [LAW:types-are-the-program] A registration is a discriminated union on role: each RPC role
// REQUIRES its role-specific attributes (a status-bar registration without knob/cadence attrs is
// unrepresentable), and the toolbelt arm carries only what the RegisterTool wire message accepts.
// The body is what the editor authors and the preview shows; the id is assigned at install time.
export type RegistrationBody =
  | (RpcRegistrationCommon & { role: 'generic' })
  | (RpcRegistrationCommon & { role: 'status-bar'; attrs: StatusBarAttrs })
  | (RpcRegistrationCommon & { role: 'session-title'; attrs: DisplayIdentityAttrs })
  | (RpcRegistrationCommon & { role: 'context-menu'; attrs: DisplayIdentityAttrs })
  | { role: 'toolbelt'; attrs: ToolbeltAttrs };

export type RegistrationSpec = RegistrationBody & { id: string };

// Registrations the server can call back into over NOTIFY_ON_SERVER_ORIGINATED_RPC.
export type RpcRegistrationSpec = Exclude<RegistrationSpec, { role: 'toolbelt' }>;
export type ToolbeltRegistrationSpec = Extract<RegistrationSpec, { role: 'toolbelt' }>;

export interface RoleCapabilities {
  label: string;
  // iTerm2 has a wire message to remove it. The API has no unregister-tool message: a toolbelt tool
  // persists in iTerm2 until restart, and unregistering only forgets it locally. This is the
  // UI-facing projection of the union shape (RpcRegistrationSpec vs the toolbelt arm); the union
  // itself is what routes the wire paths.
  wireUnregister: boolean;
}

// [LAW:dataflow-not-control-flow] Per-role display differences are values consumed by the one
// editor — never separate per-role editor components.
export const ROLE_CAPABILITIES: Record<RegistrationRole, RoleCapabilities> = {
  generic: { label: 'Generic RPC', wireUnregister: true },
  'status-bar': { label: 'Status Bar Component', wireUnregister: true },
  'session-title': { label: 'Session Title Provider', wireUnregister: true },
  'context-menu': { label: 'Context Menu Provider', wireUnregister: true },
  toolbelt: { label: 'Toolbelt Tool', wireUnregister: false },
};

export function registrationDisplayName(spec: RegistrationBody): string {
  return spec.role === 'toolbelt' ? spec.attrs.displayName : spec.name;
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

// A tmux connection as iTerm2 reports it: the gateway session that owns it and the id used to address
// commands and windows to it. [LAW:one-source-of-truth] iTerm2's TmuxRequest.listConnections is the
// sole authority; the renderer's TmuxStore is an explicitly-refreshable derived cache, never a second
// source of truth.
export interface TmuxConnection {
  connectionId: string;
  owningSessionId: string;
}

// [LAW:no-silent-failure] The list read either succeeds with the connection set or carries the real
// cause (not connected, refused status, wrong response case) — an empty list is "no connections", a
// distinct fact from "the read failed".
export type TmuxConnectionsResult =
  | { ok: true; connections: TmuxConnection[] }
  | { ok: false; error: string };

// The color-preset names iTerm2 knows, from ColorPresetRequest.listPresets. [LAW:one-source-of-truth]
// iTerm2 is the sole authority; the renderer's ColorPresetStore is an explicitly-refreshable derived
// cache. [LAW:no-silent-failure] an empty list is "no presets", distinct from a failed read.
export type ColorPresetsResult =
  | { ok: true; presets: string[] }
  | { ok: false; error: string };

// [LAW:types-are-the-program] [LAW:no-silent-failure] Three outcomes, never blurred: a written file
// (carrying its path and how many events it holds), a real failure (carrying the cause), or a
// user-cancelled dialog (error null — a deliberate no-op, distinct from a failure). The renderer
// narrows on `ok` and on `error === null`.
export type FixtureCaptureResult =
  | { ok: true; path: string; eventCount: number }
  | { ok: false; error: string | null };

export type FixtureReplayResult =
  | { ok: true; path: string; eventCount: number }
  | { ok: false; error: string | null };

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
  // The whole spine, for the unified activity timeline (449.7.9) and provenance walking.
  'monitor/events': {
    args: void;
    result: AppEventLogSnapshot;
  };
  // Save a wire-log span as replayable NDJSON. `span` null captures the whole retained spine; `path`
  // null prompts the user with a native save dialog (an explicit path is for automation/tests). The
  // result distinguishes a written file, a user-cancelled dialog (error null), and a real failure.
  'fixture/capture': {
    args: { span?: SpanRange | null; path?: string | null };
    result: FixtureCaptureResult;
  };
  // Replay a fixture into the disconnected spine. `path` null prompts a native open dialog. Refuses
  // loudly while connected (replay-only mode); after a successful replay the activity timeline projects
  // the recorded session with no live connection.
  'fixture/replay': {
    args: { path?: string | null };
    result: FixtureReplayResult;
  };
  'monitor/focus-session': {
    args: { sessionId: string | null };
    result: { focusedSessionId: string | null };
  };
  'monitor/focus-variables': {
    args: { entity: AppEntityRef };
    result: VariableSnapshot;
  };
  'monitor/probe-variable': {
    args: { entity: AppEntityRef; expression: string };
    result: AppProbeResult;
  };
  'monitor/watchlist': {
    args: void;
    result: WatchlistSnapshot;
  };
  'monitor/set-watched': {
    args: { name: string; watched: boolean };
    result: WatchlistSnapshot;
  };
  'monitor/screen': {
    args: void;
    result: ScreenSnapshot;
  };
  // [LAW:dataflow-not-control-flow] Every action carries the focused `entity` it is scoped to as a
  // value. The main process records it on the action's spine event — it does not re-derive a target
  // by branching on which fields the args happen to contain. Explicit per-action target overrides
  // stay inside the action's own args (action-local data).
  'actions/send-text': {
    args: { entity: AppEntityRef; sessionId: string; text: string; suppressBroadcast?: boolean };
    result: ActionResult;
  };
  'actions/inject': {
    args: { entity: AppEntityRef; sessionIds: string[]; bytesHex: string };
    result: ActionResult;
  };
  'actions/activate': {
    args: {
      entity: AppEntityRef;
      target: ActivateTarget;
      orderWindowFront?: boolean;
      selectSession?: boolean;
      selectTab?: boolean;
      activateApp?: boolean;
    };
    result: ActionResult;
  };
  'actions/menu-item': {
    args: { entity: AppEntityRef; identifier: string; queryOnly?: boolean };
    result: ActionResult;
  };
  'actions/invoke-function': {
    args: { entity: AppEntityRef; invocation: string; scope: InvokeScope; timeout?: number };
    result: ActionResult;
  };
  'actions/restart-session': {
    args: { entity: AppEntityRef; sessionId: string; onlyIfExited?: boolean };
    result: ActionResult;
  };
  'actions/close': {
    args: { entity: AppEntityRef; kind: CloseTargetKind; ids: string[]; force?: boolean };
    result: ActionResult;
  };
  'actions/saved-arrangement': {
    args: { entity: AppEntityRef; op: ArrangementOp; name: string; windowId?: string };
    result: ActionResult;
  };
  // The wire's SET replaces the whole table atomically; the args mirror that — the full table as
  // one value, never an incremental patch the engine doesn't model. [LAW:dataflow-not-control-flow]
  'actions/set-broadcast-domains': {
    args: { entity: AppEntityRef; domains: string[][] };
    result: ActionResult;
  };
  'actions/get-selection': {
    args: { entity: AppEntityRef; sessionId: string };
    result: ActionResult;
  };
  // selectionJson is a JSON-encoded iterm2.Selection proto (output of get-selection can be pasted back).
  'actions/set-selection': {
    args: { entity: AppEntityRef; sessionId: string; selectionJson: string };
    result: ActionResult;
  };
  'actions/transaction': {
    args: { entity: AppEntityRef; op: TransactionOp };
    result: ActionResult;
  };
  // osascript runs locally via subprocess — no wire round-trip, no requestId. The result carries
  // stdout on success or stderr (trimmed) as the error on failure. [LAW:effects-at-boundaries]
  'actions/osascript': {
    args: { entity: AppEntityRef; script: string; language: OsascriptLanguage };
    result: ActionResult;
  };
  'actions/raw-protobuf': {
    args: { entity: AppEntityRef; envelopeJson: string };
    result: ActionResult;
  };
  // The three mutating arms of TmuxRequest. Each addresses a connection by id (from the tmux store);
  // create-window's affinity hints which existing tmux window the new one should be adjacent to (''
  // = no hint). [LAW:dataflow-not-control-flow] each arm is its own action, mirroring the wire oneof.
  'actions/tmux-send-command': {
    args: { entity: AppEntityRef; connectionId: string; command: string };
    result: ActionResult;
  };
  'actions/tmux-create-window': {
    args: { entity: AppEntityRef; connectionId: string; affinity: string };
    result: ActionResult;
  };
  'actions/tmux-set-window-visible': {
    args: { entity: AppEntityRef; connectionId: string; windowId: string; visible: boolean };
    result: ActionResult;
  };
  // Raw preference-key inspection (the read arm of PreferencesRequest). iTerm2 has no native UI for a
  // key's raw stored JSON; an empty jsonValue payload is the honest "no value set" for that key.
  'actions/get-preference': {
    args: { entity: AppEntityRef; key: string };
    result: ActionResult;
  };
  // Bulk color-preset application — apply one preset to many profiles at once via the API, which the
  // native Settings has no UI for. presetName picks the preset; guids are the target profiles. The
  // action reads the preset (getPreset) then writes its colors as profile-property assignments.
  'actions/apply-color-preset': {
    args: { entity: AppEntityRef; presetName: string; guids: string[] };
    result: ActionResult;
  };
  'workbench/list-profiles': {
    args: void;
    result: ProfileListResult;
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
  'workbench/arrangements': {
    args: void;
    result: ArrangementSnapshot;
  };
  'workbench/broadcast-domains': {
    args: void;
    result: BroadcastDomainsResult;
  };
  'workbench/key-bindings': {
    args: void;
    result: KeyBindingsSnapshot;
  };
  // Raw sdef XML for /Applications/iTerm.app. The main process runs sdef(1) and returns the stdout;
  // parsing (DOMParser) belongs in the renderer where a real XML engine is available.
  // [LAW:types-are-the-program] Discriminated union: text and error are mutually exclusive so
  // callers narrow with `if (res.text)` and get string-typed error in the else branch.
  'workbench/sdef-text': {
    args: void;
    result: SdefTextResult;
  };
  // The tmux store's read authority: fires TmuxRequest.listConnections each call (no main-side cache —
  // connections come and go, so a fresh wire read is the honest answer). The renderer TmuxStore holds
  // the loaded snapshot and its lifecycle state. Console-consumed, like workbench/sdef-text.
  'workbench/tmux-connections': {
    args: void;
    result: TmuxConnectionsResult;
  };
  // The color-preset store's read authority: fires ColorPresetRequest.listPresets each call (no
  // main-side cache — presets are user-editable, so a fresh wire read is the honest answer). The
  // renderer ColorPresetStore holds the loaded snapshot and its lifecycle state. Console-consumed.
  'workbench/color-presets': {
    args: void;
    result: ColorPresetsResult;
  };
};

export type RpcMethod = keyof RpcSchema;
export type RpcArgs<M extends RpcMethod> = RpcSchema[M]['args'];
export type RpcResult<M extends RpcMethod> = RpcSchema[M]['result'];

export type EventSchema = {
  'connection-state': ConnectionSnapshot;
  'wire-frame': WireFrameEvent;
  'layout-snapshot': import('../main/stores/LayoutStore').LayoutSnapshot;
  'variables-snapshot': VariableSnapshot;
  'watchlist-snapshot': WatchlistSnapshot;
  'screen-snapshot': ScreenSnapshot;
  'dynamic-profiles-snapshot': DynamicProfileSnapshot;
  'registrations-snapshot': RegistrationSnapshot;
  'custom-escape-snapshot': CustomEscapeSnapshot;
};

export type EventKind = keyof EventSchema;
export type EventPayload<K extends EventKind> = EventSchema[K];
