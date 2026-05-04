import type { StyledLine } from '@shared/rpc';

export function styledLinesToAnsi(
  lines: StyledLine[],
  cursor: { x: number; y: number } | null,
  termCols: number,
): string {
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

  if (cursor) {
    const row = Math.min(cursor.y + 1, lines.length);
    const col = Math.min(cursor.x + 1, termCols);
    parts.push(`\x1b[${row};${col}H`);
  }

  return parts.join('');
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
