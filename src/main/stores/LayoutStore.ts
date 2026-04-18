import { makeAutoObservable } from 'mobx';
import type { ListSessionsResponse } from '@shared/proto/gen/api_pb';

export interface LayoutSession {
  sessionId: string;
}

export interface LayoutTab {
  tabId: string;
  sessions: LayoutSession[];
}

export interface LayoutWindow {
  windowId: string;
  tabs: LayoutTab[];
}

export interface LayoutSnapshot {
  windows: LayoutWindow[];
  lastUpdatedAt: number;
}

export class LayoutStore {
  windows: LayoutWindow[] = [];
  lastUpdatedAt = 0;

  constructor() {
    makeAutoObservable(this);
  }

  apply(response: ListSessionsResponse): void {
    this.windows = response.windows.map((w) => ({
      windowId: w.windowId,
      tabs: w.tabs.map((t) => ({
        tabId: t.tabId,
        sessions: collectSessions(t.root),
      })),
    }));
    this.lastUpdatedAt = Date.now();
  }

  clear(): void {
    this.windows = [];
    this.lastUpdatedAt = 0;
  }

  snapshot(): LayoutSnapshot {
    return {
      windows: this.windows.map((w) => ({
        windowId: w.windowId,
        tabs: w.tabs.map((t) => ({
          tabId: t.tabId,
          sessions: t.sessions.map((s) => ({ sessionId: s.sessionId })),
        })),
      })),
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }
}

function collectSessions(node: unknown): LayoutSession[] {
  const out: LayoutSession[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    if (typeof obj.uniqueIdentifier === 'string') {
      out.push({ sessionId: obj.uniqueIdentifier });
    }
    if (Array.isArray(obj.links)) {
      for (const link of obj.links) {
        walk((link as { node?: unknown }).node);
      }
    }
  };
  walk(node);
  return out;
}
