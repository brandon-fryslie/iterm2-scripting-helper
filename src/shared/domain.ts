export interface AppPoint {
  x: number;
  y: number;
}

export interface AppSize {
  width: number;
  height: number;
}

export interface AppFrame {
  origin: AppPoint | null;
  size: AppSize | null;
}

export interface AppSession {
  sessionId: string;
  title: string;
  frame: AppFrame | null;
  gridSize: AppSize | null;
}

export interface AppSplitNode {
  vertical: boolean;
  children: AppSplitChild[];
}

export type AppSplitChild =
  | { kind: 'session'; session: AppSession }
  | { kind: 'node'; node: AppSplitNode };

export interface AppTab {
  tabId: string;
  root: AppSplitNode | null;
  tmuxWindowId: string;
  tmuxConnectionId: string;
  minimizedSessions: AppSession[];
}

export interface AppWindow {
  windowId: string;
  tabs: AppTab[];
  frame: AppFrame | null;
  number: number;
}

export interface AppLayout {
  windows: AppWindow[];
  buriedSessions: AppSession[];
}

export type AppEntityKind = 'app' | 'window' | 'tab' | 'session';

export interface AppEntityAppRef {
  kind: 'app';
}

export interface AppEntityWindowRef {
  kind: 'window';
  windowId: string;
}

export interface AppEntityTabRef {
  kind: 'tab';
  windowId: string;
  tabId: string;
}

export interface AppEntitySessionRef {
  kind: 'session';
  windowId: string;
  tabId: string;
  sessionId: string;
}

export type AppEntityRef =
  | AppEntityAppRef
  | AppEntityWindowRef
  | AppEntityTabRef
  | AppEntitySessionRef;

export const APP_ENTITY: AppEntityAppRef = { kind: 'app' };

export function windowEntityRef(window: AppWindow): AppEntityWindowRef {
  return { kind: 'window', windowId: window.windowId };
}

export function tabEntityRef(window: AppWindow, tab: AppTab): AppEntityTabRef {
  return { kind: 'tab', windowId: window.windowId, tabId: tab.tabId };
}

export function sessionEntityRef(
  window: AppWindow,
  tab: AppTab,
  session: AppSession,
): AppEntitySessionRef {
  return {
    kind: 'session',
    windowId: window.windowId,
    tabId: tab.tabId,
    sessionId: session.sessionId,
  };
}

export function appEntityKey(entity: AppEntityRef): string {
  switch (entity.kind) {
    case 'app':
      return 'app';
    case 'window':
      return `window:${entity.windowId}`;
    case 'tab':
      return `tab:${entity.windowId}:${entity.tabId}`;
    case 'session':
      return `session:${entity.windowId}:${entity.tabId}:${entity.sessionId}`;
  }
}

export function isSessionEntity(entity: AppEntityRef): entity is AppEntitySessionRef {
  return entity.kind === 'session';
}

// [LAW:single-enforcer] The layout graph is the authority for focus ref validity.
export function appEntityExistsInLayout(
  layout: Pick<AppLayout, 'windows'>,
  entity: AppEntityRef,
): boolean {
  switch (entity.kind) {
    case 'app':
      return true;
    case 'window':
      return layout.windows.some((window) => window.windowId === entity.windowId);
    case 'tab':
      return layout.windows.some(
        (window) =>
          window.windowId === entity.windowId &&
          window.tabs.some((tab) => tab.tabId === entity.tabId),
      );
    case 'session':
      return layout.windows.some(
        (window) =>
          window.windowId === entity.windowId &&
          window.tabs.some(
            (tab) =>
              tab.tabId === entity.tabId &&
              flatSessions(tab).some(
                (session) => session.sessionId === entity.sessionId,
              ),
          ),
      );
  }
}

export interface AppCellStyleRun {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  blink: boolean;
  underline: boolean;
  strikethrough: boolean;
  invisible: boolean;
  inverse: boolean;
  underlineColor: string | null;
  url: string | null;
  repeats: number;
}

export type AppLineContinuation = 'hard-eol' | 'soft-eol' | 'none';

export interface AppLine {
  index: number;
  text: string;
  styles: AppCellStyleRun[];
  continuation: AppLineContinuation;
}

export type AppKeystrokeAction = 'key-down' | 'key-up' | 'flags-changed';
export type AppKeystrokeModifier =
  | 'control'
  | 'option'
  | 'command'
  | 'shift'
  | 'function'
  | 'numpad';

// [LAW:one-source-of-truth] The canonical-string targets for the keystroke/focus protocol enums. The
// converters' lookup tables map raw protocol values to these names when building a notification's
// information-complete spine payload.
export type AppWindowStatus = 'became-key' | 'is-current' | 'resigned-key';

export type AppNotificationKind =
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

export type AppVariableScope = 'app' | 'window' | 'tab' | 'session' | 'user';

export interface AppVariableChange {
  value: string;
  at: number;
}

export interface AppVariableEntry {
  name: string;
  value: string;
  previousValue: string | null;
  live: boolean;
  updatedAt: number;
  scope: AppVariableScope;
  // [LAW:one-source-of-truth] Bounded change record, most-recent-first; value/previousValue/updatedAt
  // are projections of history[0]/history[1] and never tracked independently.
  history: AppVariableChange[];
}

// [LAW:types-are-the-program] A probe either resolves to a value (iTerm2 encodes unset as the JSON
// string "null") or fails with a named, contextual reason — there is no third "unset" state the
// protocol lets us distinguish from a genuine null. Every variant echoes the evaluated entity scope
// and the raw expression so the result is self-describing even after focus moves on.
export type AppProbeResult =
  | { outcome: 'value'; entity: AppEntityRef; expression: string; value: string }
  | { outcome: 'error'; entity: AppEntityRef; expression: string; message: string };

// ───────────────────────────────────────────────────────────────────────────
// The unified event spine.
//
// [LAW:one-source-of-truth] Every observation the app makes — a wire frame, a
// classified notification, a variable change — is one AppEvent in one
// append-only log. The per-domain panes are filtered projections of this log,
// never independent islands that can drift from it.
//
// [LAW:one-type-per-behavior] The three observations differ ONLY by `kind` and
// the shape of `payload`; everything they share (identity, time, provenance,
// scope) lives on the common base. Adding the write side (actions/invocations,
// 449.7.6) is a new `kind`, not a new log.
//
// Provenance is CARRIED, never reconstructed: `frameSeq` is the protocol-frame
// identity minted once at the transport boundary. A subscription-driven change,
// the notification that announced it, and the wire frame that carried it all
// share one `frameSeq` and join on it like a foreign key — with zero timestamp
// windowing ([LAW:no-ambient-temporal-coupling]).

export type AppEventKind =
  | 'wire-frame'
  | 'notification'
  | 'variable-change'
  | 'action'
  | 'invocation';

// The eight things a user can do to the focused entity. One closed set ([LAW:no-mode-explosion]):
// every console affordance is one of these, distinguished by `kind` and the shape of its payload.
export type AppActionKind =
  | 'send-text'
  | 'inject'
  | 'activate'
  | 'menu-item'
  | 'invoke-function'
  | 'restart-session'
  | 'close'
  | 'raw-protobuf';

// [LAW:one-source-of-truth] The canonical result of firing an action, used both as the value returned
// to the renderer and as the `result` recorded on the action AppEvent. `requestId` is the protocol
// message id of the request this action put on the wire — the foreign key that joins the action to
// the request/response wire frames it produced — or null when the action never reached the wire
// (local validation failed, or not connected). It is the action's honest tie to the spine: an action
// is not decoded from a frame, so it carries no frameSeq; it joins by the id it caused instead.
export interface AppActionResult {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  responseCase: string | null;
  payload: Record<string, unknown> | null;
  requestId: string | null;
}

export interface AppWireFramePayload {
  direction: 'out' | 'in';
  size: number;
  // The decoded protobuf submessage case (e.g. 'notification', 'variableResponse'), or a
  // '(decode-failed)'/'(empty)' marker — decoded once here at production, never re-parsed on read.
  messageKind: string;
  requestId: string;
}

export interface AppNotificationPayload {
  kind: AppNotificationKind;
  sessionId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
}

// [LAW:types-are-the-program] `source` makes the live-vs-dump distinction representable rather than
// inferred: a 'subscription' change shares its frameSeq with a notification event, a 'dump' change
// shares its frameSeq with a wire frame ONLY (the absence of a notification at that frameSeq is the
// distinction, not a guess).
export type AppVariableChangeSource = 'subscription' | 'dump';

export interface AppVariableChangePayload {
  name: string;
  value: string;
  previousValue: string | null;
  scope: AppVariableScope;
  source: AppVariableChangeSource;
}

export interface AppActionPayload {
  action: AppActionKind;
  // The resolved protocol args the action was fired with. Any explicit target override the user typed
  // lives here as action-local data; the entity the action was scoped to lives on the event's `entity`.
  args: Record<string, unknown>;
  result: AppActionResult;
}

export interface AppInvocationPayload {
  rpcName: string;
  // The registration this RPC matched, or '' when iTerm2 invoked a name we have no registration for.
  registrationId: string;
  requestId: string;
  args: Record<string, unknown>;
  responded: boolean;
  responseJson: string;
  error: string | null;
}

interface AppEventBase {
  // Monotonic append order across the whole log; the log is its single owner.
  seq: number;
  at: number;
  entity: AppEntityRef;
  // The seq of a prior event this one was caused by (action -> notification -> change). Always null
  // on the read side; the write side links invocations to their effects.
  causedBy: number | null;
}

// [LAW:types-are-the-program] `frameSeq` lives on each variant, not the base, because it is the one
// field whose nullability varies by kind. Every read-side event is produced FROM a protocol frame,
// so it always carries a real frameSeq — a wire-frame event with no frame is not a state that can
// exist, and the type refuses to represent it (no `| null`, no cast at the read site). The write
// side (449.7.6) introduces its own variants that may omit frameSeq; that is the moment the null
// becomes a real state, modelled then on the variant that actually has it.
export type AppEvent =
  | (AppEventBase & { kind: 'wire-frame'; frameSeq: number; payload: AppWireFramePayload })
  | (AppEventBase & { kind: 'notification'; frameSeq: number; payload: AppNotificationPayload })
  | (AppEventBase & { kind: 'variable-change'; frameSeq: number; payload: AppVariableChangePayload })
  // [LAW:types-are-the-program] An action is user-originated: it is the CAUSE of frames, not a
  // projection of one, so it carries NO frameSeq (the field is absent, not nullable) and causedBy is
  // null (nothing prior caused the user's intent). Its tie to the wire is `payload.result.requestId`,
  // joining to the request/response frames it produced. The append-only log lands the action AFTER
  // those frames, so a frame can never point back at it — consistent with causedBy meaning "a PRIOR
  // event".
  | (AppEventBase & { kind: 'action'; payload: AppActionPayload })
  // An invocation IS produced from the inbound server-RPC notification frame, so it carries that
  // frameSeq, and causedBy is the seq of the notification event that announced it — the one honest
  // seq-pointer causal link in the spine (the notification is genuinely prior).
  | (AppEventBase & { kind: 'invocation'; frameSeq: number; payload: AppInvocationPayload });

// [LAW:types-are-the-program] A producer hands the log everything but the seq. This must distribute
// over the union so each variant keeps its OWN shape — a plain `Omit<AppEvent, 'seq'>` would intersect
// the members and drop `frameSeq` (absent on the action variant) from all of them.
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type AppEventInput = DistributiveOmit<AppEvent, 'seq'>;

// [LAW:single-enforcer] The one place that knows which event variants are frame-derived. An action is
// the sole frameSeq-absent variant; everything that joins, evicts, or bookkeeps by frame asks here
// rather than reaching for `.frameSeq` (which the action variant does not have).
export function eventFrameSeq(event: AppEvent): number | null {
  return event.kind === 'action' ? null : event.frameSeq;
}

export interface AppEventLogSnapshot {
  events: AppEvent[];
  totalSeen: number;
  capacity: number;
  // The oldest frameSeq still retained in the ring. A frameSeq below this was evicted: a join that
  // lands here degrades loudly ('frame N (evicted)') instead of silently jumping to the wrong frame.
  oldestFrameSeq: number | null;
}

export function flatSessions(tab: AppTab): AppSession[] {
  // [LAW:one-source-of-truth] iTerm2 tab sessions include split-tree and minimized sessions.
  if (!tab.root) return tab.minimizedSessions;
  const out: AppSession[] = [];
  const walk = (children: AppSplitChild[]) => {
    for (const c of children) {
      if (c.kind === 'session') out.push(c.session);
      else walk(c.node.children);
    }
  };
  walk(tab.root.children);
  return [...out, ...tab.minimizedSessions];
}
