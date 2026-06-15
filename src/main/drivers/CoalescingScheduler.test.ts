import { describe, it, expect } from 'vitest';
import { CoalescingScheduler } from './CoalescingScheduler';
import type { Scheduler } from './ReconnectController';

// A manual single-slot scheduler standing in for the clock: the test fires the pending callback itself,
// so the whole coalescing state machine is deterministic with no real timers. [LAW:effects-at-boundaries]
// the only effect the scheduler has is the clock, and it is injected here.
function manualScheduler() {
  let pending: { fn: () => void; ms: number } | null = null;
  const scheduler: Scheduler = {
    schedule(fn, ms) {
      pending = { fn, ms };
    },
    cancel() {
      pending = null;
    },
  };
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    scheduler,
    delay: () => pending?.ms ?? null,
    isPending: () => pending !== null,
    // Start the armed run WITHOUT draining, so a test can inject a request while the run is suspended
    // mid-flight. Returns once the synchronous prefix of fire() has run (inFlight is set).
    start() {
      const p = pending;
      pending = null;
      p?.fn();
    },
    drain,
    // Convenience: start the armed run and let it settle.
    async fire() {
      this.start();
      await drain();
    },
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CoalescingScheduler', () => {
  const DELAY = 16;

  it('collapses a burst of requests into a single windowed run', async () => {
    let runs = 0;
    const m = manualScheduler();
    const sched = new CoalescingScheduler(async () => void runs++, DELAY, m.scheduler);

    sched.request();
    sched.request();
    sched.request();

    expect(m.isPending()).toBe(true);
    expect(m.delay()).toBe(DELAY);
    await m.fire();
    expect(runs).toBe(1);
    expect(m.isPending()).toBe(false);
  });

  it('does not reset the window when more requests arrive before it fires', async () => {
    let runs = 0;
    const m = manualScheduler();
    const sched = new CoalescingScheduler(async () => void runs++, DELAY, m.scheduler);

    sched.request();
    sched.request(); // must NOT re-arm a fresh window — that would starve a steady 60fps stream
    expect(m.delay()).toBe(DELAY);
    await m.fire();
    expect(runs).toBe(1);
  });

  it('never drops a request that lands while a run is in flight (trailing edge)', async () => {
    let runs = 0;
    const gate = deferred();
    const m = manualScheduler();
    const sched = new CoalescingScheduler(
      async () => {
        runs++;
        if (runs === 1) await gate.promise; // hold the first run open
      },
      DELAY,
      m.scheduler,
    );

    sched.request();
    m.start(); // first run begins and suspends on the gate
    expect(runs).toBe(1);

    sched.request(); // arrives mid-flight: must be remembered, not scheduled now
    expect(m.isPending()).toBe(false);

    gate.resolve(); // first run completes
    await m.drain();

    // The mid-flight request is owed a trailing pass, armed at the window delay.
    expect(m.isPending()).toBe(true);
    expect(m.delay()).toBe(DELAY);
    await m.fire();
    expect(runs).toBe(2);
    expect(m.isPending()).toBe(false);
  });

  it('owes at most one trailing pass no matter how many requests land mid-flight', async () => {
    let runs = 0;
    const gate = deferred();
    const m = manualScheduler();
    const sched = new CoalescingScheduler(
      async () => {
        runs++;
        if (runs === 1) await gate.promise;
      },
      DELAY,
      m.scheduler,
    );

    sched.request();
    m.start();
    sched.request();
    sched.request();
    sched.request(); // a whole burst mid-flight still collapses to one trailing pass
    gate.resolve();
    await m.drain();

    await m.fire();
    expect(runs).toBe(2);
    expect(m.isPending()).toBe(false);
  });

  it('cancel() drops a pending window', async () => {
    let runs = 0;
    const m = manualScheduler();
    const sched = new CoalescingScheduler(async () => void runs++, DELAY, m.scheduler);

    sched.request();
    expect(m.isPending()).toBe(true);
    sched.cancel();
    expect(m.isPending()).toBe(false);
    await m.drain();
    expect(runs).toBe(0);
  });

  it('cancel() during a run prevents it from re-arming a trailing pass', async () => {
    let runs = 0;
    const gate = deferred();
    const m = manualScheduler();
    const sched = new CoalescingScheduler(
      async () => {
        runs++;
        if (runs === 1) await gate.promise;
      },
      DELAY,
      m.scheduler,
    );

    sched.request();
    m.start(); // run in flight, suspended
    sched.request(); // trailing owed...
    sched.cancel(); // ...but the owner moved on (session change / close)
    gate.resolve();
    await m.drain();

    expect(m.isPending()).toBe(false); // no trailing pass survives the cancel
    expect(runs).toBe(1);
  });

  it('resumes scheduling after a cancel', async () => {
    let runs = 0;
    const m = manualScheduler();
    const sched = new CoalescingScheduler(async () => void runs++, DELAY, m.scheduler);

    sched.request();
    sched.cancel();
    sched.request();
    expect(m.isPending()).toBe(true);
    await m.fire();
    expect(runs).toBe(1);
  });

  // [LAW:no-ambient-temporal-coupling] The bug the in-flight slot must not reintroduce: a request that
  // lands after cancel() but before the canceled run has settled must arm a fresh timer, not be written
  // onto the dead run. cancel() releasing inFlight is what makes inFlight an honest current-generation
  // signal here.
  it('arms a fresh timer for a request that lands after cancel while the canceled run is still settling', async () => {
    let runs = 0;
    const gate = deferred();
    const m = manualScheduler();
    const sched = new CoalescingScheduler(
      async () => {
        runs++;
        if (runs === 1) await gate.promise; // the run that gets canceled stays suspended
      },
      DELAY,
      m.scheduler,
    );

    sched.request();
    m.start(); // first run begins and suspends on the gate
    expect(runs).toBe(1);

    sched.cancel(); // owner moved on (focus change / close) while the run is still in flight
    sched.request(); // a fresh request lands before the canceled run settles — must NOT be dropped
    expect(m.isPending()).toBe(true); // a fresh timer is armed, not swallowed onto the dead run

    await m.fire(); // the fresh run executes
    expect(runs).toBe(2);

    // The canceled run finally settles; its completion must touch nothing — no stray trailing pass.
    gate.resolve();
    await m.drain();
    expect(m.isPending()).toBe(false);
    expect(runs).toBe(2);
  });
});
