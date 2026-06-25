import { makeAutoObservable, runInAction } from 'mobx';
import {
  compilePredicate,
  emptyFleetSnapshot,
  evaluateFleetQuery,
  opsForField,
  type FleetConnective,
  type FleetFieldId,
  type FleetPredicate,
  type FleetQuery,
  type FleetSnapshot,
} from '@shared/fleetQuery';
import type { AppEntitySessionRef } from '@shared/domain';

// An editable query row: its op/value are raw text until compiled. An incomplete or invalid row simply
// contributes no predicate ([LAW:dataflow-not-control-flow] — validity is a value the `query` getter folds
// away, not a branch that decides whether to render the row).
export interface FleetDraftRow {
  id: string;
  field: FleetFieldId;
  op: string;
  value: string;
}

function defaultOp(field: FleetFieldId): string {
  return opsForField(field)[0].id;
}

function opValidForField(field: FleetFieldId, op: string): boolean {
  return opsForField(field).some((option) => option.id === op);
}

// [LAW:one-source-of-truth] The renderer's view of the Fleet Query Console: the latest snapshot (pushed
// from main), the editable query (connective + draft rows), and the DERIVED results. `results` is a pure
// computed over (snapshot, query) — editing the query re-evaluates with zero bridge traffic, because the
// expensive boundary (the capture) already happened and the query is cheap pure computation over it.
export class FleetStore {
  current: FleetSnapshot = emptyFleetSnapshot(0);
  connective: FleetConnective = 'and';
  rows: FleetDraftRow[] = [];
  refreshing = false;
  private rowSeq = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // Open ready to type: one default row (pwd contains …) so the common "which sessions are in dir X"
    // query needs only a value and Refresh, no dropdown wrangling.
    this.addRow();
  }

  applySnapshot(snapshot: FleetSnapshot): void {
    this.current = snapshot;
    // A fresh snapshot is the answer to the capture our refresh scheduled; the only producer of fleet
    // snapshots is our own capture, so its arrival is the honest end of the refreshing state.
    this.refreshing = false;
  }

  setConnective(connective: FleetConnective): void {
    this.connective = connective;
  }

  addRow(): void {
    // A new row is always pwd, whose natural default for a fleet query is `contains` ("which sessions are
    // in dir X"). defaultOp still governs the reset when a row is later switched to an incompatible type.
    this.rows = [
      ...this.rows,
      { id: `row-${this.rowSeq++}`, field: 'pwd', op: 'contains', value: '' },
    ];
  }

  removeRow(id: string): void {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  setRowField(id: string, field: FleetFieldId): void {
    // Switching a row to a field of a different type would strand an op that no longer applies (e.g.
    // `contains` on a number field), so the op resets to a valid default exactly when the current one
    // no longer fits — never silently kept to produce an uncompilable row.
    this.rows = this.rows.map((row) =>
      row.id === id
        ? { ...row, field, op: opValidForField(field, row.op) ? row.op : defaultOp(field) }
        : row,
    );
  }

  setRowOp(id: string, op: string): void {
    this.rows = this.rows.map((row) => (row.id === id ? { ...row, op } : row));
  }

  setRowValue(id: string, value: string): void {
    this.rows = this.rows.map((row) => (row.id === id ? { ...row, value } : row));
  }

  clearRows(): void {
    this.rows = [];
  }

  get query(): FleetQuery {
    const predicates = this.rows
      .map((row) => compilePredicate(row.field, row.op, row.value))
      .filter((predicate): predicate is FleetPredicate => predicate !== null);
    return { connective: this.connective, predicates };
  }

  get results(): AppEntitySessionRef[] {
    return evaluateFleetQuery(this.current, this.query);
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      await window.ipc.invoke('fleet/refresh', undefined as never);
    } catch (error) {
      // [LAW:no-silent-failure] A failed refresh request must not leave the UI stuck "refreshing".
      runInAction(() => {
        this.refreshing = false;
      });
      throw error;
    }
  }
}
