import { makeAutoObservable, observable } from 'mobx';
import type { AppVariableEntry, AppVariableScope } from '@shared/domain';

export type { AppVariableScope as VariableScope };
export type { AppVariableEntry as VariableEntry };

export interface VariableSnapshot {
  sessionId: string | null;
  variables: AppVariableEntry[];
}

export class VariableStore {
  focusedSessionId: string | null = null;
  private readonly bySession = new Map<string, Map<string, AppVariableEntry>>();
  private readonly liveNames = new Set<string>();

  constructor() {
    makeAutoObservable<VariableStore, 'bySession'>(this, {
      bySession: observable.shallow,
    });
  }

  setFocused(sessionId: string | null): void {
    this.focusedSessionId = sessionId;
  }

  setLiveNames(names: readonly string[]): void {
    this.liveNames.clear();
    for (const name of names) this.liveNames.add(name);
  }

  applyDump(sessionId: string, dict: Record<string, unknown>): void {
    const now = Date.now();
    const map = new Map<string, AppVariableEntry>();
    for (const [name, value] of Object.entries(dict)) {
      map.set(name, {
        name,
        value: JSON.stringify(value),
        live: this.liveNames.has(name),
        updatedAt: now,
        scope: 'session',
      });
    }
    this.bySession.set(sessionId, map);
  }

  applyChange(sessionId: string, name: string, jsonValue: string, scope: AppVariableScope = 'session'): void {
    let map = this.bySession.get(sessionId);
    if (!map) {
      map = new Map();
      this.bySession.set(sessionId, map);
    }
    map.set(name, {
      name,
      value: jsonValue,
      live: this.liveNames.has(name),
      updatedAt: Date.now(),
      scope,
    });
  }

  clearSession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  clearAll(): void {
    this.bySession.clear();
    this.focusedSessionId = null;
  }

  snapshot(): VariableSnapshot {
    const id = this.focusedSessionId;
    if (!id) return { sessionId: null, variables: [] };
    const map = this.bySession.get(id);
    if (!map) return { sessionId: id, variables: [] };
    const variables = Array.from(map.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { sessionId: id, variables };
  }
}
