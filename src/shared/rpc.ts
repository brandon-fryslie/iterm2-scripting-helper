import type { PlistJson } from './plist';
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
