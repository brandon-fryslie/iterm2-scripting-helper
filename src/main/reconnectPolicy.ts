// [LAW:effects-at-boundaries] The pure backoff schedule for reconnect attempts. The retry loop's only
// effect (the timer) lives in ReconnectController; this is the testable core that decides how long to
// wait before the Nth attempt. iTerm2 is a local dependency that always returns after a restart, so
// there is no "give up": the loop retries forever and this only caps how slow the polling gets.

export const RECONNECT_BASE_MS = 250;
export const RECONNECT_MAX_MS = 5_000;

// Exponential backoff capped at RECONNECT_MAX_MS. attemptIndex is 0-based, so the schedule is
// 250, 500, 1000, 2000, 4000, 5000, 5000, … — quick to catch a fast iTerm2 restart, then easing off.
export function reconnectDelay(attemptIndex: number): number {
  const exponential = RECONNECT_BASE_MS * 2 ** attemptIndex;
  return Math.min(exponential, RECONNECT_MAX_MS);
}
