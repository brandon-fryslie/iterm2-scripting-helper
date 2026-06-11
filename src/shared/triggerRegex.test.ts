import { describe, it, expect } from 'vitest';
import { classifyTriggerRegex, evaluateTrigger } from './triggerRegex';

// The accept/reject table for the ICU-vs-JS portability line. Every MUST-FLAG row is an ICU
// construct JS silently mis-evaluates (or rejects); every MUST-NOT-FLAG row is a near-miss that
// is portable and must keep working. [LAW:no-silent-failure]

describe('classifyTriggerRegex — MUST FLAG (ICU-divergent)', () => {
  const flagged: Array<[string, string]> = [
    [String.raw`\Afoo`, 'start-of-input anchor'],
    [String.raw`foo\Z`, 'end-of-input anchor (Z)'],
    [String.raw`foo\z`, 'end-of-input anchor (z)'],
    [String.raw`\Gfoo`, 'end-of-previous-match anchor'],
    [String.raw`\h+name`, 'horizontal whitespace'],
    [String.raw`\H`, 'non-horizontal-whitespace'],
    [String.raw`end\R`, 'any-newline'],
    [String.raw`\X`, 'grapheme cluster'],
    [String.raw`\N{BULLET}`, 'named character'],
    [String.raw`\Qa.b\E`, 'literal quoting'],
    [String.raw`\v+`, 'ICU vertical-whitespace class vs JS U+000B'],
    [String.raw`\V`, 'non-vertical-whitespace'],
    [String.raw`\p{Letter}+`, 'Unicode property'],
    [String.raw`\P{Nd}`, 'negated Unicode property'],
    ['a*+b', 'possessive star'],
    ['a++b', 'possessive plus'],
    ['a?+b', 'possessive optional'],
    ['a{2}+b', 'possessive bounded'],
    ['(?i)error', 'inline flags'],
    ['(?i:error)', 'scoped inline flags'],
    ['(?-s:x)', 'negated inline flags'],
    ['[[:alpha:]]+', 'POSIX class inside a set'],
    ['[:digit:]', 'bare POSIX class'],
    ['[a-z&&[^aeiou]]', 'set intersection (also nested set)'],
    ['[a[b]]', 'nested set'],
    [String.raw`x\\\Ay`, 'escaped backslash then a REAL \\A escape'],
  ];
  it.each(flagged)('%s (%s)', (pattern) => {
    expect(classifyTriggerRegex(pattern).kind).toBe('icu-divergent');
  });

  it('names every distinct construct it found', () => {
    const r = classifyTriggerRegex(String.raw`\Afoo\h+(?i)bar`);
    if (r.kind !== 'icu-divergent') throw new Error('expected icu-divergent');
    expect(r.constructs).toHaveLength(3);
  });
});

describe('classifyTriggerRegex — MUST NOT FLAG (portable near-misses)', () => {
  const portable: string[] = [
    '',
    'plain text',
    String.raw`^ERROR: (\d+)$`,
    String.raw`\d+\s\w\S\W\D\b\B\n\t\r\f\0`,
    String.raw`\\R literal backslash then R`, // escaped backslash; the R is just a letter
    String.raw`\\\\Av`, // two escaped backslashes; A is a letter
    '(?:group)(?=ahead)(?!not)(?<=behind)(?<!notbehind)(?<name>x)',
    'a+? lazy, not possessive',
    'a+ b* c? d{2,3}',
    String.raw`\}+ quantified escaped brace`,
    'literal && outside a class',
    '[a-z:&]single & and : inside a class',
    String.raw`[\[\]] escaped brackets in a class`,
    String.raw`price \$\d+`,
  ];
  it.each(portable)('%s', (pattern) => {
    expect(classifyTriggerRegex(pattern)).toEqual({ kind: 'portable' });
  });
});

describe('evaluateTrigger — every outcome is its own state', () => {
  const lines = ['first line', 'ERROR: 42 happened', 'last line'];

  it('fires with the line and the exact match', () => {
    expect(evaluateTrigger(String.raw`ERROR: (\d+)`, lines)).toEqual({
      kind: 'fired',
      lineIndex: 1,
      lineText: 'ERROR: 42 happened',
      matched: 'ERROR: 42',
    });
  });

  it('reports the FIRST firing line', () => {
    const r = evaluateTrigger('line', lines);
    expect(r).toMatchObject({ kind: 'fired', lineIndex: 0 });
  });

  it('no-match is only claimed for a faithfully evaluated pattern', () => {
    expect(evaluateTrigger('absent', lines)).toEqual({ kind: 'no-match' });
  });

  it('an ICU-only construct is untestable, never a false no-match', () => {
    const r = evaluateTrigger(String.raw`\herror`, lines);
    expect(r.kind).toBe('untestable');
  });

  it('a JS-rejected pattern is js-invalid, never "invalid trigger"', () => {
    const r = evaluateTrigger('(unclosed', lines);
    if (r.kind !== 'js-invalid') throw new Error(`expected js-invalid, got ${r.kind}`);
    expect(r.error).not.toBe('');
  });

  it('a missing regex and an empty sample are distinct from no-match', () => {
    expect(evaluateTrigger(undefined, lines)).toEqual({ kind: 'no-regex' });
    expect(evaluateTrigger('', lines)).toEqual({ kind: 'no-regex' });
    expect(evaluateTrigger('x', [])).toEqual({ kind: 'no-input' });
  });
});
