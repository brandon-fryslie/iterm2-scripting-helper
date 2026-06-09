import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableStore, VARIABLE_HISTORY_LIMIT } from './VariableStore';

const SESSION_ENTITY = {
  kind: 'session',
  windowId: 'window-1',
  tabId: 'tab-1',
  sessionId: 'session-1',
} as const;

describe('VariableStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives current/previous/updatedAt from change history', () => {
    vi.setSystemTime(1_000);
    const store = new VariableStore();
    store.setFocusedEntity(SESSION_ENTITY);

    store.applyDump(SESSION_ENTITY, {
      'session.name': 'alpha',
      'user.flag': true,
    });

    vi.setSystemTime(2_000);
    store.applyDump(SESSION_ENTITY, {
      'session.name': 'beta',
      'user.flag': true,
    });

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
    const store = new VariableStore();
    const appEntity = { kind: 'app' } as const;
    store.setFocusedEntity(appEntity);

    store.applyChange('', 'app.theme', '"dark"', 'app');
    vi.setSystemTime(4_000);
    store.applyChange('', 'app.theme', '"light"', 'app');

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
    const store = new VariableStore();
    store.setFocusedEntity(SESSION_ENTITY);

    store.applyChange('session-1', 'session.name', '"same"');
    vi.setSystemTime(6_000);
    store.applyChange('session-1', 'session.name', '"same"');

    const [entry] = store.snapshot().variables;
    expect(entry.history).toEqual([{ value: '"same"', at: 5_000 }]);
    expect(entry.updatedAt).toBe(5_000);
    expect(entry.previousValue).toBeNull();
  });

  it('bounds history to the most recent VARIABLE_HISTORY_LIMIT changes', () => {
    const store = new VariableStore();
    store.setFocusedEntity(SESSION_ENTITY);
    const total = VARIABLE_HISTORY_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      vi.setSystemTime(1_000 + i);
      store.applyChange('session-1', 'session.tick', `${i}`);
    }

    const [entry] = store.snapshot().variables;
    expect(entry.history).toHaveLength(VARIABLE_HISTORY_LIMIT);
    // Most-recent-first: head is the latest change.
    expect(entry.history[0]).toEqual({ value: `${total - 1}`, at: 1_000 + total - 1 });
  });

  it('reflects live names as a derived projection of the watchlist', () => {
    const store = new VariableStore();
    store.setFocusedEntity(SESSION_ENTITY);
    store.applyChange('session-1', 'session.name', '"alpha"');

    expect(store.snapshot().variables[0].live).toBe(false);
    store.setLiveNames(['session.name']);
    expect(store.snapshot().variables[0].live).toBe(true);
  });

  it('returns IPC-cloneable snapshots', () => {
    const store = new VariableStore();
    store.setFocusedEntity(SESSION_ENTITY);
    store.applyDump(SESSION_ENTITY, { 'session.name': 'alpha' });

    expect(structuredClone(store.snapshot())).toEqual(store.snapshot());
  });
});
