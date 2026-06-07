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

export type AppVariableScope = AppEntityKind;

export interface AppVariableEntry {
  name: string;
  value: string;
  live: boolean;
  updatedAt: number;
  scope: AppVariableScope;
}

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
