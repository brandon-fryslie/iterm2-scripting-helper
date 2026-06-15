import { describe, it, expect } from 'vitest';
import { ReconnectController, type Scheduler } from './ReconnectController';
import { reconnectDelay } from '../reconnectPolicy';

// A manual single-slot scheduler standing in for the clock: the test fires the pending callback itself,
// so the whole retry loop is deterministic with no timers. [LAW:effects-at-boundaries] the only effect
// the controller has is scheduling, and it is injected here.
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
  return {
    scheduler,
    delay: () => pending?.ms ?? null,
    isPending: () => pending !== null,
    // Fire the armed callback, then drain microtasks so the async attempt settles and the controller
    // re-arms or stops before the test asserts.
    async fire() {
      const p = pending;
      pending = null;
      p?.fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ReconnectController retry loop', () => {
  const noopAttempt = async (): Promise<void> => {
    /* an attempt that resolves immediately */
  };

  it('arms the first attempt at the base backoff delay', () => {
    const m = manualScheduler();
    const controller = new ReconnectController(noopAttempt, reconnectDelay, m.scheduler);

    controller.start();

    expect(m.isPending()).toBe(true);
    expect(m.delay()).toBe(250);
  });

  it('walks the exponential backoff schedule while attempts keep failing', async () => {
    const m = manualScheduler();
    const controller = new ReconnectController(
      async () => {
        throw new Error('iTerm2 still down');
      },
      reconnectDelay,
      m.scheduler,
    );

    controller.start();
    const seen: number[] = [];
    // Six failures: 250 → 500 → 1000 → 2000 → 4000 → 5000 (capped), each delay armed for the NEXT attempt.
    for (let i = 0; i < 6; i += 1) {
      const delay = m.delay();
      if (delay === null) throw new Error('expected a pending reconnect timer');
      seen.push(delay);
      await m.fire();
    }

    expect(seen).toEqual([250, 500, 1000, 2000, 4000, 5000]);
    // Still retrying — a local dependency that will return, so the loop never gives up.
    expect(m.isPending()).toBe(true);
  });

  it('stops the loop and resets the backoff once an attempt succeeds', async () => {
    const m = manualScheduler();
    let calls = 0;
    const controller = new ReconnectController(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('not yet');
      },
      reconnectDelay,
      m.scheduler,
    );

    controller.start();
    await m.fire(); // fail (250)
    await m.fire(); // fail (500)
    await m.fire(); // success (1000)

    expect(calls).toBe(3);
    expect(m.isPending()).toBe(false);

    // A fresh drop starts the schedule over at the base delay, not where it left off.
    controller.start();
    expect(m.delay()).toBe(250);
  });

  it('does not run the attempt if cancelled during the wait', async () => {
    const m = manualScheduler();
    let calls = 0;
    const controller = new ReconnectController(
      async () => {
        calls += 1;
      },
      reconnectDelay,
      m.scheduler,
    );

    controller.start();
    controller.cancel();

    expect(m.isPending()).toBe(false);
    await m.fire(); // nothing armed
    expect(calls).toBe(0);
  });

  it('does not re-arm if cancelled while an attempt is in flight', async () => {
    const m = manualScheduler();
    const d = deferred();
    const controller = new ReconnectController(() => d.promise, reconnectDelay, m.scheduler);

    controller.start();
    await m.fire(); // attempt now in flight, awaiting d
    controller.cancel(); // user disconnects mid-attempt
    d.reject(new Error('dropped'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The in-flight failure must not resurrect the loop the user just stopped.
    expect(m.isPending()).toBe(false);
  });

  it('does not let a stale attempt from a cancelled loop re-arm a restarted loop', async () => {
    const m = manualScheduler();
    const deferreds: Array<{ promise: Promise<void>; reject: (e: unknown) => void }> = [];
    const controller = new ReconnectController(
      () => {
        const d = deferred();
        deferreds.push(d);
        return d.promise;
      },
      reconnectDelay,
      m.scheduler,
    );

    controller.start(); // generation A
    await m.fire(); // attempt #0 in flight, belongs to generation A
    controller.cancel(); // bumps generation
    controller.start(); // generation B
    await m.fire(); // attempt #1 in flight, belongs to generation B
    expect(deferreds).toHaveLength(2);

    // The old (generation A) attempt fails after the loop was cancelled and restarted. It must not touch
    // the generation-B loop — no extra timer armed.
    deferreds[0].reject(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.isPending()).toBe(false);

    // The current (generation B) attempt failing does re-arm its own loop, at its own backoff.
    deferreds[1].reject(new Error('current failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.isPending()).toBe(true);
    expect(m.delay()).toBe(500);
  });

  it('does not let a stale attempt that succeeds tear down a restarted loop', async () => {
    const m = manualScheduler();
    const deferreds: Array<{ promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void }> = [];
    const controller = new ReconnectController(
      () => {
        const d = deferred();
        deferreds.push(d);
        return d.promise;
      },
      reconnectDelay,
      m.scheduler,
    );

    controller.start(); // generation A
    await m.fire(); // attempt #0 in flight, generation A
    controller.cancel();
    controller.start(); // generation B
    await m.fire(); // attempt #1 in flight, generation B

    // The old attempt succeeds after its loop was cancelled and restarted; it must NOT cancel the
    // generation-B loop (which would silently stop reconnecting).
    deferreds[0].resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Generation-B loop is intact: its attempt failing still re-arms.
    deferreds[1].reject(new Error('current failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.isPending()).toBe(true);
    expect(m.delay()).toBe(500);
  });

  it('is idempotent while a loop is already running', () => {
    const m = manualScheduler();
    const controller = new ReconnectController(noopAttempt, reconnectDelay, m.scheduler);

    controller.start();
    controller.start();

    // A second unsolicited close mid-loop does not spawn a competing loop or reset the backoff.
    expect(m.delay()).toBe(250);
  });
});
