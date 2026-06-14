import { describe, expect, it } from 'vitest';
import { AppEventLog, invocationProjection } from './AppEventLog';
import { APP_ENTITY, type AppEventInput } from '@shared/domain';

const SESSION = { kind: 'session', windowId: '', tabId: '', sessionId: 's1' } as const;

function wireFrame(frameSeq: number, direction: 'out' | 'in' = 'in'): AppEventInput {
  return {
    kind: 'wire-frame',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: APP_ENTITY,
    causedBy: null,
    payload: { direction, size: 12, messageKind: 'notification', requestId: '0' },
  };
}

function notification(frameSeq: number): AppEventInput {
  return {
    kind: 'notification',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: SESSION,
    causedBy: null,
    payload: { kind: 'variable-changed', sessionId: 's1', summary: 'session.name changed', detail: null },
  };
}

function variableChange(frameSeq: number, source: 'subscription' | 'dump'): AppEventInput {
  return {
    kind: 'variable-change',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: SESSION,
    causedBy: null,
    payload: { name: 'session.name', value: '"beta"', previousValue: '"alpha"', scope: 'session', source },
  };
}

function action(ok: boolean): AppEventInput {
  // [LAW:types-are-the-program] No frameSeq: an action is not decoded from a frame.
  return {
    kind: 'action',
    at: 2_000,
    entity: SESSION,
    causedBy: null,
    payload: {
      action: 'send-text',
      args: { sessionId: 's1', text: 'hi' },
      result: {
        ok,
        error: ok ? null : 'boom',
        latencyMs: 3,
        responseCase: ok ? 'sendTextResponse' : 'error',
        payload: null,
        requestId: ok ? '42' : null,
      },
    },
  };
}

function invocation(frameSeq: number, causedBy: number): AppEventInput {
  return {
    kind: 'invocation',
    at: 3_000,
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

  it('an action (no frameSeq) does not blank the eviction watermark or get pulled into a frame join', () => {
    const log = new AppEventLog();
    // Action is the OLDEST retained event but carries no frame; oldestFrameSeq must skip past it to
    // the first frame-bearing event rather than collapsing to null.
    log.append(action(true));
    log.append(wireFrame(5));
    log.append(variableChange(5, 'subscription'));

    expect(log.snapshot().oldestFrameSeq).toBe(5);
    const resolution = log.resolveFrame(5);
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    // The frameSeq-less action is never joined to a frame.
    expect(resolution.events.some((e) => e.kind === 'action')).toBe(false);
    expect(resolution.events.map((e) => e.kind).sort()).toEqual([
      'variable-change',
      'wire-frame',
    ]);
  });

  it('projects invocations from the spine and links each back to its triggering notification', () => {
    const log = new AppEventLog();
    log.append(wireFrame(9));
    const notif = log.append(notification(9));
    const inv = log.append(invocation(9, notif.seq));

    const { invocations, totalInvocations } = invocationProjection(log);
    expect(totalInvocations).toBe(1);
    expect(invocations).toEqual([
      {
        seq: inv.seq,
        at: 3_000,
        registrationId: 'reg-1',
        requestId: 'r-1',
        args: { x: 1 },
        responded: true,
        responseJson: '"ok"',
        error: null,
      },
    ]);
    // causedBy is a walkable seq pointer to the notification, and both share the frame they came from.
    expect(inv.causedBy).toBe(notif.seq);
    expect(log.resolveFrame(9).status).toBe('found');
    const frame9 = log.resolveFrame(9);
    if (frame9.status !== 'found') throw new Error('expected found');
    expect(frame9.events.map((e) => e.kind).sort()).toEqual([
      'invocation',
      'notification',
      'wire-frame',
    ]);
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

  describe('restore', () => {
    it('is the inverse of snapshot: a restored log projects the exact same events', () => {
      const src = new AppEventLog();
      src.append(wireFrame(1, 'out'));
      src.append(notification(2));
      src.append(invocation(2, 2));
      src.append(action(false));
      const original = src.snapshot();

      const dst = new AppEventLog();
      dst.restore(original.events);

      // seq, frameSeq and causedBy are preserved verbatim — the provenance joins still resolve.
      expect(dst.snapshot().events).toEqual(original.events);
      expect(dst.resolveFrame(2)).toEqual(src.resolveFrame(2));
      expect(invocationProjection(dst)).toEqual(invocationProjection(src));
    });

    it('continues minting seq after the highest restored seq', () => {
      const src = new AppEventLog();
      src.append(wireFrame(1));
      src.append(notification(1));
      const dst = new AppEventLog();
      dst.restore(src.snapshot().events);

      const next = dst.append(action(true));
      expect(next.seq).toBe(3);
    });

    it('replaces the whole spine — a prior load leaves no residue', () => {
      const log = new AppEventLog();
      log.append(action(true));
      log.append(action(false));

      const replacement = new AppEventLog();
      replacement.append(wireFrame(7, 'in'));
      log.restore(replacement.snapshot().events);

      expect(log.events().map((e) => e.kind)).toEqual(['wire-frame']);
      expect(log.totalSeen('action')).toBe(0);
      expect(log.snapshot().oldestFrameSeq).toBe(7);
    });

    it('keeps the newest events when the fixture exceeds capacity', () => {
      const src = new AppEventLog();
      for (let i = 1; i <= 5; i += 1) src.append(wireFrame(i));
      const dst = new AppEventLog(3);
      dst.restore(src.snapshot().events);

      expect(dst.events().map((e) => e.seq)).toEqual([3, 4, 5]);
    });
  });
});
