import type { ScreenSnapshot } from '@shared/rpc';

// [LAW:types-are-the-program] The three states a screen can be in relative to the focused entity, made
// exhaustive so every consumer renders all of them. `none` = no session is focused (the app/window/tab
// levels have no screen); `pending` = a session is focused but its screen mirror has not arrived yet (or
// belongs to a previous focus); `live` = the mirror matches the focus and carries content. Folding
// "is there a session", "does the mirror match", and "does it have content" into one discriminant makes
// "live screen without a session" and "cursor without lines" unrepresentable. [FRAMING:representation]
export type ScreenContext =
  | { status: 'none' }
  | { status: 'pending'; sessionId: string }
  | {
      status: 'live';
      sessionId: string;
      lineCount: number;
      cursor: { x: number; y: number } | null;
    };

// [LAW:one-source-of-truth] The single classifier for "is the screen mirror live for the focused
// session". Both the Screen pane (which renders the mirror) and the live context strip (which summarizes
// it) read this one function instead of each re-deriving the same `sessionId match && non-empty` edge —
// the predicate that decides whether the xterm viewport shows real content is the same predicate that
// decides whether the strip shows a line/cursor count. [LAW:effects-at-boundaries] Pure over its inputs,
// so it is unit-testable without a running app.
export function screenContextForFocus(
  focusedSessionId: string | null,
  screen: ScreenSnapshot,
): ScreenContext {
  if (focusedSessionId === null) return { status: 'none' };
  if (screen.sessionId !== focusedSessionId || screen.lines.length === 0) {
    return { status: 'pending', sessionId: focusedSessionId };
  }
  return {
    status: 'live',
    sessionId: focusedSessionId,
    lineCount: screen.lines.length,
    cursor: screen.cursor,
  };
}
