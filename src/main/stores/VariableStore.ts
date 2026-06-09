import { makeAutoObservable, observable } from 'mobx';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppVariableChange,
  type AppVariableEntry,
  type AppVariableScope,
} from '@shared/domain';

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

  constructor() {
    makeAutoObservable<VariableStore, 'byFocus'>(this, {
      byFocus: observable.shallow,
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

  applyDump(entity: AppEntityRef, dict: Record<string, unknown>): void {
    const now = Date.now();
    const focusKey = variableFocusKey(entity);
    const previous = this.byFocus.get(focusKey);
    const map = new Map<string, VariableRecord>();
    for (const [name, value] of Object.entries(dict)) {
      const nextValue = JSON.stringify(value);
      const priorHistory = previous?.get(name)?.history ?? [];
      map.set(name, {
        scope: variableScopeFromName(name, entity.kind),
        history: recordChange(priorHistory, nextValue, now),
      });
    }
    this.byFocus.set(focusKey, map);
  }

  applyChange(
    sessionId: string,
    name: string,
    jsonValue: string,
    scope: AppVariableScope = 'session',
  ): void {
    const focusKey = variableScopeFocusKey(scope, sessionId);
    // [LAW:no-ambient-temporal-coupling] Replace the inner map by reference so the shallow-observable
    // outer map fires its reaction; in-place mutation would silently skip the renderer broadcast.
    const map = new Map(this.byFocus.get(focusKey) ?? []);
    const priorHistory = map.get(name)?.history ?? [];
    map.set(name, {
      scope: variableScopeFromName(name, scope),
      history: recordChange(priorHistory, jsonValue, Date.now()),
    });
    this.byFocus.set(focusKey, map);
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

// [LAW:single-enforcer] The one place that constructs a history guarantees its non-empty,
// most-recent-first, bounded invariant; every reader may assume history[0] exists.
function recordChange(
  history: readonly AppVariableChange[],
  value: string,
  at: number,
): NonEmptyHistory {
  const head = history[0];
  if (head && head.value === value) return [head, ...history.slice(1)];
  return [{ value, at }, ...history.slice(0, VARIABLE_HISTORY_LIMIT - 1)];
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
