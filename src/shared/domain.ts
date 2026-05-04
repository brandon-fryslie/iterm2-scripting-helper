// Canonical in-app types mirroring the iTerm2 protobuf API.
// Every protobuf message has exactly one corresponding canonical type here.
// These types are JSON-serializable (they cross IPC) and contain no protobuf imports.

// --- Geometry (from Frame, Size, Point) ---

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

// --- Layout (from ListSessionsResponse) ---

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

// --- Screen (from GetBufferResponse, CellStyle, LineContents) ---

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

// --- Keystroke (from KeystrokeNotification) ---

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

// --- Prompt (from PromptNotification) ---

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

// --- Focus (from FocusChangedNotification) ---

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

// --- Notification (from Notification) ---

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

// --- Variable (from VariableChangedNotification) ---

export type AppVariableScope = 'session' | 'tab' | 'window' | 'app';

export interface AppVariableEntry {
  name: string;
  value: string;
  live: boolean;
  updatedAt: number;
  scope: AppVariableScope;
}

// --- Utilities ---

/** Flatten a tab's split tree into a flat session list. */
export function flatSessions(tab: AppTab): AppSession[] {
  if (!tab.root) return [];
  const out: AppSession[] = [];
  const walk = (children: AppSplitChild[]) => {
    for (const c of children) {
      if (c.kind === 'session') out.push(c.session);
      else walk(c.node.children);
    }
  };
  walk(tab.root.children);
  return out;
}
