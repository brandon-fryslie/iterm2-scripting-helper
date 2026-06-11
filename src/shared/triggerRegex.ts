// iTerm2 evaluates trigger regexes with the ICU regex engine; this app can only run JavaScript
// RegExp. The two engines silently disagree on a known set of constructs — ICU anchors like \A
// become the literal letter 'A' in JS, POSIX classes become character soups, possessive
// quantifiers become syntax errors. Evaluating such a pattern with JS and reporting the result
// as "what iTerm2 would do" is a lie. [FRAMING:representation]
//
// So evaluation is split into two pure stages:
//   1. classifyTriggerRegex — scan for constructs whose ICU meaning JS cannot reproduce.
//   2. evaluateTrigger — only patterns that pass classification are run; every other outcome is
//      its own explicit state, never collapsed into a false "no match". [LAW:no-silent-failure]

export type TriggerRegexPortability =
  | { kind: 'portable' }
  | { kind: 'icu-divergent'; constructs: string[] };

// [LAW:types-are-the-program] One state per genuinely different answer the tester can give.
// 'js-invalid' is deliberately NOT "invalid trigger": a pattern JS rejects may still be valid
// ICU, so the only honest claim is "cannot test here".
export type TriggerTestResult =
  | { kind: 'no-regex' }
  | { kind: 'untestable'; constructs: string[] }
  | { kind: 'js-invalid'; error: string }
  | { kind: 'no-input' }
  | { kind: 'no-match' }
  | { kind: 'fired'; lineIndex: number; lineText: string; matched: string };

// ICU escapes whose JS meaning silently differs (JS treats most as an identity escape — the bare
// literal letter — and \v/\V as the single U+000B character vs ICU's vertical-whitespace class).
const DIVERGENT_ESCAPES: Record<string, string> = {
  A: String.raw`\A (ICU start-of-input anchor; JS matches literal "A")`,
  Z: String.raw`\Z (ICU end-of-input anchor; JS matches literal "Z")`,
  z: String.raw`\z (ICU end-of-input anchor; JS matches literal "z")`,
  G: String.raw`\G (ICU end-of-previous-match anchor; JS matches literal "G")`,
  h: String.raw`\h (ICU horizontal whitespace; JS matches literal "h")`,
  H: String.raw`\H (ICU non-horizontal-whitespace; JS matches literal "H")`,
  R: String.raw`\R (ICU any-newline; JS matches literal "R")`,
  X: String.raw`\X (ICU grapheme cluster; JS matches literal "X")`,
  N: String.raw`\N{...} (ICU named character; JS matches literal "N")`,
  Q: String.raw`\Q...\E (ICU literal quoting; JS matches literal "Q")`,
  E: String.raw`\Q...\E (ICU literal quoting; JS matches literal "E")`,
  v: String.raw`\v (ICU any vertical whitespace; JS matches only U+000B)`,
  V: String.raw`\V (ICU non-vertical-whitespace; JS matches literal "V")`,
  p: String.raw`\p{...} (ICU Unicode property; JS without /u matches literal "p")`,
  P: String.raw`\P{...} (ICU Unicode property; JS without /u matches literal "P")`,
};

// At least one flag character, so portable groups — (?: (?= (?! (?<= (?<! (?<name> — never match.
const INLINE_FLAG_GROUP = /^\(\?[a-zA-Z-]+[):]/;

export function classifyTriggerRegex(pattern: string): TriggerRegexPortability {
  const constructs = new Set<string>();
  let inClass = false;
  // The previous UNESCAPED character — '' after an escape, so a quantifier riding on an escaped
  // literal (\}+ \++) is never mistaken for an ICU possessive form.
  let prev = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next !== undefined && next in DIVERGENT_ESCAPES) {
        constructs.add(DIVERGENT_ESCAPES[next]);
      }
      i++; // the escaped character is consumed; it can open nothing
      prev = '';
      continue;
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false;
      } else if (ch === '[') {
        if (pattern.startsWith('[:', i) && pattern.indexOf(':]', i + 2) !== -1) {
          constructs.add('[:name:] (ICU POSIX class; JS matches the literal characters)');
        } else {
          constructs.add('[...[...]] (ICU nested set; JS matches a literal "[")');
        }
      } else if (ch === '&' && pattern[i + 1] === '&') {
        constructs.add('&& (ICU set intersection; JS matches literal "&&")');
        i++;
        prev = '';
        continue;
      }
      prev = ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      // ICU also honors [:name:] as a whole set, which JS reads as a class of literals.
      if (pattern.startsWith('[:', i) && pattern.indexOf(':]', i + 2) !== -1) {
        constructs.add('[:name:] (ICU POSIX class; JS matches the literal characters)');
      }
      prev = ch;
      continue;
    }
    if (ch === '(' && INLINE_FLAG_GROUP.test(pattern.slice(i))) {
      constructs.add('(?flags) (ICU inline flags; JS rejects the syntax)');
      prev = ch;
      continue;
    }
    if (ch === '+' && prev !== '' && '*+?}'.includes(prev)) {
      // A '+' riding directly on another quantifier is ICU's possessive form.
      constructs.add('*+/++/?+/{n}+ (ICU possessive quantifier; JS rejects the syntax)');
      prev = ch;
      continue;
    }
    prev = ch;
  }
  return constructs.size > 0
    ? { kind: 'icu-divergent', constructs: [...constructs] }
    : { kind: 'portable' };
}

// Triggers fire per line of terminal output; the first firing line is reported.
export function evaluateTrigger(
  regex: string | undefined,
  lines: string[],
): TriggerTestResult {
  if (!regex) return { kind: 'no-regex' };
  const portability = classifyTriggerRegex(regex);
  if (portability.kind === 'icu-divergent') {
    return { kind: 'untestable', constructs: portability.constructs };
  }
  let re: RegExp;
  try {
    re = new RegExp(regex);
  } catch (err) {
    return { kind: 'js-invalid', error: err instanceof Error ? err.message : String(err) };
  }
  if (lines.length === 0) return { kind: 'no-input' };
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) return { kind: 'fired', lineIndex: i, lineText: lines[i], matched: m[0] };
  }
  return { kind: 'no-match' };
}
