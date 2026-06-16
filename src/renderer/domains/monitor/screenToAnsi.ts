import type { AppLine } from '@shared/domain';

export function styledLinesToAnsi(lines: AppLine[]): string {
  const parts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) parts.push('\r\n');
    const { text, styles } = lines[i];
    let col = 0;

    for (const run of styles) {
      const count = run.repeats;
      const slice = text.slice(col, col + count);
      if (slice.length === 0) break;
      const sgr = buildSgr(run);
      if (sgr) {
        parts.push(sgr);
        parts.push(slice);
        parts.push('\x1b[0m');
      } else {
        parts.push(slice);
      }
      col += count;
    }

    if (col < text.length) {
      parts.push(text.slice(col));
    }
  }

  return parts.join('');
}

// Map an iTerm2 buffer-relative cursor onto a viewport that shows the last `rows` lines of the
// buffer. [FRAMING:representation] cursor.y is a buffer index (0 = first fetched line); ANSI
// `\x1b[row;colH` is 1-based and viewport-relative. The viewport's top line is `startIdx` lines
// down the buffer, so the cursor's screen row is its index minus that. Returns 1-based row/col
// clamped to the viewport. This is the single source of truth for that translation; conflating the
// two coordinate spaces is the off-by-N (one per line below the cursor) bug it exists to prevent.
export function cursorToViewport(
  cursor: { x: number; y: number },
  startIdx: number,
  rows: number,
  cols: number,
): { row: number; col: number } {
  return {
    row: Math.min(Math.max(1, cursor.y - startIdx + 1), rows),
    col: Math.min(cursor.x + 1, cols),
  };
}

function buildSgr(run: {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
}): string | null {
  const codes: string[] = [];

  if (run.bold) codes.push('1');
  if (run.faint) codes.push('2');
  if (run.italic) codes.push('3');
  if (run.underline) codes.push('4');
  if (run.inverse) codes.push('7');
  if (run.strikethrough) codes.push('9');

  if (run.fg) codes.push(rgbToSgr(38, run.fg));
  if (run.bg) codes.push(rgbToSgr(48, run.bg));

  if (codes.length === 0) return null;
  return `\x1b[${codes.join(';')}m`;
}

function rgbToSgr(prefix: number, hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${prefix};2;${r};${g};${b}`;
}
