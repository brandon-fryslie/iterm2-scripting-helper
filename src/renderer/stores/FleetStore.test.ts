import { describe, expect, it } from 'vitest';
import { FleetStore } from './FleetStore';
import type { FleetSnapshot } from '@shared/fleetQuery';

function snapshotWith(sessions: FleetSnapshot['sessions']): FleetSnapshot {
  return { sessions, failures: [], capturedAt: 1 };
}

function sessionRecord(id: string, path: string): FleetSnapshot['sessions'][number] {
  return {
    ref: { kind: 'session', windowId: 'w', tabId: 't', sessionId: id },
    title: id,
    columns: 80,
    rows: 24,
    variables: { 'path': path },
    lastPrompt: null,
  };
}

describe('FleetStore', () => {
  it('opens with one default pwd/contains row', () => {
    const store = new FleetStore();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ field: 'pwd', op: 'contains', value: '' });
  });

  it('an empty-value default row produces no predicates, so every session matches', () => {
    const store = new FleetStore();
    store.applySnapshot(snapshotWith([sessionRecord('a', '/x'), sessionRecord('b', '/y')]));
    expect(store.query.predicates).toEqual([]);
    expect(store.results.map((r) => r.sessionId)).toEqual(['a', 'b']);
  });

  it('a filled row filters the results through the pure evaluator', () => {
    const store = new FleetStore();
    store.applySnapshot(
      snapshotWith([sessionRecord('code', '/Users/me/code'), sessionRecord('home', '/Users/me')]),
    );
    store.setRowValue(store.rows[0].id, 'code');
    expect(store.results.map((r) => r.sessionId)).toEqual(['code']);
  });

  it('switching a row to a number field resets an op that no longer applies', () => {
    const store = new FleetStore();
    const id = store.rows[0].id;
    expect(store.rows[0].op).toBe('contains');
    store.setRowField(id, 'lastExitCode');
    // 'contains' is not a number op — it resets to a valid default rather than stranding an uncompilable row.
    expect(store.rows[0].op).not.toBe('contains');
    expect(store.query.predicates).toEqual([]); // empty value still yields no predicate
  });

  it('keeps a still-valid op when switching between same-typed fields', () => {
    const store = new FleetStore();
    const id = store.rows[0].id;
    store.setRowOp(id, 'startsWith');
    store.setRowField(id, 'jobName'); // also a string field
    expect(store.rows[0].op).toBe('startsWith');
  });

  it('add / remove / clear rows', () => {
    const store = new FleetStore();
    store.addRow();
    expect(store.rows).toHaveLength(2);
    store.removeRow(store.rows[0].id);
    expect(store.rows).toHaveLength(1);
    store.clearRows();
    expect(store.rows).toHaveLength(0);
  });

  it('combines multiple rows under the chosen connective', () => {
    const store = new FleetStore();
    store.applySnapshot(
      snapshotWith([sessionRecord('a', '/code/app'), sessionRecord('b', '/code/lib')]),
    );
    store.setRowValue(store.rows[0].id, 'code');
    store.addRow();
    store.setRowValue(store.rows[1].id, 'app');
    store.setConnective('and');
    expect(store.results.map((r) => r.sessionId)).toEqual(['a']);
    store.setConnective('or');
    expect(store.results.map((r) => r.sessionId)).toEqual(['a', 'b']);
  });
});
