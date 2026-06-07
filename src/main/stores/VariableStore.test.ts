import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableStore } from './VariableStore';

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

  it('derives variable scope from path and records previous values', () => {
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
      },
      {
        name: 'user.flag',
        value: 'true',
        previousValue: 'true',
        live: false,
        updatedAt: 1_000,
        scope: 'user',
      },
    ]);
  });

  it('keys protocol changes by variable scope identity', () => {
    vi.setSystemTime(3_000);
    const store = new VariableStore();
    const appEntity = { kind: 'app' } as const;
    store.setFocusedEntity(appEntity);

    store.applyChange('', 'app.theme', '"dark"', 'app');
    store.applyChange('', 'app.theme', '"light"', 'app');

    expect(store.snapshot().variables).toEqual([
      {
        name: 'app.theme',
        value: '"light"',
        previousValue: '"dark"',
        live: false,
        updatedAt: 3_000,
        scope: 'app',
      },
    ]);
  });
});
