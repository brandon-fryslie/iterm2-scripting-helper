import { describe, it, expect } from 'vitest';
import type { AppPrompt, AppPromptRange } from '@shared/domain';
import { extractPromptMarks } from './screenMarks';

// A prompt anchored at an absolute start line; tests override state/exit/command per case.
function rangeAt(line: number): AppPromptRange {
  return { start: { x: 0, line }, end: { x: 0, line } };
}

const editing = (line: number, command: string | null = null): AppPrompt => ({
  uniquePromptId: `p${line}`,
  promptRange: rangeAt(line),
  commandRange: null,
  outputRange: null,
  workingDirectory: null,
  command,
  state: 'editing',
});

const finished = (line: number, exitStatus: number, command: string | null = null): AppPrompt => ({
  uniquePromptId: `p${line}`,
  promptRange: rangeAt(line),
  commandRange: null,
  outputRange: null,
  workingDirectory: null,
  command,
  state: 'finished',
  exitStatus,
});

describe('extractPromptMarks', () => {
  it('returns an empty list for a session emitting no prompts (plain mirror)', () => {
    expect(extractPromptMarks([], 0, 50)).toEqual([]);
  });

  it('relativizes an absolute prompt line against the buffer base', () => {
    // baseLine 1000 means lines[0] is absolute line 1000; a prompt at absolute 1005 is buffer row 5.
    const marks = extractPromptMarks([editing(1005, 'ls')], 1000, 50);
    expect(marks).toEqual([
      { kind: 'prompt-boundary', bufferRow: 5, command: 'ls', status: 'pending' },
    ]);
  });

  it('flags a finished non-zero command as command-failed with its exit code', () => {
    const marks = extractPromptMarks([finished(10, 1, 'false')], 0, 50);
    expect(marks).toEqual([
      { kind: 'command-failed', bufferRow: 10, command: 'false', exitStatus: 1 },
    ]);
  });

  it('marks a finished zero-exit command as an ok boundary, not a failure', () => {
    const marks = extractPromptMarks([finished(10, 0, 'true')], 0, 50);
    expect(marks).toEqual([
      { kind: 'prompt-boundary', bufferRow: 10, command: 'true', status: 'ok' },
    ]);
  });

  it('drops a prompt whose start scrolled out of the mirrored window', () => {
    // base 1000, window of 50 lines covers absolute [1000, 1050). A prompt at 990 is above it; at 1100 below.
    expect(extractPromptMarks([editing(990), editing(1100)], 1000, 50)).toEqual([]);
  });

  it('drops a prompt that carries no region (unplaceable), keeping the rest', () => {
    const noRange: AppPrompt = { ...editing(5), promptRange: null };
    const marks = extractPromptMarks([noRange, editing(7, 'ok')], 0, 50);
    expect(marks).toEqual([
      { kind: 'prompt-boundary', bufferRow: 7, command: 'ok', status: 'pending' },
    ]);
  });

  it('maps several prompts in order, mixing failed and clean boundaries', () => {
    const marks = extractPromptMarks([finished(2, 0, 'a'), finished(8, 127, 'b'), editing(14, 'c')], 0, 50);
    expect(marks).toEqual([
      { kind: 'prompt-boundary', bufferRow: 2, command: 'a', status: 'ok' },
      { kind: 'command-failed', bufferRow: 8, command: 'b', exitStatus: 127 },
      { kind: 'prompt-boundary', bufferRow: 14, command: 'c', status: 'pending' },
    ]);
  });
});
