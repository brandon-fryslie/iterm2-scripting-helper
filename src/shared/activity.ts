// The Activity timeline's pure projection + provenance layer.
//
// [LAW:effects-at-boundaries] Everything here is a pure function of an AppEventLogSnapshot — no IPC,
// no store, no clock. The renderer store holds the snapshot and the filter VALUES; these functions
// turn (snapshot, filter) into the rows to render and the provenance chain to walk. That keeps the
// timeline's whole meaning unit-testable without a running app.
//
// [LAW:one-source-of-truth] The five former Monitor panes, the Console transcript and the RPC
// invocation log each grew their own ad-hoc "which session / which kind / what summary" reads. Those
// are collapsed here into ONE facet, ONE scope predicate, ONE summary — the timeline is a filter of
// the spine, never a parallel data path.

import {
  type AppEvent,
  type AppEventLogSnapshot,
  eventFrameSeq,
} from './domain';

// ───────────────────────────────────────────────────────────────────────────
// Facets — the timeline's filter dimension.
//
// [LAW:dataflow-not-control-flow] The timeline mounts ONE component and renders ONE row path; which
// lane an event belongs to is a VALUE (its facet), not a branch over which pane is shown. The facet
// is finer than AppEventKind because a notification splits into keystroke/prompt/focus lanes by its
// inner AppNotificationKind — exactly the panes this view replaces.

export type ActivityFacet =
  | 'frame'
  | 'notification'
  | 'keystroke'
  | 'prompt'
  | 'focus'
  | 'variable-change'
  | 'action'
  | 'invocation';

export const ACTIVITY_FACETS: readonly ActivityFacet[] = [
  'frame',
  'notification',
  'keystroke',
  'prompt',
  'focus',
  'variable-change',
  'action',
  'invocation',
];

// [LAW:single-enforcer] The one place that maps a spine event to its display facet. An exhaustive
// match over the discriminated union — a new event kind is a compile error here, never a silent
// "falls into the wrong lane".
export function eventFacet(event: AppEvent): ActivityFacet {
  switch (event.kind) {
    case 'wire-frame':
      return 'frame';
    case 'variable-change':
      return 'variable-change';
    case 'action':
      return 'action';
    case 'invocation':
      return 'invocation';
    case 'notification':
      switch (event.payload.kind) {
        case 'keystroke':
          return 'keystroke';
        case 'prompt':
          return 'prompt';
        case 'focus-changed':
          return 'focus';
        default:
          return 'notification';
      }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Entity scope.
//
// The session an event pertains to, or null for app-scoped (ambient) events. Wire frames and
// invocations are app-scoped transport/registration events; notifications carry the classified
// sessionId; variable-changes and actions carry it on their entity (the notification convention
// zeroes windowId/tabId, so we key on sessionId, never the full appEntityKey).
export function eventSessionId(event: AppEvent): string | null {
  switch (event.kind) {
    case 'wire-frame':
    case 'invocation':
      return null;
    case 'notification':
      return event.payload.sessionId;
    case 'variable-change':
    case 'action':
      return event.entity.kind === 'session' ? event.entity.sessionId : null;
  }
}

// [LAW:dataflow-not-control-flow] Scope is a value-predicate, not a mounted-or-not pane. It mirrors
// the convention the old notifications pane already used: an app-scoped (null-session) event is
// ambient context and shows under ANY focus; a session-scoped event shows only under its own session.
export function eventInScope(event: AppEvent, sessionFilter: string | null): boolean {
  if (!sessionFilter) return true;
  const sid = eventSessionId(event);
  return sid === null || sid === sessionFilter;
}

// ───────────────────────────────────────────────────────────────────────────
// Human summary + free-text search.

// [LAW:one-source-of-truth] One human-readable summary per event, used by BOTH the row display and
// the text filter — they can never disagree about what an event "says".
export function eventSummary(event: AppEvent): string {
  switch (event.kind) {
    case 'wire-frame': {
      const p = event.payload;
      const arrow = p.direction === 'out' ? '→' : '←';
      const id = p.requestId ? ` #${p.requestId}` : '';
      return `${arrow} ${p.messageKind} (${p.size}b)${id}`;
    }
    case 'notification':
      return event.payload.summary || event.payload.kind;
    case 'variable-change': {
      const p = event.payload;
      return `${p.name} = ${p.value}`;
    }
    case 'action': {
      const p = event.payload;
      return p.result.ok ? p.action : `${p.action} ✗ ${p.result.error ?? 'error'}`;
    }
    case 'invocation': {
      const p = event.payload;
      return p.error ? `${p.rpcName} ✗ ${p.error}` : p.rpcName;
    }
  }
}

// The full text an event is searched against: its facet, its summary, and a flattened view of its
// payload so a filter can reach into args/detail fields, not just the headline.
function eventSearchText(event: AppEvent): string {
  return `${eventFacet(event)} ${eventSummary(event)} ${JSON.stringify(event.payload)}`.toLowerCase();
}

export function eventMatchesText(event: AppEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return eventSearchText(event).includes(q);
}

// ───────────────────────────────────────────────────────────────────────────
// Projection — the rows the timeline renders.

export interface ActivityFilter {
  // The facets currently shown. Default is every facet (the unfiltered stream).
  facets: ReadonlySet<ActivityFacet>;
  text: string;
  sessionId: string | null;
}

// [LAW:dataflow-not-control-flow] The same three filters run on every render; variability lives in
// the filter VALUES. Newest-first for display — the spine stores oldest-to-newest.
export function projectActivity(
  snapshot: AppEventLogSnapshot,
  filter: ActivityFilter,
): AppEvent[] {
  const rows = snapshot.events.filter(
    (e) =>
      filter.facets.has(eventFacet(e)) &&
      eventInScope(e, filter.sessionId) &&
      eventMatchesText(e, filter.text),
  );
  rows.reverse();
  return rows;
}

// ───────────────────────────────────────────────────────────────────────────
// Provenance — walking the carried foreign keys, honest about eviction.
//
// [LAW:no-silent-failure] A reference that scrolled out of the ring resolves to a loud 'evicted'
// marker, never a silent omission or a jump to the wrong event. oldestFrameSeq (carried on the
// snapshot) and events[0].seq (the oldest retained seq) are the watermarks that let the renderer be
// honest without a round-trip to the main-process log.

export type FrameResolution =
  | { status: 'found'; events: AppEvent[] }
  | { status: 'evicted'; frameSeq: number }
  | { status: 'unknown'; frameSeq: number };

// Mirrors AppEventLog.resolveFrame, but over the snapshot the log produced. The snapshot is the
// derived copy; resolving within it reads that copy — it is not a second authority over the ring.
export function resolveFrameInSnapshot(
  snapshot: AppEventLogSnapshot,
  frameSeq: number,
): FrameResolution {
  const events = snapshot.events.filter((e) => eventFrameSeq(e) === frameSeq);
  if (events.length > 0) return { status: 'found', events };
  if (snapshot.oldestFrameSeq !== null && frameSeq < snapshot.oldestFrameSeq) {
    return { status: 'evicted', frameSeq };
  }
  return { status: 'unknown', frameSeq };
}

export type SeqResolution =
  | { status: 'found'; event: AppEvent }
  | { status: 'evicted'; seq: number }
  | { status: 'unknown'; seq: number };

export function resolveSeqInSnapshot(
  snapshot: AppEventLogSnapshot,
  seq: number,
): SeqResolution {
  const event = snapshot.events.find((e) => e.seq === seq);
  if (event) return { status: 'found', event };
  const oldestSeq = snapshot.events.length > 0 ? snapshot.events[0].seq : null;
  if (oldestSeq !== null && seq < oldestSeq) return { status: 'evicted', seq };
  return { status: 'unknown', seq };
}

// The relationships a selected event can walk to. Each is a CARRIED foreign key, never a timestamp
// guess: frame-sibling (shared frameSeq), cause/effect (causedBy seq pointer), and request joins
// (an action's result.requestId to the wire frames it produced).
export type ProvenanceRelation =
  | 'frame-sibling'
  | 'cause'
  | 'effect'
  | 'request-frame'
  | 'request-origin';

export type ProvenanceTarget =
  | { status: 'found'; event: AppEvent }
  | { status: 'evicted'; ref: number }
  | { status: 'unknown'; ref: number };

export interface ProvenanceLink {
  relation: ProvenanceRelation;
  target: ProvenanceTarget;
}

function actionRequestId(event: AppEvent): string | null {
  return event.kind === 'action' ? event.payload.result.requestId : null;
}

function wireRequestId(event: AppEvent): string | null {
  return event.kind === 'wire-frame' ? event.payload.requestId : null;
}

// [LAW:single-enforcer] The one walker of the spine's provenance edges. Returns the links as DATA
// (relation + honest target); the component only renders them, it never re-derives a join.
export function eventProvenance(
  snapshot: AppEventLogSnapshot,
  event: AppEvent,
): ProvenanceLink[] {
  const links: ProvenanceLink[] = [];

  // Same protocol moment: every other event minted from the same wire frame.
  const fs = eventFrameSeq(event);
  if (fs !== null) {
    const resolved = resolveFrameInSnapshot(snapshot, fs);
    if (resolved.status === 'found') {
      for (const sibling of resolved.events) {
        if (sibling.seq !== event.seq) {
          links.push({ relation: 'frame-sibling', target: { status: 'found', event: sibling } });
        }
      }
    }
  }

  // The prior event that caused this one (invocation -> its server-rpc notification).
  if (event.causedBy !== null) {
    const cause = resolveSeqInSnapshot(snapshot, event.causedBy);
    links.push({ relation: 'cause', target: seqTarget(cause) });
  }

  // The effects this event caused (a notification -> the invocation it announced).
  for (const candidate of snapshot.events) {
    if (candidate.causedBy === event.seq) {
      links.push({ relation: 'effect', target: { status: 'found', event: candidate } });
    }
  }

  // An action joins to the request/response wire frames it put on the wire, by requestId.
  const reqId = actionRequestId(event);
  if (reqId) {
    for (const candidate of snapshot.events) {
      if (wireRequestId(candidate) === reqId) {
        links.push({ relation: 'request-frame', target: { status: 'found', event: candidate } });
      }
    }
  }

  // Reverse: a wire frame links back to the action that produced it.
  const wireId = wireRequestId(event);
  if (wireId) {
    for (const candidate of snapshot.events) {
      if (actionRequestId(candidate) === wireId) {
        links.push({ relation: 'request-origin', target: { status: 'found', event: candidate } });
      }
    }
  }

  return links;
}

function seqTarget(resolution: SeqResolution): ProvenanceTarget {
  switch (resolution.status) {
    case 'found':
      return { status: 'found', event: resolution.event };
    case 'evicted':
      return { status: 'evicted', ref: resolution.seq };
    case 'unknown':
      return { status: 'unknown', ref: resolution.seq };
  }
}
