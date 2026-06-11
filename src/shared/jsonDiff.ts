// Structural diff over plain JSON values. One closed part: give it two values, get back the list
// of paths where they disagree. It knows nothing about arrangements, plists, or rendering —
// callers bring the values and present the entries. [LAW:composability]

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// [LAW:types-are-the-program] The three ways a path can disagree, each carrying exactly the sides
// it has: an 'added' entry has no `before`, a 'removed' entry has no `after` — those states are
// unrepresentable rather than null-filled.
export type JsonDiffEntry =
  | { kind: 'added'; path: string; after: JsonValue }
  | { kind: 'removed'; path: string; before: JsonValue }
  | { kind: 'changed'; path: string; before: JsonValue; after: JsonValue };

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(base: string, segment: string | number): string {
  return typeof segment === 'number' ? `${base}[${segment}]` : base === '' ? segment : `${base}.${segment}`;
}

function walk(path: string, before: JsonValue, after: JsonValue, out: JsonDiffEntry[]): void {
  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i++) walk(joinPath(path, i), before[i], after[i], out);
    for (let i = shared; i < before.length; i++) {
      out.push({ kind: 'removed', path: joinPath(path, i), before: before[i] });
    }
    for (let i = shared; i < after.length; i++) {
      out.push({ kind: 'added', path: joinPath(path, i), after: after[i] });
    }
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (key in after) walk(joinPath(path, key), before[key], after[key], out);
      else out.push({ kind: 'removed', path: joinPath(path, key), before: before[key] });
    }
    for (const key of Object.keys(after)) {
      if (!(key in before)) out.push({ kind: 'added', path: joinPath(path, key), after: after[key] });
    }
    return;
  }
  if (before !== after) {
    out.push({ kind: 'changed', path, before, after });
  }
}

export function diffJson(before: JsonValue, after: JsonValue): JsonDiffEntry[] {
  const out: JsonDiffEntry[] = [];
  walk('', before, after, out);
  return out;
}
