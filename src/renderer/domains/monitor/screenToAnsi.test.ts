import { describe, it, expect } from 'vitest';
import { cursorToViewport } from './screenToAnsi';

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
