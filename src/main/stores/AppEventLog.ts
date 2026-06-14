import {
  eventFrameSeq,
  type AppEvent,
  type AppEventInput,
  type AppEventKind,
  type AppEventLogSnapshot,
} from '@shared/domain';
import type { Invocation } from '@shared/rpc';

// [LAW:carrying-cost] One ring now holds wire frames, notifications, and variable changes
// interleaved, where three islands each held their own. Sized generously so a single domain's churn
// does not evict another's provenance prematurely; eviction, when it happens, degrades loudly
// (resolveFrame -> 'evicted') rather than silently.
const DEFAULT_CAPACITY = 5000;

// [LAW:no-silent-failure] Resolving a frameSeq has three honest outcomes, made representable so a
// consumer can never mistake "scrolled out of the ring" for "wrong frame" or "no such frame".
export type FrameResolution =
  | { status: 'found'; events: AppEvent[] }
  | { status: 'evicted'; frameSeq: number }
  | { status: 'unknown'; frameSeq: number };

// [LAW:no-shared-mutable-globals] The single owner of the append-only event spine: one ring, one seq
// counter, one explicit API. Wire frames, notifications, and variable changes are appended here by
// their producers; every pane is a projection of this log and every live-state view a fold of it.
export class AppEventLog {
  private readonly capacity: number;
  private ring: (AppEvent | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  private readonly totals = new Map<AppEventKind, number>();
  private maxFrameSeq = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<AppEvent | undefined>(capacity);
  }

  // [LAW:single-enforcer] The one place a seq is minted. Producers hand the log everything but the
  // seq; the log owns append order so no two events can claim the same identity.
  append(event: AppEventInput): AppEvent {
    const full = { ...event, seq: this.nextSeq++ } as AppEvent;
    this.ring[this.head] = full;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totals.set(full.kind, (this.totals.get(full.kind) ?? 0) + 1);
    const fs = eventFrameSeq(full);
    if (fs !== null && fs > this.maxFrameSeq) this.maxFrameSeq = fs;
    return full;
  }

  clear(): void {
    this.ring = new Array<AppEvent | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.nextSeq = 1;
    this.totals.clear();
    this.maxFrameSeq = 0;
  }

  // [LAW:one-source-of-truth] The exact inverse of `snapshot()`: load full events back into the ring
  // verbatim — seq, frameSeq and causedBy preserved — so a replayed fixture projects identically to the
  // live session that produced it, and the same provenance joins still resolve. Internal bookkeeping
  // (totals, the eviction watermark, the next seq) is derived from the loaded events alone, never from
  // the caller, so the restored log cannot disagree with its own contents. Events beyond `capacity`
  // keep the newest, mirroring how the ring evicts live. `restore` replaces the whole ring, so it owns
  // the spine completely — a replay never interleaves with stale state.
  restore(events: AppEvent[]): void {
    this.clear();
    const start = events.length > this.capacity ? events.length - this.capacity : 0;
    for (let i = start; i < events.length; i += 1) {
      const e = events[i];
      this.ring[this.head] = e;
      this.head = (this.head + 1) % this.capacity;
      if (this.length < this.capacity) this.length += 1;
      this.totals.set(e.kind, (this.totals.get(e.kind) ?? 0) + 1);
      const fs = eventFrameSeq(e);
      if (fs !== null && fs > this.maxFrameSeq) this.maxFrameSeq = fs;
      if (e.seq >= this.nextSeq) this.nextSeq = e.seq + 1;
    }
  }

  totalSeen(kind: AppEventKind): number {
    return this.totals.get(kind) ?? 0;
  }

  // Oldest-to-newest, copied out so callers cannot mutate the ring.
  events(): AppEvent[] {
    const out: AppEvent[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i += 1) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) out.push(e);
    }
    return out;
  }

  // [LAW:no-ambient-temporal-coupling] The provenance join: gather every retained event minted from
  // one frame. No timestamp windowing — events are matched by the frameSeq they were stamped with at
  // production. Distinguishes a frame still in the ring (found) from one that scrolled out (evicted,
  // loud) from one that never existed (unknown).
  resolveFrame(frameSeq: number): FrameResolution {
    const events = this.events().filter((e) => eventFrameSeq(e) === frameSeq);
    if (events.length > 0) return { status: 'found', events };
    if (frameSeq >= 1 && frameSeq <= this.maxFrameSeq) {
      return { status: 'evicted', frameSeq };
    }
    return { status: 'unknown', frameSeq };
  }

  snapshot(): AppEventLogSnapshot {
    const events = this.events();
    return {
      events,
      totalSeen: [...this.totals.values()].reduce((a, b) => a + b, 0),
      capacity: this.capacity,
      // Frame-derived events are appended in frameSeq order, so the oldest one that carries a frame
      // carries the oldest frame. Actions (frameSeq-absent) are skipped — they are not frames and
      // must not blank out the eviction watermark just by being the oldest retained event.
      oldestFrameSeq: events.map(eventFrameSeq).find((fs) => fs !== null) ?? null,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Projections — a per-domain view is a pure fold of the one log.

// [LAW:one-source-of-truth] Server-originated RPC invocations are a filter of the spine too; the
// registration store no longer owns a private invocation ring. `seq` is the spine seq (global append
// order), which serves the same identity role the store's private counter used to.
export function invocationProjection(
  log: AppEventLog,
): { invocations: Invocation[]; totalInvocations: number } {
  const invocations: Invocation[] = log
    .events()
    .filter((e): e is Extract<AppEvent, { kind: 'invocation' }> => e.kind === 'invocation')
    .map((e) => ({
      seq: e.seq,
      at: e.at,
      registrationId: e.payload.registrationId,
      requestId: e.payload.requestId,
      args: e.payload.args,
      responded: e.payload.responded,
      responseJson: e.payload.responseJson,
      error: e.payload.error,
    }));
  return { invocations, totalInvocations: log.totalSeen('invocation') };
}
