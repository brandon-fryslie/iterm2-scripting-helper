import { describe, expect, it } from 'vitest';
import type { AppEntitySessionRef, AppPrompt, AppWindow } from './domain';
import {
  FLEET_FIELDS,
  FLEET_NUMBER_OPS,
  FLEET_STRING_OPS,
  FLEET_VARIABLE_NAMES,
  buildFleetSessionRecord,
  collectFleetTargets,
  compilePredicate,
  emptyFleetSnapshot,
  evaluateFleetQuery,
  fleetFieldType,
  isFleetSnapshotPartial,
  opsForField,
  type FleetFieldId,
  type FleetQuery,
  type FleetSessionRecord,
  type FleetSnapshot,
} from './fleetQuery';

function sessionRef(id: string): AppEntitySessionRef {
  return { kind: 'session', windowId: 'w1', tabId: 't1', sessionId: id };
}

function finishedPrompt(exitStatus: number): AppPrompt {
  return {
    uniquePromptId: 'p1',
    promptRange: null,
    commandRange: null,
    outputRange: null,
    workingDirectory: null,
    command: 'echo hi',
    state: 'finished',
    exitStatus,
  };
}

function runningPrompt(): AppPrompt {
  return {
    uniquePromptId: 'p1',
    promptRange: null,
    commandRange: null,
    outputRange: null,
    workingDirectory: null,
    command: 'sleep 1',
    state: 'running',
  };
}

function record(
  id: string,
  variables: Record<string, string>,
  extra: Partial<FleetSessionRecord> = {},
): FleetSessionRecord {
  return {
    ref: sessionRef(id),
    title: extra.title ?? `session ${id}`,
    columns: extra.columns ?? 80,
    rows: extra.rows ?? 24,
    variables,
    lastPrompt: extra.lastPrompt ?? null,
  };
}

function snapshotOf(records: FleetSessionRecord[]): FleetSnapshot {
  return { sessions: records, failures: [], capturedAt: 1 };
}

function ids(refs: AppEntitySessionRef[]): string[] {
  return refs.map((r) => r.sessionId);
}

describe('evaluateFleetQuery — empty / identity', () => {
  it('an empty predicate list matches every session (AND)', () => {
    const snap = snapshotOf([record('a', {}), record('b', {})]);
    const query: FleetQuery = { connective: 'and', predicates: [] };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['a', 'b']);
  });

  it('an empty predicate list matches every session even under OR', () => {
    const snap = snapshotOf([record('a', {}), record('b', {})]);
    const query: FleetQuery = { connective: 'or', predicates: [] };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['a', 'b']);
  });

  it('an empty snapshot yields no matches', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'pwd', op: 'contains', value: 'x' }],
    };
    expect(evaluateFleetQuery(emptyFleetSnapshot(5), query)).toEqual([]);
  });
});

describe('evaluateFleetQuery — string predicates', () => {
  const snap = snapshotOf([
    record('code', { 'path': '/Users/me/code/app' }),
    record('home', { 'path': '/Users/me' }),
    record('ssh', { 'jobName': 'ssh' }),
  ]);

  it('contains matches the substring, case-insensitively', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'pwd', op: 'contains', value: 'CODE' }],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['code']);
  });

  it('eq compares the whole value case-insensitively', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'jobName', op: 'eq', value: 'SSH' }],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['ssh']);
  });

  it('startsWith / endsWith anchor the match', () => {
    const starts: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'pwd', op: 'startsWith', value: '/Users/me/code' }],
    };
    expect(ids(evaluateFleetQuery(snap, starts))).toEqual(['code']);
    const ends: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'pwd', op: 'endsWith', value: 'app' }],
    };
    expect(ids(evaluateFleetQuery(snap, ends))).toEqual(['code']);
  });

  it('neq excludes the equal value but NOT sessions whose value is absent', () => {
    // [LAW:no-silent-failure] 'ssh' has no path — it must not be coerced to '' and spuriously
    // satisfy `pwd is not /Users/me`.
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'pwd', op: 'neq', value: '/Users/me' }],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['code']);
  });

  it('title and sessionId are queryable layout-derived string fields', () => {
    const titled = snapshotOf([record('a', {}, { title: 'build watcher' })]);
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'title', op: 'contains', value: 'watcher' }],
    };
    expect(ids(evaluateFleetQuery(titled, query))).toEqual(['a']);
    const byId: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'string', field: 'sessionId', op: 'eq', value: 'a' }],
    };
    expect(ids(evaluateFleetQuery(titled, byId))).toEqual(['a']);
  });
});

describe('evaluateFleetQuery — number predicates and exit codes', () => {
  const snap = snapshotOf([
    record('failed', {}, { lastPrompt: finishedPrompt(37) }),
    record('ok', {}, { lastPrompt: finishedPrompt(0) }),
    record('running', {}, { lastPrompt: runningPrompt() }),
    record('nomarks', {}, { lastPrompt: null }),
  ]);

  it('lastExitCode != 0 matches only the finished non-zero command', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'number', field: 'lastExitCode', op: 'neq', value: 0 }],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['failed']);
  });

  it('lastExitCode == 0 matches the successful command only', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'number', field: 'lastExitCode', op: 'eq', value: 0 }],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['ok']);
  });

  it('a running or unmarked session has an ABSENT exit code and matches no numeric predicate', () => {
    // [LAW:types-are-the-program] exit code exists only on a FINISHED prompt; gt/lt/eq all see absent.
    for (const op of ['gt', 'lt', 'eq', 'neq', 'gte', 'lte'] as const) {
      const query: FleetQuery = {
        connective: 'and',
        predicates: [{ type: 'number', field: 'lastExitCode', op, value: 0 }],
      };
      const matched = ids(evaluateFleetQuery(snap, query));
      expect(matched).not.toContain('running');
      expect(matched).not.toContain('nomarks');
    }
  });

  it('gt / gte / lt / lte compare numerically over grid size', () => {
    const grid = snapshotOf([
      record('wide', {}, { columns: 200 }),
      record('narrow', {}, { columns: 40 }),
    ]);
    const query: FleetQuery = {
      connective: 'and',
      predicates: [{ type: 'number', field: 'columns', op: 'gt', value: 100 }],
    };
    expect(ids(evaluateFleetQuery(grid, query))).toEqual(['wide']);
  });
});

describe('evaluateFleetQuery — AND / OR composition', () => {
  const snap = snapshotOf([
    record('match', { 'path': '/code/app', 'jobName': 'vim' }, {
      lastPrompt: finishedPrompt(1),
    }),
    record('pathOnly', { 'path': '/code/lib', 'jobName': 'bash' }, {
      lastPrompt: finishedPrompt(0),
    }),
  ]);

  it('AND requires every predicate to hold', () => {
    const query: FleetQuery = {
      connective: 'and',
      predicates: [
        { type: 'string', field: 'pwd', op: 'contains', value: 'code' },
        { type: 'number', field: 'lastExitCode', op: 'neq', value: 0 },
      ],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['match']);
  });

  it('OR matches when any predicate holds', () => {
    const query: FleetQuery = {
      connective: 'or',
      predicates: [
        { type: 'string', field: 'jobName', op: 'eq', value: 'vim' },
        { type: 'number', field: 'lastExitCode', op: 'eq', value: 0 },
      ],
    };
    expect(ids(evaluateFleetQuery(snap, query))).toEqual(['match', 'pathOnly']);
  });
});

describe('collectFleetTargets', () => {
  function windowWith(sessionIds: string[]): AppWindow {
    return {
      windowId: 'w1',
      number: 1,
      frame: null,
      tabs: [
        {
          tabId: 't1',
          tmuxWindowId: '',
          tmuxConnectionId: '',
          minimizedSessions: [],
          root: {
            vertical: false,
            children: sessionIds.map((sessionId) => ({
              kind: 'session' as const,
              session: { sessionId, title: `t-${sessionId}`, frame: null, gridSize: { width: 80, height: 24 } },
            })),
          },
        },
      ],
    };
  }

  it('flattens every window/tab/session into a target carrying its ref + layout facts', () => {
    const targets = collectFleetTargets([windowWith(['a', 'b'])]);
    expect(targets.map((t) => t.ref.sessionId)).toEqual(['a', 'b']);
    expect(targets[0]).toMatchObject({ title: 't-a', columns: 80, rows: 24 });
    expect(targets[0].ref).toEqual({ kind: 'session', windowId: 'w1', tabId: 't1', sessionId: 'a' });
  });

  it('includes minimized sessions', () => {
    const window: AppWindow = {
      windowId: 'w1',
      number: 1,
      frame: null,
      tabs: [
        {
          tabId: 't1',
          tmuxWindowId: '',
          tmuxConnectionId: '',
          root: null,
          minimizedSessions: [{ sessionId: 'min', title: 'm', frame: null, gridSize: null }],
        },
      ],
    };
    const targets = collectFleetTargets([window]);
    expect(targets.map((t) => t.ref.sessionId)).toEqual(['min']);
    expect(targets[0]).toMatchObject({ columns: null, rows: null });
  });
});

describe('buildFleetSessionRecord', () => {
  const target = { ref: sessionRef('a'), title: 'a', columns: 80, rows: 24 };

  it('keeps only the catalog variable names, coercing each to a raw string', () => {
    const built = buildFleetSessionRecord(
      target,
      { 'path': '/code', 'jobName': 'vim', 'irrelevant': 'drop me' },
      null,
    );
    expect(built.variables).toEqual({ 'path': '/code', 'jobName': 'vim' });
  });

  it('omits absent (undefined/null) variables rather than storing empty strings', () => {
    const built = buildFleetSessionRecord(target, { 'path': null }, null);
    expect(built.variables['path']).toBeUndefined();
  });

  it('carries the lastPrompt through unchanged', () => {
    const prompt = finishedPrompt(2);
    expect(buildFleetSessionRecord(target, {}, prompt).lastPrompt).toBe(prompt);
  });
});

describe('field catalog consistency', () => {
  it('every queryable variable name is sourced for the fetch', () => {
    expect(FLEET_VARIABLE_NAMES).toContain('path');
    expect(FLEET_VARIABLE_NAMES).toContain('jobName');
    // The fetch list has no duplicates.
    expect(new Set(FLEET_VARIABLE_NAMES).size).toBe(FLEET_VARIABLE_NAMES.length);
  });

  it('exposes string fields with string ops and number fields with number ops', () => {
    const stringField = FLEET_FIELDS.find((f) => f.id === 'pwd');
    const numberField = FLEET_FIELDS.find((f) => f.id === 'lastExitCode');
    expect(stringField?.type).toBe('string');
    expect(numberField?.type).toBe('number');
    expect(FLEET_STRING_OPS.map((o) => o.id)).toContain('contains');
    expect(FLEET_NUMBER_OPS.map((o) => o.id)).toContain('gt');
  });

  it('every field id appears exactly once in the UI catalog', () => {
    const seen = new Set<FleetFieldId>();
    for (const field of FLEET_FIELDS) {
      expect(seen.has(field.id)).toBe(false);
      seen.add(field.id);
    }
  });
});

describe('compilePredicate / field helpers', () => {
  it('reports field types and the ops valid for each', () => {
    expect(fleetFieldType('pwd')).toBe('string');
    expect(fleetFieldType('lastExitCode')).toBe('number');
    expect(opsForField('pwd').map((o) => o.id)).toContain('contains');
    expect(opsForField('lastExitCode').map((o) => o.id)).toContain('gt');
  });

  it('compiles a valid string row into a string predicate', () => {
    expect(compilePredicate('pwd', 'contains', 'code')).toEqual({
      type: 'string',
      field: 'pwd',
      op: 'contains',
      value: 'code',
    });
  });

  it('compiles a valid number row, parsing the value', () => {
    expect(compilePredicate('lastExitCode', 'neq', '0')).toEqual({
      type: 'number',
      field: 'lastExitCode',
      op: 'neq',
      value: 0,
    });
  });

  it('returns null for an incomplete or invalid row', () => {
    expect(compilePredicate('pwd', 'contains', '')).toBeNull();
    expect(compilePredicate('lastExitCode', 'gt', 'not-a-number')).toBeNull();
    expect(compilePredicate('lastExitCode', 'gt', '')).toBeNull();
    // An op that does not belong to the field's type never compiles.
    expect(compilePredicate('pwd', 'gt', '5')).toBeNull();
    expect(compilePredicate('lastExitCode', 'contains', '5')).toBeNull();
  });
});

describe('isFleetSnapshotPartial', () => {
  it('is false with no failures and true once a session failed to read', () => {
    expect(isFleetSnapshotPartial(snapshotOf([record('a', {})]))).toBe(false);
    expect(
      isFleetSnapshotPartial({
        sessions: [record('a', {})],
        failures: [{ ref: sessionRef('b'), reason: 'timeout' }],
        capturedAt: 1,
      }),
    ).toBe(true);
  });
});
