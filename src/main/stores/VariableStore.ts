import { makeAutoObservable, observable } from 'mobx';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppVariableChange,
  type AppVariableChangeSource,
  type AppVariableEntry,
  type AppVariableScope,
} from '@shared/domain';
import type { AppEventLog } from './AppEventLog';

export type { AppVariableScope as VariableScope };
export type { AppVariableEntry as VariableEntry };

export interface VariableSnapshot {
  entity: AppEntityRef;
  variables: AppVariableEntry[];
}

// [LAW:carrying-cost] Bound the per-variable history so a hot-changing variable cannot grow memory
// without limit; "recent changes for debugging" needs depth, not the full lifetime.
export const VARIABLE_HISTORY_LIMIT = 20;

type NonEmptyHistory = readonly [AppVariableChange, ...AppVariableChange[]];

interface VariableRecord {
  scope: AppVariableScope;
  history: NonEmptyHistory;
}

export class VariableStore {
  focusedSessionId: string | null = null;
  focusedEntity: AppEntityRef = APP_ENTITY;
  private readonly byFocus = new Map<string, Map<string, VariableRecord>>();
  private liveNames = new Set<string>();

  // [LAW:single-enforcer] This store owns the invariant "what counts as a variable change" — its
  // dedup of identical re-observations. The unified spine's variable-change events must therefore be
  // minted HERE, from the same input that updates the fold, so the log can never disagree with the
  // history about whether a change happened. The store's per-variable history is a bounded display
  // fold of exactly those events; the log is the authoritative, provenance-carrying timeline.
  private readonly appEvents: AppEventLog;

  constructor(appEvents: AppEventLog) {
    this.appEvents = appEvents;
    makeAutoObservable<VariableStore, 'byFocus' | 'appEvents'>(this, {
      byFocus: observable.shallow,
      appEvents: false,
      focusedEntity: observable.ref,
    });
  }

  setFocused(sessionId: string | null): void {
    this.focusedSessionId = sessionId;
  }

  setFocusedEntity(entity: AppEntityRef): void {
    this.focusedEntity = entity;
  }

  setLiveNames(names: readonly string[]): void {
    // [LAW:one-source-of-truth] Replace the set whole so MobX tracks the change and the derived
    // `live` projection re-broadcasts; never mutate it field-by-field.
    this.liveNames = new Set(names);
  }

  applyDump(entity: AppEntityRef, dict: Record<string, unknown>, frameSeq: number): void {
    const now = Date.now();
    const focusKey = variableFocusKey(entity);
    const previous = this.byFocus.get(focusKey);
    const map = new Map<string, VariableRecord>();
    for (const [name, value] of Object.entries(dict)) {
      const nextValue = JSON.stringify(value);
      const priorHistory = previous?.get(name)?.history ?? [];
      const scope = variableScopeFromName(name, entity.kind);
      const { history, changed } = recordChange(priorHistory, nextValue, now);
      if (changed) {
        this.appendChange(entity, name, nextValue, priorHistory[0]?.value ?? null, scope, 'dump', frameSeq);
      }
      map.set(name, { scope, history });
    }
    this.byFocus.set(focusKey, map);
  }

  applyChange(
    sessionId: string,
    name: string,
    jsonValue: string,
    scope: AppVariableScope,
    frameSeq: number,
  ): void {
    // [LAW:one-source-of-truth] Storage key and spine entity are the same fact — where this variable
    // lives — so both derive from the one entity `entityForScope` resolves. Computing the focus key
    // independently from the raw scope let `unknown` (coalesced to the app entity) be stored under
    // `unknown:<id>`, a key no `variableFocusKey` ever reads, silently dropping the variable.
    const entity = entityForScope(scope, sessionId);
    const focusKey = variableFocusKey(entity);
    // [LAW:no-ambient-temporal-coupling] Replace the inner map by reference so the shallow-observable
    // outer map fires its reaction; in-place mutation would silently skip the renderer broadcast.
    const map = new Map(this.byFocus.get(focusKey) ?? []);
    const priorHistory = map.get(name)?.history ?? [];
    const recordScope = variableScopeFromName(name, scope);
    const { history, changed } = recordChange(priorHistory, jsonValue, Date.now());
    if (changed) {
      this.appendChange(
        entity,
        name,
        jsonValue,
        priorHistory[0]?.value ?? null,
        recordScope,
        'subscription',
        frameSeq,
      );
    }
    map.set(name, { scope: recordScope, history });
    this.byFocus.set(focusKey, map);
  }

  // [LAW:single-enforcer] This only appends; the "is it a change?" decision is recordChange's alone
  // (its `changed` flag gates this call), so the history entry and the spine event are produced from
  // exactly one verdict and cannot disagree about what counts as a change.
  private appendChange(
    entity: AppEntityRef,
    name: string,
    value: string,
    previousValue: string | null,
    scope: AppVariableScope,
    source: AppVariableChangeSource,
    frameSeq: number,
  ): void {
    this.appEvents.append({
      kind: 'variable-change',
      at: Date.now(),
      frameSeq,
      entity,
      causedBy: null,
      payload: { name, value, previousValue, scope, source },
    });
  }

  clearSession(sessionId: string): void {
    this.byFocus.delete(variableScopeFocusKey('session', sessionId));
  }

  clearAll(): void {
    this.byFocus.clear();
    this.focusedSessionId = null;
    this.focusedEntity = APP_ENTITY;
  }

  snapshot(): VariableSnapshot {
    const map = this.byFocus.get(variableFocusKey(this.focusedEntity));
    if (!map) return { entity: this.focusedEntity, variables: [] };
    const variables = Array.from(map.entries())
      .map(([name, record]) => this.projectEntry(name, record))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { entity: this.focusedEntity, variables };
  }

  private projectEntry(name: string, record: VariableRecord): AppVariableEntry {
    const [current, ...rest] = record.history;
    return {
      name,
      value: current.value,
      previousValue: rest[0]?.value ?? null,
      live: this.liveNames.has(name),
      updatedAt: current.at,
      scope: record.scope,
      history: record.history.map((change) => ({ ...change })),
    };
  }
}

// [LAW:single-enforcer] The one place that both decides whether an observation is a change and
// constructs the resulting history. Its `changed` verdict is the sole authority callers gate the
// spine event on, so the timeline and the per-variable history can never disagree about what counts
// as a change. Guarantees the history's non-empty, most-recent-first, bounded invariant; every
// reader may assume history[0] exists.
function recordChange(
  history: readonly AppVariableChange[],
  value: string,
  at: number,
): { history: NonEmptyHistory; changed: boolean } {
  const head = history[0];
  if (head && head.value === value) {
    return { history: [head, ...history.slice(1)], changed: false };
  }
  return {
    history: [{ value, at }, ...history.slice(0, VARIABLE_HISTORY_LIMIT - 1)],
    changed: true,
  };
}

export function variableFocusKey(entity: AppEntityRef): string {
  // [LAW:one-source-of-truth] Snapshot storage uses the protocol identifier for each variable scope.
  switch (entity.kind) {
    case 'app':
      return variableScopeFocusKey('app', '');
    case 'window':
      return variableScopeFocusKey('window', entity.windowId);
    case 'tab':
      return variableScopeFocusKey('tab', entity.tabId);
    case 'session':
      return variableScopeFocusKey('session', entity.sessionId);
  }
}

function variableScopeFocusKey(scope: AppVariableScope, identifier: string): string {
  return `${scope}:${identifier}`;
}

// [LAW:types-are-the-program] Map a change's scope + protocol identifier to the entity it belongs to.
// 'user' variables are app-global, so they share the app entity.
function entityForScope(scope: AppVariableScope, identifier: string): AppEntityRef {
  switch (scope) {
    case 'session':
      return { kind: 'session', windowId: '', tabId: '', sessionId: identifier };
    case 'window':
      return { kind: 'window', windowId: identifier };
    case 'tab':
      return { kind: 'tab', windowId: '', tabId: identifier };
    // [LAW:no-silent-failure] 'user' is app-global; an unrecognized (drifted) protocol scope has no
    // entity we can attribute it to, so it also surfaces under the app entity to stay visible.
    case 'app':
    case 'user':
    case 'unknown':
      return APP_ENTITY;
  }
}

function variableScopeFromName(
  name: string,
  fallback: AppVariableScope,
): AppVariableScope {
  const [prefix] = name.split('.', 1);
  switch (prefix) {
    case 'app':
    case 'window':
    case 'tab':
    case 'session':
    case 'user':
      return prefix;
    default:
      return fallback;
  }
}
