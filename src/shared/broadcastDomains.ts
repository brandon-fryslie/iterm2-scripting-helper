import { flatSessions, type AppSession, type AppWindow } from './domain';

// [LAW:types-are-the-program] The draft mirrors the wire exactly: SetBroadcastDomainsRequest is a
// list of session-id sets, replaced as one value. Disjointness — the engine's
// BROADCAST_DOMAINS_NOT_DISJOINT refusal — is unrepresentable under these ops: moveSession removes
// the session from every domain before inserting it anywhere, so "session in two domains" cannot
// be constructed. The same-window constraint depends on live layout the draft doesn't carry, so it
// stays a derived prediction (crossWindowDomainIndices), not a duplicate gate — the engine remains
// the single enforcer. [LAW:single-enforcer]
export type BroadcastDraft = string[][];

export function moveSession(
  draft: BroadcastDraft,
  sessionId: string,
  toDomainIndex: number | null,
): BroadcastDraft {
  const removed = draft.map((domain) => domain.filter((id) => id !== sessionId));
  if (toDomainIndex === null) return removed;
  return removed.map((domain, idx) =>
    idx === toDomainIndex ? [...domain, sessionId] : domain,
  );
}

export function addDomain(draft: BroadcastDraft): BroadcastDraft {
  return [...draft, []];
}

export function removeDomain(draft: BroadcastDraft, index: number): BroadcastDraft {
  return draft.filter((_, idx) => idx !== index);
}

// An empty domain is editor scaffolding (a drop target the user just created), not a statement
// about the engine; what gets applied is the table with scaffolding removed.
export function applyableDomains(draft: BroadcastDraft): BroadcastDraft {
  return draft.filter((domain) => domain.length > 0);
}

// Equality up to the orderings the wire does not assign meaning to: domain order and member order
// are presentation, membership is the fact. Empty domains are scaffolding and ignored.
export function domainsEqual(a: BroadcastDraft, b: BroadcastDraft): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(draft: BroadcastDraft): string[][] {
  return applyableDomains(draft)
    .map((domain) => [...domain].sort())
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

export function assignedSessionIds(draft: BroadcastDraft): Set<string> {
  return new Set(draft.flat());
}

export interface WindowSessions {
  windowId: string;
  windowNumber: number;
  sessions: AppSession[];
}

// The flat session inventory the editor renders: every session in the layout, grouped by window.
// Buried sessions are excluded — they live in no window, so the engine's SESSIONS_NOT_IN_SAME_WINDOW
// rule can never admit them to a domain.
export function sessionsByWindow(windows: AppWindow[]): WindowSessions[] {
  return windows.map((w) => ({
    windowId: w.windowId,
    windowNumber: w.number,
    sessions: w.tabs.flatMap((tab) => flatSessions(tab)),
  }));
}

export function sessionWindowIndex(windows: AppWindow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const w of sessionsByWindow(windows)) {
    for (const s of w.sessions) index.set(s.sessionId, w.windowId);
  }
  return index;
}

// Predicts the engine's SESSIONS_NOT_IN_SAME_WINDOW refusal from the live layout: the indices of
// domains whose members span more than one window. Sessions absent from the layout entirely are
// reported by staleSessionIds instead, not double-counted here.
export function crossWindowDomainIndices(
  draft: BroadcastDraft,
  windows: AppWindow[],
): number[] {
  const byId = sessionWindowIndex(windows);
  return draft.flatMap((domain, idx) => {
    const windowIds = new Set(
      domain.map((id) => byId.get(id)).filter((w): w is string => w !== undefined),
    );
    return windowIds.size > 1 ? [idx] : [];
  });
}

// Session ids the draft references that no longer exist in the layout (closed or buried since the
// table was read) — the engine would answer SESSION_NOT_FOUND.
export function staleSessionIds(draft: BroadcastDraft, windows: AppWindow[]): string[] {
  const byId = sessionWindowIndex(windows);
  return [...assignedSessionIds(draft)].filter((id) => !byId.has(id));
}

// The Act-bar form's textual encoding: one domain per line, members separated by commas or
// whitespace. Blank lines and empty tokens are noise, not domains.
export function parseDomainsText(text: string): BroadcastDraft {
  return text
    .split('\n')
    .map((line) => line.split(/[\s,]+/).filter(Boolean))
    .filter((domain) => domain.length > 0);
}
