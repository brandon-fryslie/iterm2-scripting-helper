import { describe, it, expect } from 'vitest';
import type { AppCellStyleRun, AppLine } from '@shared/domain';
import { cursorToViewport, styledLinesToAnsi } from './screenToAnsi';

// A style run with neutral defaults; tests override only the fields under test.
function run(partial: Partial<AppCellStyleRun> & { repeats: number }): AppCellStyleRun {
  return {
    fg: null,
    bg: null,
    bold: false,
    faint: false,
    italic: false,
    blink: false,
    underline: false,
    strikethrough: false,
    invisible: false,
    inverse: false,
    underlineColor: null,
    url: null,
    ...partial,
  };
}

function line(text: string, styles: AppCellStyleRun[]): AppLine {
  return { index: 0, text, styles, continuation: 'hard-eol' };
}

// OSC-8 open is `ESC ] 8 ; ; <uri> ST`, close is `ESC ] 8 ; ; ST`, where ST is `ESC \`.
const OPEN = (uri: string) => `\x1b]8;;${uri}\x1b\\`;
const CLOSE = '\x1b]8;;\x1b\\';

// startIdx is how many lines sit above the viewport: max(0, lineCount - rows).
// These tests pin the buffer-index -> viewport-row translation that the screen
// renderer depends on, including the regression where a cursor sitting N lines
// above the bottom of the buffer rendered N rows too low.
describe('cursorToViewport', () => {
  it('maps directly when the buffer fits the viewport (no scroll)', () => {
    // 5 lines, 40 rows -> startIdx 0; cursor on line index 4 -> ANSI row 5.
    expect(cursorToViewport({ x: 0, y: 4 }, 0, 40, 80)).toEqual({ row: 5, col: 1 });
  });

  it('places a cursor sitting 2 lines above the buffer bottom 2 rows above the viewport bottom', () => {
    // The reported bug: 1000-line buffer, 40 rows -> startIdx 960. Cursor on line
    // 997 (two trailing lines below it) must land on row 38, not clamped to 40.
    expect(cursorToViewport({ x: 0, y: 997 }, 960, 40, 80)).toEqual({ row: 38, col: 1 });
  });

  it('places a cursor on the last buffer line at the viewport bottom', () => {
    expect(cursorToViewport({ x: 0, y: 999 }, 960, 40, 80)).toEqual({ row: 40, col: 1 });
  });

  it('clamps a cursor above the visible window to row 1', () => {
    // Cursor scrolled off the top of the viewport -> never negative/zero.
    expect(cursorToViewport({ x: 3, y: 2 }, 10, 40, 80).row).toBe(1);
  });

  it('clamps a cursor below the viewport to the last row', () => {
    expect(cursorToViewport({ x: 0, y: 200 }, 0, 40, 80).row).toBe(40);
  });

  it('translates the column 0-based to 1-based and clamps to cols', () => {
    expect(cursorToViewport({ x: 7, y: 0 }, 0, 40, 80).col).toBe(8);
    expect(cursorToViewport({ x: 200, y: 0 }, 0, 40, 80).col).toBe(80);
  });
});

describe('styledLinesToAnsi OSC-8 hyperlinks', () => {
  it('wraps a url-carrying run in an OSC-8 open/close pair around the text', () => {
    const out = styledLinesToAnsi([line('click', [run({ repeats: 5, url: 'https://example.com' })])]);
    expect(out).toBe(`${OPEN('https://example.com')}click${CLOSE}`);
  });

  it('emits no link sequence when a run has no url', () => {
    const out = styledLinesToAnsi([line('plain', [run({ repeats: 5 })])]);
    expect(out).toBe('plain');
    expect(out).not.toContain('\x1b]8;');
  });

  it('nests SGR styling inside the hyperlink so a styled link both colors and links', () => {
    const out = styledLinesToAnsi([line('go', [run({ repeats: 2, bold: true, url: 'https://x.io' })])]);
    // link-open, then SGR (bold), text, SGR reset, then link-close — one wrap per run.
    expect(out).toBe(`${OPEN('https://x.io')}\x1b[1mgo\x1b[0m${CLOSE}`);
  });

  it('links only the run that carries a url, leaving adjacent plain runs untouched', () => {
    const out = styledLinesToAnsi([
      line('abcd', [run({ repeats: 2 }), run({ repeats: 2, url: 'https://y.io' })]),
    ]);
    expect(out).toBe(`ab${OPEN('https://y.io')}cd${CLOSE}`);
  });
});
