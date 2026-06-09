import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableStore, VARIABLE_HISTORY_LIMIT } from './VariableStore';
import { AppEventLog } from './AppEventLog';
import type { AppEvent } from '@shared/domain';

const SESSION_ENTITY = {
  kind: 'session',
  windowId: 'window-1',
  tabId: 'tab-1',
  sessionId: 'session-1',
} as const;

// The store now mints variable-change events into the spine; every test gives it a real log so the
// fold and the event stream are exercised together.
function makeStore(): { store: VariableStore; log: AppEventLog } {
  const log = new AppEventLog();
  return { store: new VariableStore(log), log };
}

function variableChanges(log: AppEventLog): Extract<AppEvent, { kind: 'variable-change' }>[] {
  return log
    .events()
    .filter((e): e is Extract<AppEvent, { kind: 'variable-change' }> => e.kind === 'variable-change');
}

describe('VariableStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives current/previous/updatedAt from change history', () => {
    vi.setSystemTime(1_000);
    const { store } = makeStore();
    store.setFocusedEntity(SESSION_ENTITY);

    store.applyDump(SESSION_ENTITY, {
      'session.name': 'alpha',
      'user.flag': true,
    }, 10);

    vi.setSystemTime(2_000);
    store.applyDump(SESSION_ENTITY, {
      'session.name': 'beta',
      'user.flag': true,
    }, 20);

    const variables = store.snapshot().variables;
    expect(variables).toEqual([
      {
        name: 'session.name',
        value: '"beta"',
        previousValue: '"alpha"',
        live: false,
        updatedAt: 2_000,
        scope: 'session',
        history: [
          { value: '"beta"', at: 2_000 },
          { value: '"alpha"', at: 1_000 },
        ],
      },
      {
        // A value observed once but never changed has no previous value.
        name: 'user.flag',
        value: 'true',
        previousValue: null,
        live: false,
        updatedAt: 1_000,
        scope: 'user',
        history: [{ value: 'true', at: 1_000 }],
      },
    ]);
  });

  it('accrues history from live protocol changes keyed by scope identity', () => {
    vi.setSystemTime(3_000);
    const { store } = makeStore();
    const appEntity = { kind: 'app' } as const;
    store.setFocusedEntity(appEntity);

    store.applyChange('', 'app.theme', '"dark"', 'app', 1);
    vi.setSystemTime(4_000);
    store.applyChange('', 'app.theme', '"light"', 'app', 2);

    expect(store.snapshot().variables).toEqual([
      {
        name: 'app.theme',
        value: '"light"',
        previousValue: '"dark"',
        live: false,
        updatedAt: 4_000,
        scope: 'app',
        history: [
          { value: '"light"', at: 4_000 },
          { value: '"dark"', at: 3_000 },
        ],
      },
    ]);
  });

  it('ignores re-observations that do not change the value', () => {
    vi.setSystemTime(5_000);
    const { store, log } = makeStore();
    store.setFocusedEntity(SESSION_ENTITY);

    store.applyChange('session-1', 'session.name', '"same"', 'session', 7);
    vi.setSystemTime(6_000);
    store.applyChange('session-1', 'session.name', '"same"', 'session', 8);

    const [entry] = store.snapshot().variables;
    expect(entry.history).toEqual([{ value: '"same"', at: 5_000 }]);
    expect(entry.updatedAt).toBe(5_000);
    expect(entry.previousValue).toBeNull();

    // [LAW:one-source-of-truth] The dedup that suppresses a history entry must also suppress a spine
    // event, or the timeline and the history would disagree about whether a change happened.
    expect(variableChanges(log)).toHaveLength(1);
  });

  it('bounds history to the most recent VARIABLE_HISTORY_LIMIT changes', () => {
    const { store } = makeStore();
    store.setFocusedEntity(SESSION_ENTITY);
    const total = VARIABLE_HISTORY_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      vi.setSystemTime(1_000 + i);
      store.applyChange('session-1', 'session.tick', `${i}`, 'session', i);
    }

    const [entry] = store.snapshot().variables;
    expect(entry.history).toHaveLength(VARIABLE_HISTORY_LIMIT);
    // Most-recent-first: head is the latest change.
    expect(entry.history[0]).toEqual({ value: `${total - 1}`, at: 1_000 + total - 1 });
  });

  it('reflects live names as a derived projection of the watchlist', () => {
    const { store } = makeStore();
    store.setFocusedEntity(SESSION_ENTITY);
    store.applyChange('session-1', 'session.name', '"alpha"', 'session', 1);

    expect(store.snapshot().variables[0].live).toBe(false);
    store.setLiveNames(['session.name']);
    expect(store.snapshot().variables[0].live).toBe(true);
  });

  it('returns IPC-cloneable snapshots', () => {
    const { store } = makeStore();
    store.setFocusedEntity(SESSION_ENTITY);
    store.applyDump(SESSION_ENTITY, { 'session.name': 'alpha' }, 5);

    expect(structuredClone(store.snapshot())).toEqual(store.snapshot());
  });

  it('mints a subscription variable-change event carrying the notification frameSeq', () => {
    vi.setSystemTime(9_000);
    const { store, log } = makeStore();
    store.applyChange('session-1', 'session.name', '"alpha"', 'session', 42);
    store.applyChange('session-1', 'session.name', '"beta"', 'session', 43);

    expect(variableChanges(log).map((e) => e.payload)).toEqual([
      {
        name: 'session.name',
        value: '"alpha"',
        previousValue: null,
        scope: 'session',
        source: 'subscription',
      },
      {
        name: 'session.name',
        value: '"beta"',
        previousValue: '"alpha"',
        scope: 'session',
        source: 'subscription',
      },
    ]);
    expect(variableChanges(log).map((e) => e.frameSeq)).toEqual([42, 43]);
    expect(variableChanges(log)[0].entity).toEqual(SESSION_ENTITY_WITHOUT_LAYOUT);
  });

  it('mints dump variable-change events sharing one frameSeq and no notification', () => {
    const { store, log } = makeStore();
    store.applyDump(SESSION_ENTITY, { 'session.name': 'alpha', 'session.tty': '/dev/ttys001' }, 77);

    const changes = variableChanges(log);
    expect(changes).toHaveLength(2);
    expect(changes.every((e) => e.payload.source === 'dump')).toBe(true);
    expect(changes.every((e) => e.frameSeq === 77)).toBe(true);
    // No notification event shares the dump's frameSeq — that absence is the live-vs-dump distinction.
    const resolution = log.resolveFrame(77);
    expect(resolution.status).toBe('found');
    if (resolution.status === 'found') {
      expect(resolution.events.some((e) => e.kind === 'notification')).toBe(false);
    }
  });
});

// applyChange builds a session entity from the scope identifier alone, so window/tab are unknown.
const SESSION_ENTITY_WITHOUT_LAYOUT = {
  kind: 'session',
  windowId: '',
  tabId: '',
  sessionId: 'session-1',
} as const;
