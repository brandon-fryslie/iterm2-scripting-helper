import { eventFrameSeq, type AppEvent, type AppEventLogSnapshot } from '@shared/domain';
import { parseFixture, serializeFixture, type SpanRange } from '@shared/fixture';
import type { ConnectionState } from './stores/ConnectionStore';
import type { AppEventLog } from './stores/AppEventLog';

// The capture/replay core, kept free of fs and dialogs so the determinism that the acceptance rests on
// is unit-testable without Electron ([LAW:effects-at-boundaries]). The IPC layer wraps these with the
// file picker and disk IO.

export interface FixtureBuildResult {
  ndjson: string;
  eventCount: number;
}

// [LAW:types-are-the-program] Replay either restored the spine (carrying how many events) or refused
// with a reason; the two outcomes never blur. The IPC layer adds the file path on success.
export type FixtureApplyResult =
  | { ok: true; eventCount: number }
  | { ok: false; error: string };

// Connecting or connected: a live connection still owns and mutates the spine, so restoring a fixture
// into it would interleave recorded and live events. Replay is therefore "replay-only" — it requires a
// torn-down connection. 'idle' (never connected / cleanly disconnected) and 'error' (a failed connect,
// the literal state of a machine with no iTerm2) are the states a fixture may be loaded into.
function isLive(state: ConnectionState): boolean {
  return state === 'detecting' || state === 'requesting-cookie' || state === 'connecting' || state === 'ready';
}

// Serialize the current spine, or a seq sub-range of it, to NDJSON. A span filters by the inclusive
// seq bounds; the derived header describes the slice (its own count and eviction watermark) so a span
// fixture is as self-consistent as a whole-log one.
export function buildFixtureNdjson(
  appEvents: AppEventLog,
  span: SpanRange | null,
  capturedAt: number,
): FixtureBuildResult {
  const full = appEvents.snapshot();
  const snapshot = span ? sliceSnapshot(full, span) : full;
  return {
    ndjson: serializeFixture(snapshot, span, capturedAt),
    eventCount: snapshot.events.length,
  };
}

// Restore a fixture into a disconnected spine. [LAW:no-silent-failure] a live connection or a malformed
// fixture is returned as a loud, explanatory failure — never a silent no-op or a half-loaded spine.
export function applyFixtureNdjson(
  appEvents: AppEventLog,
  ndjson: string,
  connectionState: ConnectionState,
): FixtureApplyResult {
  if (isLive(connectionState)) {
    return {
      ok: false,
      error: `cannot replay while connected (state: ${connectionState}); disconnect first to enter replay-only mode`,
    };
  }
  let events: AppEvent[];
  try {
    events = parseFixture(ndjson).events;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  appEvents.restore(events);
  return { ok: true, eventCount: events.length };
}

function sliceSnapshot(snapshot: AppEventLogSnapshot, span: SpanRange): AppEventLogSnapshot {
  const events = snapshot.events.filter((e) => e.seq >= span.fromSeq && e.seq <= span.toSeq);
  return {
    events,
    // [LAW:one-source-of-truth] totalSeen keeps its one meaning — events the source log ever saw — for
    // a span exactly as for a whole-log capture, so the header field never means two different things.
    // The slice size is `events.length` (the header's eventCount); totalSeen is not redefined to it.
    totalSeen: snapshot.totalSeen,
    capacity: snapshot.capacity,
    oldestFrameSeq: events.map(eventFrameSeq).find((fs) => fs !== null) ?? null,
  };
}
