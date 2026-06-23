import { describe, it, expect } from 'vitest';
import type { AppLine } from '@shared/domain';
import type { ScreenSnapshot } from '@shared/rpc';
import { screenContextForFocus } from './screenContext';

function line(index: number): AppLine {
  return { index, text: '', styles: [], continuation: 'hard-eol' };
}

function screen(over: Partial<ScreenSnapshot>): ScreenSnapshot {
  return {
    sessionId: null,
    lines: [],
    cursor: null,
    lastUpdatedAt: 0,
    requestsInflight: 0,
    updatesReceived: 0,
    lastError: null,
    ...over,
  };
}

// These pin the single predicate that decides whether the screen mirror is showing real content for the
// focused session — shared by the Screen pane and the live context strip, so a drift here would desync
// the xterm viewport from the strip's line/cursor readout.
describe('screenContextForFocus', () => {
  it('is none when no session is focused, regardless of mirror contents', () => {
    expect(screenContextForFocus(null, screen({ sessionId: 's1', lines: [line(0)] }))).toEqual({
      status: 'none',
    });
  });

  it('is pending when the mirror belongs to a different session than the focus', () => {
    expect(
      screenContextForFocus('s1', screen({ sessionId: 's2', lines: [line(0)] })),
    ).toEqual({ status: 'pending', sessionId: 's1' });
  });

  it('is pending when the mirror matches the focus but has not arrived yet', () => {
    expect(screenContextForFocus('s1', screen({ sessionId: 's1', lines: [] }))).toEqual({
      status: 'pending',
      sessionId: 's1',
    });
  });

  it('is live with line count and cursor when the mirror matches and has content', () => {
    expect(
      screenContextForFocus(
        's1',
        screen({ sessionId: 's1', lines: [line(0), line(1), line(2)], cursor: { x: 4, y: 1 } }),
      ),
    ).toEqual({ status: 'live', sessionId: 's1', lineCount: 3, cursor: { x: 4, y: 1 } });
  });

  it('is live with a null cursor when content exists but no cursor was reported', () => {
    expect(
      screenContextForFocus('s1', screen({ sessionId: 's1', lines: [line(0)], cursor: null })),
    ).toEqual({ status: 'live', sessionId: 's1', lineCount: 1, cursor: null });
  });
});
