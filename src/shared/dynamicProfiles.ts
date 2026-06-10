// Dynamic Profile file semantics, per https://iterm2.com/documentation-dynamic-profiles.html:
// the folder holds property lists (JSON, XML, or binary plist) shaped { "Profiles": [...] };
// every profile requires "Guid" and "Name"; "Dynamic Profile Parent GUID" (3.4.9+) takes
// precedence over "Dynamic Profile Parent Name"; an unresolved parent falls back to the default
// profile; and one malformed file blocks iTerm2 from processing ANY dynamic profile changes.
//
// [LAW:single-enforcer] This module is the only place that decides what a dynamic-profile body
// means. The main-process watcher ships raw file bodies; the renderer derives everything here —
// for disk files and for the live editor buffer alike, so the two can never disagree.
// [LAW:effects-at-boundaries] Everything here is pure: text in, analysis out.

export type ParentRef =
  | { by: 'guid'; value: string }
  | { by: 'name'; value: string };

export interface ProfileEntry {
  index: number;
  guid: string | null;
  name: string | null;
  parent: ParentRef | null;
  issues: string[];
}

// [LAW:types-are-the-program] Each kind is a genuinely distinct domain state with distinct
// consequences in iTerm2: 'json-error' and 'empty' poison the whole folder; 'plist' is accepted
// by iTerm2 but opaque to this JSON editor; 'shape-error' parses but contributes no profiles.
export type DynamicProfileAnalysis =
  | { kind: 'empty' }
  | { kind: 'plist' }
  | { kind: 'json-error'; message: string }
  | { kind: 'shape-error'; message: string }
  | { kind: 'profiles'; entries: ProfileEntry[] };

const PARENT_GUID_KEY = 'Dynamic Profile Parent GUID';
const PARENT_NAME_KEY = 'Dynamic Profile Parent Name';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parentRefOf(entry: Record<string, unknown>): ParentRef | null {
  const guid = nonEmptyString(entry[PARENT_GUID_KEY]);
  if (guid) return { by: 'guid', value: guid };
  const name = nonEmptyString(entry[PARENT_NAME_KEY]);
  if (name) return { by: 'name', value: name };
  return null;
}

function analyzeEntry(raw: unknown, index: number, guidCounts: Map<string, number>): ProfileEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      index,
      guid: null,
      name: null,
      parent: null,
      issues: ['entry is not an object'],
    };
  }
  const entry = raw as Record<string, unknown>;
  const guid = nonEmptyString(entry.Guid);
  const name = nonEmptyString(entry.Name);
  const issues: string[] = [];
  if (!guid) issues.push('missing required "Guid"');
  if (!name) issues.push('missing required "Name"');
  if (guid && (guidCounts.get(guid) ?? 0) > 1) {
    issues.push('duplicate "Guid" within this file');
  }
  return { index, guid, name, parent: parentRefOf(entry), issues };
}

export function analyzeDynamicProfile(body: string): DynamicProfileAnalysis {
  const trimmed = body.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<!DOCTYPE plist') ||
    trimmed.startsWith('bplist')
  ) {
    return { kind: 'plist' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return {
      kind: 'json-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'shape-error', message: 'top level must be an object' };
  }
  const profiles = (parsed as Record<string, unknown>).Profiles;
  if (profiles === undefined) {
    return { kind: 'shape-error', message: 'missing top-level "Profiles" key' };
  }
  if (!Array.isArray(profiles)) {
    return { kind: 'shape-error', message: '"Profiles" must be an array' };
  }

  const guidCounts = new Map<string, number>();
  for (const raw of profiles) {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const guid = nonEmptyString((raw as Record<string, unknown>).Guid);
      if (guid) guidCounts.set(guid, (guidCounts.get(guid) ?? 0) + 1);
    }
  }
  return {
    kind: 'profiles',
    entries: profiles.map((raw, index) => analyzeEntry(raw, index, guidCounts)),
  };
}

export interface ParentCandidate {
  guid: string;
  name: string;
  source: string;
}

// [LAW:types-are-the-program] The unresolved state is named by its real consequence — iTerm2
// falls back to the default profile — so the UI cannot render a vaguer story than the truth.
export type ParentResolution =
  | { state: 'none' }
  | { state: 'resolved'; ref: ParentRef; target: ParentCandidate }
  | { state: 'fallback-default'; ref: ParentRef };

export function parentCandidates(
  iterm2Profiles: ReadonlyArray<{ guid: string; name: string }>,
  files: ReadonlyArray<{ basename: string; analysis: DynamicProfileAnalysis }>,
): ParentCandidate[] {
  const fromApi = iterm2Profiles.map((p) => ({
    guid: p.guid,
    name: p.name,
    source: 'iTerm2',
  }));
  const fromFiles = files.flatMap(({ basename, analysis }) =>
    analysis.kind === 'profiles'
      ? analysis.entries.flatMap((e) =>
          e.guid !== null && e.name !== null
            ? [{ guid: e.guid, name: e.name, source: basename }]
            : [],
        )
      : [],
  );
  return [...fromApi, ...fromFiles];
}

export function resolveParent(
  parent: ParentRef | null,
  candidates: ReadonlyArray<ParentCandidate>,
): ParentResolution {
  if (parent === null) return { state: 'none' };
  const target = candidates.find((c) =>
    parent.by === 'guid' ? c.guid === parent.value : c.name === parent.value,
  );
  return target
    ? { state: 'resolved', ref: parent, target }
    : { state: 'fallback-default', ref: parent };
}

// One malformed property list makes iTerm2 skip processing the entire folder; surfacing which
// files are poisoning it is folder-level truth, not per-file truth, so it lives beside the
// per-file analysis rather than inside it. [LAW:decomposition]
export function folderBlockingFiles(
  files: ReadonlyArray<{ basename: string; analysis: DynamicProfileAnalysis }>,
): string[] {
  return files
    .filter((f) => f.analysis.kind === 'json-error' || f.analysis.kind === 'empty')
    .map((f) => f.basename);
}
