import { describe, expect, it } from 'vitest';
import { APP_ENTITY, eventFrameSeq, type AppEvent, type AppEventLogSnapshot } from './domain';
import {
  FIXTURE_SENTINEL,
  FIXTURE_VERSION,
  FixtureFormatError,
  parseFixture,
  serializeFixture,
} from './fixture';

const wire = (seq: number): AppEvent => ({
  kind: 'wire-frame',
  seq,
  at: 1_000 + seq,
  frameSeq: seq,
  entity: APP_ENTITY,
  causedBy: null,
  payload: { direction: 'out', size: 12, messageKind: 'listSessionsRequest', requestId: String(seq) },
});

const snapshot = (events: AppEvent[]): AppEventLogSnapshot => ({
  events,
  totalSeen: events.length,
  capacity: 5000,
  oldestFrameSeq: events.length ? eventFrameSeq(events[0]) : null,
});

describe('fixture codec', () => {
  it('round-trips a snapshot through NDJSON, preserving every event verbatim', () => {
    const snap = snapshot([wire(1), wire(2), wire(3)]);
    const { meta, events } = parseFixture(serializeFixture(snap, null, 999));
    expect(events).toEqual(snap.events);
    expect(meta.fixture).toBe(FIXTURE_SENTINEL);
    expect(meta.version).toBe(FIXTURE_VERSION);
    expect(meta.capturedAt).toBe(999);
    expect(meta.eventCount).toBe(3);
    expect(meta.span).toBeNull();
  });

  it('is deterministic: the same snapshot serializes byte-identically', () => {
    const snap = snapshot([wire(1), wire(2)]);
    expect(serializeFixture(snap, null, 42)).toBe(serializeFixture(snap, null, 42));
  });

  it('emits NDJSON — one header line plus one event per line', () => {
    const text = serializeFixture(snapshot([wire(1), wire(2)]), null, 0);
    expect(text.split('\n').filter((l) => l.length > 0)).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('carries the span on the header when capturing a sub-range', () => {
    const { meta } = parseFixture(serializeFixture(snapshot([wire(2)]), { fromSeq: 2, toSeq: 2 }, 0));
    expect(meta.span).toEqual({ fromSeq: 2, toSeq: 2 });
  });

  it('rejects an empty file', () => {
    expect(() => parseFixture('')).toThrow(FixtureFormatError);
  });

  it('rejects a foreign file (wrong sentinel)', () => {
    expect(() => parseFixture('{"fixture":"something-else","version":1,"eventCount":0}\n')).toThrow(
      /not an iterm2-wire-log fixture/,
    );
  });

  it('rejects an unsupported version', () => {
    const header = JSON.stringify({ fixture: FIXTURE_SENTINEL, version: 99, eventCount: 0 });
    expect(() => parseFixture(header + '\n')).toThrow(/unsupported fixture version/);
  });

  it('rejects a truncated body (fewer events than the header claims)', () => {
    const text = serializeFixture(snapshot([wire(1), wire(2)]), null, 0);
    const truncated = text.split('\n').slice(0, 2).join('\n') + '\n'; // header + 1 of 2 events
    expect(() => parseFixture(truncated)).toThrow(/claims 2 events but body has 1/);
  });

  it('rejects an event line with no numeric seq', () => {
    const header = JSON.stringify({ fixture: FIXTURE_SENTINEL, version: FIXTURE_VERSION, eventCount: 1 });
    const text = header + '\n' + JSON.stringify({ kind: 'wire-frame' }) + '\n';
    expect(() => parseFixture(text)).toThrow(/no numeric seq/);
  });

  it('rejects an event line with an unknown kind', () => {
    const header = JSON.stringify({ fixture: FIXTURE_SENTINEL, version: FIXTURE_VERSION, eventCount: 1 });
    const text = header + '\n' + JSON.stringify({ seq: 1, kind: 'made-up' }) + '\n';
    expect(() => parseFixture(text)).toThrow(/unknown kind/);
  });

  it('rejects a non-JSON event line', () => {
    const header = JSON.stringify({ fixture: FIXTURE_SENTINEL, version: FIXTURE_VERSION, eventCount: 1 });
    expect(() => parseFixture(header + '\nnot json\n')).toThrow(/event line 1 is not valid JSON/);
  });
});
