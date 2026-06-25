import type { AppPrompt } from '@shared/domain';

// [LAW:types-are-the-program] A semantic mark to overlay on the mirror, in BUFFER-relative coordinates
// (`bufferRow` = 0-based index into the fetched lines, the same space AppLine.index lives in). The kind
// is the prompt's OUTCOME, because that is exactly what the overlay renders differently — a still-running
// or clean boundary is a neutral divider; a failed command is flagged. Adding a future mark kind (an
// annotation span, a folded region) is a new variant here plus one arm in the exhaustive render switch:
// a value, not a branch scattered through the renderer. [LAW:dataflow-not-control-flow]
export type PromptMark =
  | { kind: 'prompt-boundary'; bufferRow: number; command: string | null; status: 'pending' | 'ok' }
  | { kind: 'command-failed'; bufferRow: number; command: string | null; exitStatus: number };

// [LAW:effects-at-boundaries] Pure over its inputs, so the whole prompt→marks translation is unit-testable
// without xterm or a live connection. [FRAMING:representation] iTerm2 reports prompt regions in ABSOLUTE
// line numbers; `baseLine` is the absolute line of the buffer's first row, so `promptRange.start.line -
// baseLine` is the row within the currently-mirrored window. A prompt whose start fell out of that window
// (scrolled past, or not yet within it) maps outside [0, lineCount) and is dropped — absence is the empty
// list, handled by the same map, never a guard that renders at a guessed row. A prompt with no
// promptRange (iTerm2 reported no region) is likewise unplaceable and dropped. [LAW:no-defensive-null-guards]
export function extractPromptMarks(
  prompts: AppPrompt[],
  baseLine: number,
  lineCount: number,
): PromptMark[] {
  const marks: PromptMark[] = [];
  for (const prompt of prompts) {
    if (!prompt.promptRange) continue;
    const bufferRow = prompt.promptRange.start.line - baseLine;
    if (bufferRow < 0 || bufferRow >= lineCount) continue;
    marks.push(toMark(prompt, bufferRow));
  }
  return marks;
}

// Exhaustive over the prompt's state: a finished command with a non-zero exit is the one failed case; a
// finished-zero or not-yet-finished prompt is a neutral boundary. The `state` discriminant guarantees an
// exitStatus is only read where it exists.
function toMark(prompt: AppPrompt, bufferRow: number): PromptMark {
  if (prompt.state === 'finished' && prompt.exitStatus !== 0) {
    return { kind: 'command-failed', bufferRow, command: prompt.command, exitStatus: prompt.exitStatus };
  }
  const status = prompt.state === 'finished' ? 'ok' : 'pending';
  return { kind: 'prompt-boundary', bufferRow, command: prompt.command, status };
}
