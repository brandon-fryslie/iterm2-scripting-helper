// [LAW:no-ambient-temporal-coupling] The single owner of "when to run the next coalesced refetch".
// Given a refetch to run and a window, it guarantees two properties at once:
//   bounded  — at most one run() per window and at most one run() in flight, so a 60fps burst of
//              requests collapses into a rate-limited stream instead of a refetch per frame;
//   trailing — a request() that lands while a run() is in flight is never dropped: exactly one more
//              run() is scheduled after the in-flight one settles, so the final frame of a burst is
//              always fetched and the view converges to the latest state.
// It knows nothing about screens, sockets, or connection state — the refetch is injected — so the
// timing is decided entirely by the injected run and window, and is deterministic under test.
// [LAW:effects-at-boundaries] The one effect, the clock, is the injected Scheduler.

import { type Scheduler, realScheduler } from './ReconnectController';

export class CoalescingScheduler {
  // A run is scheduled but has not yet started. Collapses a burst into the already-open window rather
  // than resetting it (a reset on every request would, under steady 60fps load, never let the timer
  // fire — the classic debounce-starves-a-stream bug). The window opens once and fires at its end.
  private armed = false;
  private inFlight = false;
  // A request arrived while a run was in flight, so one trailing run is owed once it settles.
  private trailing = false;
  // [LAW:no-ambient-temporal-coupling] Same role as ReconnectController.generation: `inFlight` alone
  // cannot tell a run whose owner was canceled from one that is still current, so cancel() bumps the
  // generation and an in-flight run only re-arms its trailing pass while it still owns the current one.
  private generation = 0;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly delayMs: number,
    private readonly scheduler: Scheduler = realScheduler(),
  ) {}

  // Signal that a refetch is wanted. Cheap and idempotent within a window; the boundedness is enforced
  // here, not by the caller, so every notification can call it unconditionally. [LAW:dataflow-not-control-flow]
  request(): void {
    if (this.inFlight) {
      this.trailing = true;
      return;
    }
    if (this.armed) return;
    this.armed = true;
    this.scheduler.schedule(() => void this.fire(this.generation), this.delayMs);
  }

  // Stop the scheduler: drop a pending window and release the in-flight slot so a canceled run cannot
  // re-arm a trailing pass after its owner (a session change, a connection close) has moved on. Clearing
  // inFlight here is what keeps it an honest "a CURRENT-generation run is in flight" signal: a stale run
  // still settling can no longer block request() from arming a fresh timer, so a post-cancel request is
  // never dropped onto the dead run. The stale run's finally is gated on its captured generation, so it
  // touches no shared state after this — including the inFlight a newer run may since have set true.
  cancel(): void {
    this.armed = false;
    this.trailing = false;
    this.inFlight = false;
    this.generation += 1;
    this.scheduler.cancel();
  }

  private async fire(generation: number): Promise<void> {
    this.armed = false;
    if (generation !== this.generation) return; // canceled during the window
    this.inFlight = true;
    this.trailing = false;
    try {
      await this.run();
    } finally {
      // [LAW:no-ambient-temporal-coupling] Only the run that still owns the current generation resets the
      // slot and decides whether a trailing pass is owed; a run canceled mid-flight (cancel() already
      // released the slot and bumped the generation) touches nothing here, and a stale run settling after
      // a newer run started cannot clobber the newer run's inFlight. Expressed as a nested `if` rather
      // than a guard-`return`: [LAW:no-silent-failure] this finally must not swallow a run() rejection —
      // there is no control-flow statement here, so an unexpected failure propagates loudly after the
      // bookkeeping runs (the trailing re-arm still fires, so an errored refetch is retried next pass).
      if (generation === this.generation) {
        this.inFlight = false;
        if (this.trailing) {
          this.trailing = false;
          this.armed = true;
          this.scheduler.schedule(() => void this.fire(generation), this.delayMs);
        }
      }
    }
  }
}
