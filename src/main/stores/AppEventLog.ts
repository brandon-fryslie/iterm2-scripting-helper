import type {
  AppEvent,
  AppEventKind,
  AppEventLogSnapshot,
  AppNotificationEntry,
} from '@shared/domain';
import type { WireLogSnapshot, NotificationLogSnapshot } from '@shared/rpc';

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
  append(event: Omit<AppEvent, 'seq'>): AppEvent {
    const full = { ...event, seq: this.nextSeq++ } as AppEvent;
    this.ring[this.head] = full;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totals.set(full.kind, (this.totals.get(full.kind) ?? 0) + 1);
    if (full.frameSeq > this.maxFrameSeq) this.maxFrameSeq = full.frameSeq;
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
    const events = this.events().filter((e) => e.frameSeq === frameSeq);
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
      // Events are appended in frameSeq order, so the oldest retained event carries the oldest frame.
      oldestFrameSeq: events[0]?.frameSeq ?? null,
    };
  }

  capacityForProjection(): number {
    return this.capacity;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Projections — the per-domain panes are pure folds of the one log.
//
// [LAW:behavior-not-structure] These reproduce the exact snapshot shapes the renderer already
// consumes (WireLogSnapshot / NotificationLogSnapshot), so the panes keep working with no change.
// What was an island ring is now a filter over the spine.

export function wireLogProjection(log: AppEventLog): WireLogSnapshot {
  const entries = log
    .events()
    .filter((e): e is Extract<AppEvent, { kind: 'wire-frame' }> => e.kind === 'wire-frame')
    .map((e) => ({
      // [LAW:one-source-of-truth] The wire entry's identity IS the frame seq; the store no longer
      // mints a private counter for protocol-event identity.
      seq: e.frameSeq,
      at: e.at,
      direction: e.payload.direction,
      size: e.payload.size,
      kind: e.payload.messageKind,
      id: e.payload.requestId,
    }));
  return {
    entries,
    totalSeen: log.totalSeen('wire-frame'),
    capacity: log.capacityForProjection(),
  };
}

export function notificationLogProjection(log: AppEventLog): NotificationLogSnapshot {
  const entries: AppNotificationEntry[] = log
    .events()
    .filter((e): e is Extract<AppEvent, { kind: 'notification' }> => e.kind === 'notification')
    .map((e) => ({
      seq: e.seq,
      at: e.at,
      kind: e.payload.kind,
      sessionId: e.payload.sessionId,
      summary: e.payload.summary,
      payload: e.payload.detail,
    }));
  return {
    entries,
    totalSeen: log.totalSeen('notification'),
    capacity: log.capacityForProjection(),
  };
}
