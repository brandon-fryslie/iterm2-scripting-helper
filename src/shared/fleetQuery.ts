// The Fleet Query Console's pure core: a typed query model over an in-memory snapshot of every live
// session, its variable scopes, and its OSC-133 exit code. The EVALUATOR is a pure function of
// (snapshot, query) — no IO ([LAW:effects-at-boundaries]); the fetch that BUILDS the snapshot is the
// boundary (the orchestrator), and the two helpers here (collectFleetTargets, buildFleetSessionRecord)
// keep that boundary dumb about field semantics by owning them in one catalog.
import type { AppEntitySessionRef, AppPrompt, AppWindow } from './domain';
import { flatSessions } from './domain';

// ───────────────────────────────────────────────────────────────────────────
// The field catalog — the single source of truth for what is queryable.
//
// [LAW:types-are-the-program] Field ids are a CLOSED union split by the value type they produce, not an
// open `string`. A predicate pairs a field with a type-matched operator (below), so an illegal pairing
// like `pwd > 5` (string field, numeric op) is unrepresentable — not a runtime "unknown field" string
// match the ticket explicitly forbids. Adding a field is a deliberate edit here, capped by intent
// ([LAW:no-mode-explosion]), never an open-ended expression language.

export type FleetStringFieldId =
  | 'pwd'
  | 'jobName'
  | 'username'
  | 'hostname'
  | 'tty'
  | 'title'
  | 'sessionId';

export type FleetNumberFieldId = 'lastExitCode' | 'columns' | 'rows';

export type FleetFieldId = FleetStringFieldId | FleetNumberFieldId;

export type FleetFieldType = 'string' | 'number';

// [LAW:one-source-of-truth] How a field's value is sourced from a session record. The evaluator switches
// on this exhaustively to extract the value, AND the snapshot builder reads it to learn which variables
// to keep — one catalog, both derive, so the two can never disagree about what a field means.
type FleetFieldSource =
  | { kind: 'variable'; name: string }
  | { kind: 'title' }
  | { kind: 'sessionId' }
  | { kind: 'exitCode' }
  | { kind: 'columns' }
  | { kind: 'rows' };

// [LAW:one-source-of-truth] The field's value TYPE is derived from its source, not stored alongside it —
// so a field whose union membership (string vs number) disagrees with how its value is produced is not a
// drift waiting to happen, it is structurally impossible. (A unit test pins each id's union to this.)
function fieldTypeOfSource(source: FleetFieldSource): FleetFieldType {
  switch (source.kind) {
    case 'variable':
    case 'title':
    case 'sessionId':
      return 'string';
    case 'exitCode':
    case 'columns':
    case 'rows':
      return 'number';
  }
}

// [LAW:types-are-the-program] `Record<FleetFieldId, …>` makes the catalog exhaustive by construction:
// every field id REQUIRES a spec and no extra id is accepted. A session-scope `get:['*']` dump names its
// variables BARE (`path` is the pwd, `jobName` the foreground job) — the dotted form is only how iTerm2
// surfaces cross-scope frames (`parentSession.path`, `user.foo`), which a session dump never contains.
const FIELD_SPECS: Record<FleetFieldId, { label: string; source: FleetFieldSource }> = {
  pwd: { label: 'Working dir', source: { kind: 'variable', name: 'path' } },
  jobName: { label: 'Job name', source: { kind: 'variable', name: 'jobName' } },
  username: { label: 'Username', source: { kind: 'variable', name: 'username' } },
  hostname: { label: 'Hostname', source: { kind: 'variable', name: 'hostname' } },
  tty: { label: 'TTY', source: { kind: 'variable', name: 'tty' } },
  title: { label: 'Title', source: { kind: 'title' } },
  sessionId: { label: 'Session ID', source: { kind: 'sessionId' } },
  lastExitCode: { label: 'Last exit code', source: { kind: 'exitCode' } },
  columns: { label: 'Columns', source: { kind: 'columns' } },
  rows: { label: 'Rows', source: { kind: 'rows' } },
};

export interface FleetFieldOption {
  id: FleetFieldId;
  label: string;
  type: FleetFieldType;
}

// [LAW:one-source-of-truth] The UI's field list is a projection of the catalog, never a second hand-kept
// list. Each option's type is derived from its source, so the dropdown and the evaluator agree by
// construction.
export const FLEET_FIELDS: readonly FleetFieldOption[] = (
  Object.keys(FIELD_SPECS) as FleetFieldId[]
).map((id) => ({ id, label: FIELD_SPECS[id].label, type: fieldTypeOfSource(FIELD_SPECS[id].source) }));

// [LAW:one-source-of-truth] The variable names the fleet snapshot must source, derived from the catalog
// so adding a variable-backed field extends the fetch automatically — the boundary never hard-codes a
// parallel list of "interesting" variables.
export const FLEET_VARIABLE_NAMES: readonly string[] = Array.from(
  new Set(
    Object.values(FIELD_SPECS)
      .map((spec) => spec.source)
      .filter((source): source is { kind: 'variable'; name: string } => source.kind === 'variable')
      .map((source) => source.name),
  ),
);

// ───────────────────────────────────────────────────────────────────────────
// Operators — partitioned by the value type they compare.

export type FleetStringOp = 'eq' | 'neq' | 'contains' | 'startsWith' | 'endsWith';
export type FleetNumberOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface FleetOpOption<Op> {
  id: Op;
  label: string;
}

export const FLEET_STRING_OPS: readonly FleetOpOption<FleetStringOp>[] = [
  { id: 'eq', label: 'is' },
  { id: 'neq', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'startsWith', label: 'starts with' },
  { id: 'endsWith', label: 'ends with' },
];

export const FLEET_NUMBER_OPS: readonly FleetOpOption<FleetNumberOp>[] = [
  { id: 'eq', label: '=' },
  { id: 'neq', label: '≠' },
  { id: 'gt', label: '>' },
  { id: 'gte', label: '≥' },
  { id: 'lt', label: '<' },
  { id: 'lte', label: '≤' },
];

// [LAW:one-source-of-truth] A field's value type, read from the catalog. Total over FleetFieldId (the
// catalog is exhaustive), so callers never guard a missing field.
export function fleetFieldType(field: FleetFieldId): FleetFieldType {
  return fieldTypeOfSource(FIELD_SPECS[field].source);
}

// The operators valid for a field, by its type — the renderer's op dropdown maps over exactly this, so it
// can never offer `>` on a string field. Widened to FleetOpOption<string> for UI consumption: the precise
// op-id union is re-established by compilePredicate, the single validating boundary.
export function opsForField(field: FleetFieldId): readonly FleetOpOption<string>[] {
  return fleetFieldType(field) === 'string' ? FLEET_STRING_OPS : FLEET_NUMBER_OPS;
}

const STRING_FIELD_IDS = new Set<string>(FLEET_FIELDS.filter((f) => f.type === 'string').map((f) => f.id));
const STRING_OP_IDS = new Set<string>(FLEET_STRING_OPS.map((o) => o.id));
const NUMBER_OP_IDS = new Set<string>(FLEET_NUMBER_OPS.map((o) => o.id));

// [LAW:single-enforcer] The ONE place an editable (field, op, raw-text) row becomes a typed predicate — or
// nothing. It validates the op against the field's type and parses a numeric value, then performs the only
// narrowing the type system cannot see across the catalog's id-partition (runtime set membership justifies
// the cast). An incomplete or invalid row compiles to null, so the renderer never holds a half-built
// predicate the evaluator would have to defend against. [LAW:no-defensive-null-guards]
export function compilePredicate(
  field: FleetFieldId,
  op: string,
  rawValue: string,
): FleetPredicate | null {
  if (STRING_FIELD_IDS.has(field)) {
    if (!STRING_OP_IDS.has(op) || rawValue.length === 0) return null;
    return { type: 'string', field: field as FleetStringFieldId, op: op as FleetStringOp, value: rawValue };
  }
  if (!NUMBER_OP_IDS.has(op) || rawValue.trim().length === 0) return null;
  const value = Number(rawValue);
  if (Number.isNaN(value)) return null;
  return { type: 'number', field: field as FleetNumberFieldId, op: op as FleetNumberOp, value };
}

// ───────────────────────────────────────────────────────────────────────────
// The query model.

// [LAW:types-are-the-program] A predicate's operator and value type are pinned to its field's type by the
// discriminant: a `string` predicate can only carry a string field + string op, a `number` predicate only
// a number field + number op + already-parsed numeric value. The "type-mismatch at construction" the
// ticket warns against is simply not representable; the only mismatch left is in the live DATA, handled
// in the evaluator.
export type FleetPredicate =
  | { type: 'string'; field: FleetStringFieldId; op: FleetStringOp; value: string }
  | { type: 'number'; field: FleetNumberFieldId; op: FleetNumberOp; value: number };

export type FleetConnective = 'and' | 'or';

// [LAW:no-mode-explosion] A capped grammar: a list of predicates joined by ONE connective. This is the
// minimal shape that satisfies the ticket's "field op value, AND/OR" requirement and is trivially
// buildable in the UI (a connective toggle + a list of rows). Mixed/nested boolean trees are a
// deliberate non-goal; if a future ticket needs them, the predicate list becomes a recursive node — one
// type change, not a flag.
export interface FleetQuery {
  connective: FleetConnective;
  predicates: FleetPredicate[];
}

// ───────────────────────────────────────────────────────────────────────────
// The snapshot — the in-memory fleet dataset the evaluator runs against.

// One successfully-read session: its focus ref, its layout facts (title/grid), the catalog's
// variable-backed values decoded to raw strings, and its last OSC-133 prompt (null when the session
// emits no marks). The lastPrompt is the canonical AppPrompt: only its 'finished' variant carries an
// exit code, so "last exit code" can never read a stale or absent code off a running command.
export interface FleetSessionRecord {
  ref: AppEntitySessionRef;
  title: string;
  columns: number | null;
  rows: number | null;
  variables: Record<string, string>;
  lastPrompt: AppPrompt | null;
}

// [LAW:no-silent-failure] A session the fetch could not read is NEVER silently dropped — it lands here
// with the reason, so a query over a partial fleet is labeled partial instead of quietly missing rows.
export interface FleetReadFailure {
  ref: AppEntitySessionRef;
  reason: string;
}

export interface FleetSnapshot {
  sessions: FleetSessionRecord[];
  failures: FleetReadFailure[];
  // Wall-clock of the capture; 0 is the "never captured" sentinel a fresh store carries.
  capturedAt: number;
}

export function emptyFleetSnapshot(capturedAt: number): FleetSnapshot {
  return { sessions: [], failures: [], capturedAt };
}

// `partial` is DERIVED, never stored — a second boolean that could disagree with `failures` would be a
// lie waiting to happen ([LAW:one-source-of-truth]).
export function isFleetSnapshotPartial(snapshot: FleetSnapshot): boolean {
  return snapshot.failures.length > 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Evaluation — pure.

type FleetValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'absent' };

const ABSENT: FleetValue = { kind: 'absent' };

function extractValue(record: FleetSessionRecord, field: FleetFieldId): FleetValue {
  const source = FIELD_SPECS[field].source;
  switch (source.kind) {
    case 'variable': {
      const raw = record.variables[source.name];
      return raw === undefined ? ABSENT : { kind: 'string', value: raw };
    }
    case 'title':
      return { kind: 'string', value: record.title };
    case 'sessionId':
      return { kind: 'string', value: record.ref.sessionId };
    case 'exitCode':
      // [LAW:types-are-the-program] Only a FINISHED prompt has an exit code; an editing/running/absent
      // prompt yields absent, so "exit != 0" never matches a command that has not finished.
      return record.lastPrompt?.state === 'finished'
        ? { kind: 'number', value: record.lastPrompt.exitStatus }
        : ABSENT;
    case 'columns':
      return record.columns === null ? ABSENT : { kind: 'number', value: record.columns };
    case 'rows':
      return record.rows === null ? ABSENT : { kind: 'number', value: record.rows };
  }
}

// String comparison is case-INSENSITIVE — a deliberate, documented choice: a human querying terminal
// paths and job names wants `pwd contains code` to ignore case. There is no case-sensitivity flag
// ([LAW:no-mode-explosion]); one behavior, applied uniformly.
function applyStringOp(op: FleetStringOp, actual: string, query: string): boolean {
  const a = actual.toLowerCase();
  const q = query.toLowerCase();
  switch (op) {
    case 'eq':
      return a === q;
    case 'neq':
      return a !== q;
    case 'contains':
      return a.includes(q);
    case 'startsWith':
      return a.startsWith(q);
    case 'endsWith':
      return a.endsWith(q);
  }
}

function applyNumberOp(op: FleetNumberOp, actual: number, query: number): boolean {
  switch (op) {
    case 'eq':
      return actual === query;
    case 'neq':
      return actual !== query;
    case 'gt':
      return actual > query;
    case 'gte':
      return actual >= query;
    case 'lt':
      return actual < query;
    case 'lte':
      return actual <= query;
  }
}

// [LAW:no-silent-failure] A predicate whose live value is absent or the wrong kind matches NOTHING —
// absence is never coerced to '' or 0 (which would make `neq` spuriously true and silently match a
// session we have no data for). This is the data-level "type-mismatch" case; the construction-level one
// is already unrepresentable.
function matchesPredicate(record: FleetSessionRecord, predicate: FleetPredicate): boolean {
  const value = extractValue(record, predicate.field);
  switch (predicate.type) {
    case 'string':
      return value.kind === 'string' && applyStringOp(predicate.op, value.value, predicate.value);
    case 'number':
      return value.kind === 'number' && applyNumberOp(predicate.op, value.value, predicate.value);
  }
}

function matchesQuery(record: FleetSessionRecord, query: FleetQuery): boolean {
  // An empty query is the identity filter — every session matches, regardless of connective. (Without
  // this, `or` over zero predicates would vacuously match none, an asymmetry no user intends.)
  if (query.predicates.length === 0) return true;
  const verdicts = query.predicates.map((predicate) => matchesPredicate(record, predicate));
  return query.connective === 'and' ? verdicts.every(Boolean) : verdicts.some(Boolean);
}

// [LAW:effects-at-boundaries] The whole point: a pure function from (snapshot, query) to the matching
// session refs. Results ARE AppEntitySessionRefs so the UI clicks them straight into the one focus
// authority — never a parallel selection model.
export function evaluateFleetQuery(
  snapshot: FleetSnapshot,
  query: FleetQuery,
): AppEntitySessionRef[] {
  return snapshot.sessions.filter((record) => matchesQuery(record, query)).map((record) => record.ref);
}

// ───────────────────────────────────────────────────────────────────────────
// Boundary helpers — pure, but consumed by the IO layer that builds the snapshot.

export interface FleetTarget {
  ref: AppEntitySessionRef;
  title: string;
  columns: number | null;
  rows: number | null;
}

// [LAW:decomposition] A pure walk of the layout into the per-session targets the fetch will read. The
// orchestrator performs the IO (variable dump + prompt) per target; this only enumerates them, so the
// "which sessions exist" decision stays one testable function over the layout graph.
export function collectFleetTargets(windows: readonly AppWindow[]): FleetTarget[] {
  const targets: FleetTarget[] = [];
  for (const window of windows) {
    for (const tab of window.tabs) {
      for (const session of flatSessions(tab)) {
        targets.push({
          ref: {
            kind: 'session',
            windowId: window.windowId,
            tabId: tab.tabId,
            sessionId: session.sessionId,
          },
          title: session.title,
          columns: session.gridSize?.width ?? null,
          rows: session.gridSize?.height ?? null,
        });
      }
    }
  }
  return targets;
}

// [LAW:one-source-of-truth] Build a record by keeping only the catalog's variable-backed names from a raw
// dump, coercing each to a raw string. The orchestrator hands over the untyped `get:['*']` dict and never
// decides which variables matter — that knowledge lives only in the catalog.
export function buildFleetSessionRecord(
  target: FleetTarget,
  dump: Record<string, unknown>,
  lastPrompt: AppPrompt | null,
): FleetSessionRecord {
  const variables: Record<string, string> = {};
  for (const name of FLEET_VARIABLE_NAMES) {
    const raw = dump[name];
    // A genuinely-absent variable stays absent (omitted from the map), so the evaluator can tell "no
    // such variable" from "the empty string" — never coerced to '' here.
    if (raw !== undefined && raw !== null) variables[name] = String(raw);
  }
  return {
    ref: target.ref,
    title: target.title,
    columns: target.columns,
    rows: target.rows,
    variables,
    lastPrompt,
  };
}
