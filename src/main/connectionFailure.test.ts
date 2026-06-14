import { describe, it, expect } from 'vitest';
import { classifyConnectionFailure, isAutomationDenied } from './connectionFailure';

// [LAW:behavior-not-structure] The contract: a raw connection-error string is classified as the
// recoverable Automation denial iff it carries the TCC signal, and every other cause passes through
// verbatim. The accept/reject table is the spec — each row is one shape the classifier must judge.
describe('isAutomationDenied', () => {
  const ACCEPT: ReadonlyArray<[string, string]> = [
    ['code -1743 in stderr', 'execution error: Not authorized to send Apple events to iTerm2. (-1743)'],
    ['code -1744 (consent required)', 'execution error: iTerm got an error. (-1744)'],
    ['text only, no code', 'osascript failed: Not authorized to send Apple events to iTerm2.'],
    ['driver-wrapped message', 'osascript failed: Command failed ... Not authorized to send Apple events to iTerm2. (-1743)'],
  ];
  const REJECT: ReadonlyArray<[string, string]> = [
    ['app not running (-600)', 'execution error: Application isn’t running. (-600)'],
    ['app not running (-609)', 'execution error: Connection is invalid. (-609)'],
    ['unrelated AppleScript error', 'osascript returned unexpected output: '],
    ['empty', ''],
    ['lookalike non-code digits', 'value was -17430 milliseconds'],
    ['socket missing', 'iTerm2 private socket not found. Is iTerm2 running?'],
  ];

  it.each(ACCEPT)('accepts %s', (_label, message) => {
    expect(isAutomationDenied(message)).toBe(true);
  });
  it.each(REJECT)('rejects %s', (_label, message) => {
    expect(isAutomationDenied(message)).toBe(false);
  });
});

describe('classifyConnectionFailure', () => {
  it('maps a denial to a recoverable kind with a settings-pointing message', () => {
    const failure = classifyConnectionFailure(
      'execution error: Not authorized to send Apple events to iTerm2. (-1743)',
    );
    expect(failure.kind).toBe('automation-denied');
    expect(failure.message).toMatch(/Privacy & Security/);
    expect(failure.message).toMatch(/Automation/);
  });

  it('carries any other cause verbatim under kind "other"', () => {
    const raw = 'iTerm2 private socket not found at /tmp/socket. Is iTerm2 running?';
    expect(classifyConnectionFailure(raw)).toEqual({ kind: 'other', message: raw });
  });
});
