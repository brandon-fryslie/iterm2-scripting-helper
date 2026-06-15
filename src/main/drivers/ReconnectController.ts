// [LAW:no-ambient-temporal-coupling] The single owner of reconnect timing. Given a way to attempt a
// reconnect and a backoff schedule, it runs the retry loop and nothing else: arm a timer, run the
// attempt, re-arm with the next backoff if it fails, stop and reset if it succeeds, stop on cancel. It
// knows nothing about cookies, sockets, or connection state — those are the attempt's concern — so the
// loop's behavior is decided entirely by the injected attempt and schedule. [LAW:effects-at-boundaries]
// The one effect, the clock, is injected as a Scheduler, so the loop is deterministic under test.

// A single-slot timer: each schedule replaces any pending callback, and cancel clears it. One owner,
// one in-flight timer — there is no way to leak overlapping reconnect timers.
export interface Scheduler {
  schedule(fn: () => void, ms: number): void;
  cancel(): void;
}

export function realScheduler(): Scheduler {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn, ms) {
      if (handle) clearTimeout(handle);
      handle = setTimeout(fn, ms);
    },
    cancel() {
      if (handle) clearTimeout(handle);
      handle = null;
    },
  };
}

export class ReconnectController {
  private attemptIndex = 0;
  private active = false;

  constructor(
    private readonly attempt: () => Promise<void>,
    private readonly delayFor: (attemptIndex: number) => number,
    private readonly scheduler: Scheduler = realScheduler(),
  ) {}

  // Begin the retry loop. Idempotent while a loop is already running — a second unsolicited close
  // arriving mid-loop cannot spawn a competing loop. [LAW:no-shared-mutable-globals] one owner of `active`.
  start(): void {
    if (this.active) return;
    this.active = true;
    this.attemptIndex = 0;
    this.arm();
  }

  // Stop the loop and reset the backoff. A user disconnect or a superseding manual connect calls this,
  // so a pending timer cannot fire after the user took over, and an in-flight attempt cannot re-arm.
  cancel(): void {
    this.active = false;
    this.attemptIndex = 0;
    this.scheduler.cancel();
  }

  private arm(): void {
    this.scheduler.schedule(() => void this.run(), this.delayFor(this.attemptIndex));
  }

  private async run(): Promise<void> {
    if (!this.active) return; // canceled during the wait
    try {
      await this.attempt();
      this.cancel(); // success: stop the loop, reset the backoff
    } catch {
      // [LAW:no-silent-failure] The attempt is responsible for surfacing why it failed; the controller
      // only decides whether to keep trying. A failure that lands after a cancel does not re-arm.
      if (!this.active) return;
      this.attemptIndex += 1;
      this.arm();
    }
  }
}
