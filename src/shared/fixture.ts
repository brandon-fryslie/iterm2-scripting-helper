import {
  type AppEvent,
  type AppEventKind,
  type AppEventLogSnapshot,
} from './domain';

// A wire-log fixture is the spine itself, persisted. The renderer is a pure projection of the
// AppEventLog snapshot ([LAW:one-source-of-truth]), so the faithful unit to capture and replay is the
// AppEvent — not the raw wire bytes (which the spine deliberately omits and the UI never displays) and
// not a second decoded projection. Replaying a fixture reproduces exactly what the live UI showed,
// because the same events flow through the same projection.
//
// The on-disk form is NDJSON: line 0 is a versioned header, every subsequent line is one AppEvent.
// One-event-per-line keeps a large span streamable and diff-friendly, and makes a truncated capture a
// loud parse failure rather than a silently short replay ([LAW:no-silent-failure]).

export const FIXTURE_SENTINEL = 'iterm2-wire-log';
export const FIXTURE_VERSION = 1;

// A captured sub-range of the spine, identified by the seq bounds of the events it contains
// (inclusive). null on the header means "the whole retained log was captured".
export interface SpanRange {
  fromSeq: number;
  toSeq: number;
}

// [LAW:types-are-the-program] The header is self-describing and self-validating: `fixture` is the
// sentinel a reader checks before trusting anything else, `version` gates format compatibility, and
// `eventCount` lets a reader confirm it read every event line (a truncated file fails loudly). The
// remaining fields are the snapshot bookkeeping (totalSeen/capacity/oldestFrameSeq) carried for
// provenance; they describe the original live log, while the restored log derives its own state from
// the events alone.
export interface FixtureMeta {
  fixture: typeof FIXTURE_SENTINEL;
  version: number;
  capturedAt: number;
  totalSeen: number;
  capacity: number;
  oldestFrameSeq: number | null;
  span: SpanRange | null;
  eventCount: number;
}

export interface ParsedFixture {
  meta: FixtureMeta;
  events: AppEvent[];
}

// The closed set of event kinds a fixture line may carry. A line whose `kind` is outside this set is a
// corrupt or future-format fixture, rejected loudly rather than restored as an unprojectable event.
const EVENT_KINDS: ReadonlySet<string> = new Set<AppEventKind>([
  'wire-frame',
  'notification',
  'variable-change',
  'action',
  'invocation',
]);

export class FixtureFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureFormatError';
  }
}

// [LAW:effects-at-boundaries] Pure: it computes the text, it does not write it. `capturedAt` is an
// input, never read from the clock here, so the same snapshot serializes byte-identically every time —
// the property the deterministic-replay acceptance rests on. The returned string ends in a newline so
// every line (including the last event) is terminated, the convention NDJSON readers expect.
export function serializeFixture(snapshot: AppEventLogSnapshot, span: SpanRange | null, capturedAt: number): string {
  const meta: FixtureMeta = {
    fixture: FIXTURE_SENTINEL,
    version: FIXTURE_VERSION,
    capturedAt,
    totalSeen: snapshot.totalSeen,
    capacity: snapshot.capacity,
    oldestFrameSeq: snapshot.oldestFrameSeq,
    span,
    eventCount: snapshot.events.length,
  };
  const lines = [JSON.stringify(meta), ...snapshot.events.map((e) => JSON.stringify(e))];
  return lines.join('\n') + '\n';
}

// [LAW:no-silent-failure] Every way a fixture can be malformed becomes a thrown FixtureFormatError
// naming the offending line — an empty file, a non-JSON line, a missing/old sentinel, an unsupported
// version, an event with no numeric seq or an unknown kind, or a body shorter than the header claims.
// A reader can never mistake a truncated or foreign file for a short-but-valid replay.
export function parseFixture(text: string): ParsedFixture {
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new FixtureFormatError('empty fixture: no header line');
  }

  let header: unknown;
  try {
    header = JSON.parse(lines[0]);
  } catch (err) {
    throw new FixtureFormatError(`header line is not valid JSON: ${errText(err)}`);
  }
  const meta = validateMeta(header);

  const events: AppEvent[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      throw new FixtureFormatError(`event line ${i} is not valid JSON: ${errText(err)}`);
    }
    events.push(validateEvent(parsed, i));
  }

  if (events.length !== meta.eventCount) {
    throw new FixtureFormatError(
      `fixture header claims ${meta.eventCount} events but body has ${events.length}`,
    );
  }
  return { meta, events };
}

function validateMeta(value: unknown): FixtureMeta {
  if (typeof value !== 'object' || value === null) {
    throw new FixtureFormatError('header line is not an object');
  }
  const m = value as Record<string, unknown>;
  if (m.fixture !== FIXTURE_SENTINEL) {
    throw new FixtureFormatError(
      `not an ${FIXTURE_SENTINEL} fixture (header.fixture = ${JSON.stringify(m.fixture)})`,
    );
  }
  if (m.version !== FIXTURE_VERSION) {
    throw new FixtureFormatError(
      `unsupported fixture version ${JSON.stringify(m.version)} (this build reads ${FIXTURE_VERSION})`,
    );
  }
  if (typeof m.eventCount !== 'number') {
    throw new FixtureFormatError('header.eventCount is missing or not a number');
  }
  return m as unknown as FixtureMeta;
}

function validateEvent(value: unknown, line: number): AppEvent {
  if (typeof value !== 'object' || value === null) {
    throw new FixtureFormatError(`event line ${line} is not an object`);
  }
  const e = value as Record<string, unknown>;
  if (typeof e.seq !== 'number') {
    throw new FixtureFormatError(`event line ${line} has no numeric seq`);
  }
  if (typeof e.kind !== 'string' || !EVENT_KINDS.has(e.kind)) {
    throw new FixtureFormatError(`event line ${line} has unknown kind ${JSON.stringify(e.kind)}`);
  }
  return e as unknown as AppEvent;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
