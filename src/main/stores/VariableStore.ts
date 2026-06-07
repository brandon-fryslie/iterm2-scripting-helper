import { makeAutoObservable, observable } from 'mobx';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppVariableEntry,
  type AppVariableScope,
} from '@shared/domain';

export type { AppVariableScope as VariableScope };
export type { AppVariableEntry as VariableEntry };

export interface VariableSnapshot {
  entity: AppEntityRef;
  variables: AppVariableEntry[];
}

export class VariableStore {
  focusedSessionId: string | null = null;
  focusedEntity: AppEntityRef = APP_ENTITY;
  private readonly byFocus = new Map<string, Map<string, AppVariableEntry>>();
  private readonly liveNames = new Set<string>();

  constructor() {
    makeAutoObservable<VariableStore, 'byFocus'>(this, {
      byFocus: observable.shallow,
    });
  }

  setFocused(sessionId: string | null): void {
    this.focusedSessionId = sessionId;
  }

  setFocusedEntity(entity: AppEntityRef): void {
    this.focusedEntity = entity;
  }

  setLiveNames(names: readonly string[]): void {
    this.liveNames.clear();
    for (const name of names) this.liveNames.add(name);
  }

  applyDump(entity: AppEntityRef, dict: Record<string, unknown>): void {
    const now = Date.now();
    const focusKey = variableFocusKey(entity);
    const previous = this.byFocus.get(focusKey);
    const map = new Map<string, AppVariableEntry>();
    for (const [name, value] of Object.entries(dict)) {
      const nextValue = JSON.stringify(value);
      const previousEntry = previous?.get(name);
      const valueChanged = previousEntry?.value !== nextValue;
      map.set(name, {
        name,
        value: nextValue,
        previousValue: previousEntry?.value ?? null,
        live: this.liveNames.has(name),
        updatedAt: valueChanged ? now : previousEntry.updatedAt,
        scope: variableScopeFromName(name, entity.kind),
      });
    }
    this.byFocus.set(focusKey, map);
  }

  applyChange(sessionId: string, name: string, jsonValue: string, scope: AppVariableScope = 'session'): void {
    const focusKey = variableScopeFocusKey(scope, sessionId);
    let map = this.byFocus.get(focusKey);
    if (!map) {
      map = new Map();
      this.byFocus.set(focusKey, map);
    }
    const previous = map.get(name);
    const valueChanged = previous?.value !== jsonValue;
    map.set(name, {
      name,
      value: jsonValue,
      previousValue: previous?.value ?? null,
      live: this.liveNames.has(name),
      updatedAt: valueChanged ? Date.now() : previous.updatedAt,
      scope: variableScopeFromName(name, scope),
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
    const variables = Array.from(map.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { entity: this.focusedEntity, variables };
  }
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
