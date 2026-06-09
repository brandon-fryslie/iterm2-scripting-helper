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

export interface AppKeystrokeEntry {
  seq: number;
  at: number;
  sessionId: string;
  characters: string;
  charactersIgnoringModifiers: string;
  modifiers: AppKeystrokeModifier[];
  keyCode: number;
  action: AppKeystrokeAction;
}

export type AppPromptEventKind = 'prompt' | 'command-start' | 'command-end';

export interface AppPromptEntry {
  seq: number;
  at: number;
  sessionId: string;
  uniquePromptId: string;
  kind: AppPromptEventKind;
  command: string | null;
  status: number | null;
  placeholder: string | null;
  workingDirectory: string | null;
}

export type AppFocusEventKind =
  | 'app-active'
  | 'app-inactive'
  | 'window'
  | 'selected-tab'
  | 'session'
  | 'unknown';

export type AppWindowStatus = 'became-key' | 'is-current' | 'resigned-key';

export interface AppFocusEntry {
  seq: number;
  at: number;
  kind: AppFocusEventKind;
  summary: string;
  sessionId: string | null;
  windowId: string | null;
  windowStatus: AppWindowStatus | null;
}

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

export interface AppNotificationEntry {
  seq: number;
  at: number;
  kind: AppNotificationKind;
  sessionId: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
}

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

export type AppEventKind = 'wire-frame' | 'notification' | 'variable-change';

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
  | (AppEventBase & { kind: 'variable-change'; frameSeq: number; payload: AppVariableChangePayload });

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
