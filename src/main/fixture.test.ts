import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ENTITY, type AppEventInput } from '@shared/domain';
import { AppEventLog } from './stores/AppEventLog';
import { applyFixtureNdjson, buildFixtureNdjson } from './fixture';

// The fixture the e2e replay test loads; replaying it here in CI guards it from rotting out of the
// format the codec accepts (the e2e is skipped on CI runners).
const SAMPLE_FIXTURE = path.join(process.cwd(), 'e2e/fixtures/sample-wire-log.ndjson');

const SESSION = { kind: 'session', windowId: '', tabId: '', sessionId: 's1' } as const;

function wireFrame(frameSeq: number, direction: 'out' | 'in' = 'in'): AppEventInput {
  return {
    kind: 'wire-frame',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: APP_ENTITY,
    causedBy: null,
    payload: { direction, size: 12, messageKind: 'notification', requestId: '0' },
  };
}

function notification(frameSeq: number): AppEventInput {
  return {
    kind: 'notification',
    at: 1_000 + frameSeq,
    frameSeq,
    entity: SESSION,
    causedBy: null,
    payload: { kind: 'variable-changed', sessionId: 's1', summary: 'changed', detail: null },
  };
}

function seeded(): AppEventLog {
  const log = new AppEventLog();
  log.append(wireFrame(1, 'out'));
  log.append(wireFrame(1, 'in'));
  log.append(notification(2));
  return log;
}

describe('buildFixtureNdjson / applyFixtureNdjson', () => {
  it('captures the spine and replays it deterministically into a disconnected log', () => {
    const source = seeded();
    const captured = buildFixtureNdjson(source, null, 1234);
    expect(captured.eventCount).toBe(3);

    const target = new AppEventLog();
    const result = applyFixtureNdjson(target, captured.ndjson, 'idle');

    expect(result).toEqual({ ok: true, eventCount: 3 });
    // The replayed spine projects exactly what the captured one did — the acceptance criterion.
    expect(target.snapshot().events).toEqual(source.snapshot().events);
  });

  it('replays the same fixture identically every time (determinism)', () => {
    const ndjson = buildFixtureNdjson(seeded(), null, 0).ndjson;
    const a = new AppEventLog();
    const b = new AppEventLog();
    applyFixtureNdjson(a, ndjson, 'idle');
    applyFixtureNdjson(b, ndjson, 'error');
    expect(a.snapshot().events).toEqual(b.snapshot().events);
  });

  it('captures only the requested span', () => {
    const captured = buildFixtureNdjson(seeded(), { fromSeq: 2, toSeq: 3 }, 0);
    expect(captured.eventCount).toBe(2);

    const target = new AppEventLog();
    applyFixtureNdjson(target, captured.ndjson, 'idle');
    expect(target.events().map((e) => e.seq)).toEqual([2, 3]);
  });

  it.each(['detecting', 'requesting-cookie', 'connecting', 'ready', 'reconnecting'] as const)(
    'refuses to replay while connected (state: %s) and leaves the spine untouched',
    (state) => {
      const ndjson = buildFixtureNdjson(seeded(), null, 0).ndjson;
      const target = new AppEventLog();
      target.append(notification(9));

      const result = applyFixtureNdjson(target, ndjson, state);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/cannot replay while connected/);
      // [LAW:no-silent-failure] the refusal is a true no-op — no half-load.
      expect(target.events().map((e) => e.kind)).toEqual(['notification']);
    },
  );

  it('returns a loud failure for a malformed fixture rather than a partial load', () => {
    const target = new AppEventLog();
    const result = applyFixtureNdjson(target, 'garbage\n', 'idle');
    expect(result.ok).toBe(false);
    expect(target.events()).toHaveLength(0);
  });

  it('replays the bundled sample fixture used by the e2e replay test', () => {
    const ndjson = readFileSync(SAMPLE_FIXTURE, 'utf8');
    const target = new AppEventLog();
    const result = applyFixtureNdjson(target, ndjson, 'idle');
    expect(result).toEqual({ ok: true, eventCount: 5 });
    expect(target.events().map((e) => e.kind)).toEqual([
      'wire-frame',
      'wire-frame',
      'wire-frame',
      'wire-frame',
      'notification',
    ]);
  });
});
