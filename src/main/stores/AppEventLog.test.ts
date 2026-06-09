import { describe, expect, it } from 'vitest';
import {
  AppEventLog,
  wireLogProjection,
  notificationLogProjection,
} from './AppEventLog';
import { APP_ENTITY, type AppEvent } from '@shared/domain';

const SESSION = { kind: 'session', windowId: '', tabId: '', sessionId: 's1' } as const;

function wireFrame(frameSeq: number, direction: 'out' | 'in' = 'in'): Omit<AppEvent, 'seq'> {
  return {
    kind: 'wire-frame',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: APP_ENTITY,
    causedBy: null,
    payload: { direction, size: 12, messageKind: 'notification', requestId: '0' },
  };
}

function notification(frameSeq: number): Omit<AppEvent, 'seq'> {
  return {
    kind: 'notification',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: SESSION,
    causedBy: null,
    payload: { kind: 'variable-changed', sessionId: 's1', summary: 'session.name changed', detail: null },
  };
}

function variableChange(frameSeq: number, source: 'subscription' | 'dump'): Omit<AppEvent, 'seq'> {
  return {
    kind: 'variable-change',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: SESSION,
    causedBy: null,
    payload: { name: 'session.name', value: '"beta"', previousValue: '"alpha"', scope: 'session', source },
  };
}

describe('AppEventLog', () => {
  it('mints monotonic seq and returns events oldest-to-newest', () => {
    const log = new AppEventLog();
    const a = log.append(wireFrame(1));
    const b = log.append(notification(1));
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(log.events().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('resolves a live change to its notification AND wire frame by frameSeq, with zero timestamp matching', () => {
    const log = new AppEventLog();
    // Production order for an inbound subscription change: frame, then notification, then change —
    // all stamped with the same frameSeq at the boundary.
    log.append(wireFrame(7));
    log.append(notification(7));
    log.append(variableChange(7, 'subscription'));
    // An unrelated frame in between must not be pulled into the join.
    log.append(wireFrame(8));

    const resolution = log.resolveFrame(7);
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    const kinds = resolution.events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['notification', 'variable-change', 'wire-frame']);
  });

  it('resolves a dump change to a wire frame ONLY (no notification)', () => {
    const log = new AppEventLog();
    log.append(wireFrame(3));
    log.append(variableChange(3, 'dump'));

    const resolution = log.resolveFrame(3);
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    expect(resolution.events.some((e) => e.kind === 'wire-frame')).toBe(true);
    expect(resolution.events.some((e) => e.kind === 'notification')).toBe(false);
  });

  it('degrades loudly on an evicted frame and reports unknown for one that never existed', () => {
    const log = new AppEventLog(3);
    for (let f = 1; f <= 5; f += 1) log.append(wireFrame(f));
    // Ring holds the last three frames (3,4,5); 1 and 2 scrolled out.
    expect(log.resolveFrame(1)).toEqual({ status: 'evicted', frameSeq: 1 });
    expect(log.resolveFrame(4).status).toBe('found');
    expect(log.resolveFrame(99)).toEqual({ status: 'unknown', frameSeq: 99 });
  });

  it('projects the wire pane as a filter, using frameSeq as the entry identity', () => {
    const log = new AppEventLog();
    log.append(wireFrame(1, 'out'));
    log.append(notification(1));
    log.append(wireFrame(2, 'in'));

    const snap = wireLogProjection(log);
    expect(snap.entries).toEqual([
      { seq: 1, at: 1_001, direction: 'out', size: 12, kind: 'notification', id: '0' },
      { seq: 2, at: 1_002, direction: 'in', size: 12, kind: 'notification', id: '0' },
    ]);
    expect(snap.totalSeen).toBe(2);
    expect(snap.capacity).toBeGreaterThan(0);
  });

  it('projects the notifications pane as a filter', () => {
    const log = new AppEventLog();
    log.append(wireFrame(1));
    const n = log.append(notification(1));

    const snap = notificationLogProjection(log);
    expect(snap.entries).toEqual([
      {
        seq: n.seq,
        at: 1_001,
        kind: 'variable-changed',
        sessionId: 's1',
        summary: 'session.name changed',
        payload: null,
      },
    ]);
    expect(snap.totalSeen).toBe(1);
  });

  it('clear resets identity, totals, and frame bookkeeping', () => {
    const log = new AppEventLog();
    log.append(wireFrame(1));
    log.clear();
    expect(log.events()).toEqual([]);
    expect(log.totalSeen('wire-frame')).toBe(0);
    expect(log.resolveFrame(1)).toEqual({ status: 'unknown', frameSeq: 1 });
    // seq restarts so a fresh connection's log is not haunted by the prior one's identities.
    expect(log.append(wireFrame(1)).seq).toBe(1);
  });

  it('produces an IPC-cloneable snapshot', () => {
    const log = new AppEventLog();
    log.append(wireFrame(1));
    log.append(notification(1));
    log.append(variableChange(1, 'subscription'));
    const snap = log.snapshot();
    expect(structuredClone(snap)).toEqual(snap);
    expect(snap.oldestFrameSeq).toBe(1);
  });
});
