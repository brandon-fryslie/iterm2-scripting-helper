import { describe, expect, it } from 'vitest';
import { APP_ENTITY, type AppEntityRef, type AppEvent, type AppEventLogSnapshot } from './domain';
import {
  eventFacet,
  eventSessionId,
  eventInScope,
  eventSummary,
  eventMatchesText,
  projectActivity,
  resolveFrameInSnapshot,
  resolveSeqInSnapshot,
  eventProvenance,
  ACTIVITY_FACETS,
  type ActivityFacet,
} from './activity';

const SESSION = { kind: 'session', windowId: '', tabId: '', sessionId: 's1' } as const;
const OTHER_SESSION = { kind: 'session', windowId: '', tabId: '', sessionId: 's2' } as const;

function wireFrame(seq: number, frameSeq: number, requestId = '0'): AppEvent {
  return {
    kind: 'wire-frame',
    seq,
    at: 1_000 + seq,
    frameSeq,
    entity: APP_ENTITY,
    causedBy: null,
    payload: { direction: 'in', size: 12, messageKind: 'notification', requestId },
  };
}

function notification(
  seq: number,
  frameSeq: number,
  kind: 'variable-changed' | 'keystroke' | 'prompt' | 'focus-changed' = 'variable-changed',
  sessionId: string | null = 's1',
): AppEvent {
  return {
    kind: 'notification',
    seq,
    at: 1_000 + seq,
    frameSeq,
    entity: sessionId
      ? { kind: 'session', windowId: '', tabId: '', sessionId }
      : APP_ENTITY,
    causedBy: null,
    payload: { kind, sessionId, summary: `${kind} happened`, detail: { foo: 'bar' } },
  };
}

function variableChange(seq: number, frameSeq: number, entity: AppEntityRef = SESSION): AppEvent {
  return {
    kind: 'variable-change',
    seq,
    at: 1_000 + seq,
    frameSeq,
    entity,
    causedBy: null,
    payload: {
      name: 'session.name',
      value: '"beta"',
      previousValue: '"alpha"',
      scope: 'session',
      source: 'subscription',
    },
  };
}

function action(seq: number, requestId: string | null = '42', entity: AppEntityRef = SESSION): AppEvent {
  return {
    kind: 'action',
    seq,
    at: 2_000 + seq,
    entity,
    causedBy: null,
    payload: {
      action: 'send-text',
      args: { sessionId: 's1', text: 'hi' },
      result: {
        ok: requestId !== null,
        error: requestId !== null ? null : 'boom',
        latencyMs: 3,
        responseCase: 'sendTextResponse',
        payload: null,
        requestId,
      },
    },
  };
}

function invocation(seq: number, frameSeq: number, causedBy: number): AppEvent {
  return {
    kind: 'invocation',
    seq,
    at: 3_000 + seq,
    frameSeq,
    entity: APP_ENTITY,
    causedBy,
    payload: {
      rpcName: 'my_rpc',
      registrationId: 'reg-1',
      requestId: 'r-1',
      args: { x: 1 },
      responded: true,
      responseJson: '"ok"',
      error: null,
    },
  };
}

function snap(events: AppEvent[], oldestFrameSeq: number | null = null): AppEventLogSnapshot {
  // The log retains events oldest-to-newest; oldestFrameSeq is the eviction watermark.
  const frames = events.map((e) => (e.kind === 'action' ? null : e.frameSeq)).filter((f): f is number => f !== null);
  return {
    events,
    totalSeen: events.length,
    capacity: 5000,
    oldestFrameSeq: oldestFrameSeq ?? (frames.length ? Math.min(...frames) : null),
  };
}

describe('eventFacet', () => {
  it('maps each spine kind to a lane, splitting notifications by their inner kind', () => {
    expect(eventFacet(wireFrame(1, 1))).toBe('frame');
    expect(eventFacet(variableChange(1, 1))).toBe('variable-change');
    expect(eventFacet(action(1))).toBe('action');
    expect(eventFacet(invocation(1, 1, 0))).toBe('invocation');
    expect(eventFacet(notification(1, 1, 'keystroke'))).toBe('keystroke');
    expect(eventFacet(notification(1, 1, 'prompt'))).toBe('prompt');
    expect(eventFacet(notification(1, 1, 'focus-changed'))).toBe('focus');
    expect(eventFacet(notification(1, 1, 'variable-changed'))).toBe('notification');
  });

  it('every facet is reachable and listed once', () => {
    expect(new Set(ACTIVITY_FACETS).size).toBe(ACTIVITY_FACETS.length);
  });
});

describe('eventSessionId', () => {
  it('is null for app-scoped transport/registration events', () => {
    expect(eventSessionId(wireFrame(1, 1))).toBeNull();
    expect(eventSessionId(invocation(1, 1, 0))).toBeNull();
  });

  it('reads the session from notification payload and from variable-change/action entity', () => {
    expect(eventSessionId(notification(1, 1))).toBe('s1');
    expect(eventSessionId(variableChange(1, 1))).toBe('s1');
    expect(eventSessionId(action(1))).toBe('s1');
  });
});

describe('eventInScope', () => {
  it('shows everything when there is no session filter', () => {
    expect(eventInScope(wireFrame(1, 1), null)).toBe(true);
    expect(eventInScope(notification(1, 1, 'variable-changed', 's2'), null)).toBe(true);
  });

  it('shows app-scoped (ambient) events under any session filter', () => {
    expect(eventInScope(wireFrame(1, 1), 's1')).toBe(true);
    expect(eventInScope(invocation(1, 1, 0), 's1')).toBe(true);
  });

  it('shows a session event only under its own session', () => {
    expect(eventInScope(notification(1, 1, 'variable-changed', 's1'), 's1')).toBe(true);
    expect(eventInScope(notification(1, 1, 'variable-changed', 's2'), 's1')).toBe(false);
    expect(eventInScope(variableChange(1, 1, OTHER_SESSION), 's1')).toBe(false);
  });
});

describe('eventSummary + eventMatchesText', () => {
  it('summarizes each kind for display and search', () => {
    expect(eventSummary(wireFrame(1, 1, '9'))).toContain('notification');
    expect(eventSummary(variableChange(1, 1))).toBe('session.name = "beta"');
    expect(eventSummary(action(1))).toBe('send-text');
    expect(eventSummary(action(1, null))).toContain('✗');
  });

  it('matches free text against summary and payload, case-insensitively', () => {
    const e = variableChange(1, 1);
    expect(eventMatchesText(e, 'session.name')).toBe(true);
    expect(eventMatchesText(e, 'BETA')).toBe(true);
    expect(eventMatchesText(e, 'nonexistent')).toBe(false);
    expect(eventMatchesText(e, '')).toBe(true);
  });
});

describe('projectActivity', () => {
  const events = [
    wireFrame(1, 1),
    notification(2, 1, 'variable-changed', 's1'),
    variableChange(3, 1),
    notification(4, 2, 'keystroke', 's2'),
    action(5),
  ];
  const all: ReadonlySet<ActivityFacet> = new Set(ACTIVITY_FACETS);

  it('returns newest-first', () => {
    const rows = projectActivity(snap(events), { facets: all, text: '', sessionId: null });
    expect(rows.map((e) => e.seq)).toEqual([5, 4, 3, 2, 1]);
  });

  it('filters by facet', () => {
    const rows = projectActivity(snap(events), {
      facets: new Set<ActivityFacet>(['frame']),
      text: '',
      sessionId: null,
    });
    expect(rows.map((e) => e.seq)).toEqual([1]);
  });

  it('scopes to a session, keeping app-scoped frames as ambient context', () => {
    const rows = projectActivity(snap(events), { facets: all, text: '', sessionId: 's1' });
    // s2 keystroke (seq 4) is dropped; the app-scoped frame (seq 1) and action (seq 5) stay.
    expect(rows.map((e) => e.seq)).toEqual([5, 3, 2, 1]);
  });

  it('filters by free text', () => {
    const rows = projectActivity(snap(events), { facets: all, text: 'keystroke', sessionId: null });
    expect(rows.map((e) => e.seq)).toEqual([4]);
  });
});

describe('resolveFrameInSnapshot', () => {
  it('finds all events minted from one frame', () => {
    const events = [wireFrame(1, 7), notification(2, 7), variableChange(3, 7), wireFrame(4, 8)];
    const r = resolveFrameInSnapshot(snap(events), 7);
    expect(r.status).toBe('found');
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.events.map((e) => e.seq).sort()).toEqual([1, 2, 3]);
  });

  it('reports a frame below the watermark as evicted, not unknown', () => {
    const events = [wireFrame(1, 50)];
    const r = resolveFrameInSnapshot(snap(events, 50), 7);
    expect(r).toEqual({ status: 'evicted', frameSeq: 7 });
  });

  it('reports a frame above the retained range as unknown', () => {
    const events = [wireFrame(1, 7)];
    const r = resolveFrameInSnapshot(snap(events, 7), 999);
    expect(r).toEqual({ status: 'unknown', frameSeq: 999 });
  });
});

describe('resolveSeqInSnapshot', () => {
  it('finds a retained seq', () => {
    const events = [wireFrame(10, 1), notification(11, 1)];
    const r = resolveSeqInSnapshot(snap(events), 11);
    expect(r.status).toBe('found');
  });

  it('reports a seq below the oldest retained as evicted', () => {
    const events = [wireFrame(10, 1), notification(11, 1)];
    const r = resolveSeqInSnapshot(snap(events), 3);
    expect(r).toEqual({ status: 'evicted', seq: 3 });
  });
});

describe('eventProvenance', () => {
  it('links frame siblings (notification <-> variable-change <-> wire-frame)', () => {
    const events = [wireFrame(1, 7), notification(2, 7), variableChange(3, 7)];
    const links = eventProvenance(snap(events), events[1]);
    const siblings = links.filter((l) => l.relation === 'frame-sibling');
    expect(siblings).toHaveLength(2);
    expect(
      siblings.every((l) => l.target.status === 'found'),
    ).toBe(true);
  });

  it('walks invocation -> cause notification, and notification -> effect invocation', () => {
    const notif = notification(1, 7);
    const inv = invocation(2, 7, 1);
    const s = snap([notif, inv]);

    const fromInvocation = eventProvenance(s, inv);
    const cause = fromInvocation.find((l) => l.relation === 'cause');
    expect(cause?.target.status).toBe('found');
    if (cause?.target.status === 'found') expect(cause.target.event.seq).toBe(1);

    const fromNotification = eventProvenance(s, notif);
    const effect = fromNotification.find((l) => l.relation === 'effect');
    expect(effect?.target.status).toBe('found');
    if (effect?.target.status === 'found') expect(effect.target.event.seq).toBe(2);
  });

  it('joins an action to its request/response wire frames by requestId (both directions)', () => {
    const act = action(1, '42');
    const reqFrame = wireFrame(2, 5, '42');
    const s = snap([act, reqFrame]);

    const fromAction = eventProvenance(s, act);
    expect(fromAction.some((l) => l.relation === 'request-frame')).toBe(true);

    const fromFrame = eventProvenance(s, reqFrame);
    const origin = fromFrame.find((l) => l.relation === 'request-origin');
    expect(origin?.target.status).toBe('found');
    if (origin?.target.status === 'found') expect(origin.target.event.seq).toBe(1);
  });

  it('reports an evicted cause loudly instead of dropping the link', () => {
    // The invocation references a causedBy seq that scrolled out of the retained window.
    const inv = invocation(20, 7, 3);
    const links = eventProvenance(snap([inv]), inv);
    const cause = links.find((l) => l.relation === 'cause');
    expect(cause?.target).toEqual({ status: 'evicted', ref: 3 });
  });
});
