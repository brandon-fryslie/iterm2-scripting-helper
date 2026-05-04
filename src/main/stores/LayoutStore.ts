import { makeAutoObservable } from 'mobx';
import type {
  ListSessionsResponse,
  SplitTreeNode,
} from '@shared/proto/gen/api_pb';

export interface LayoutSession {
  sessionId: string;
  title: string;
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
          sessions: t.sessions.map((s) => ({ sessionId: s.sessionId, title: s.title })),
        })),
      })),
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

}

function collectSessions(node: SplitTreeNode | undefined): LayoutSession[] {
  if (!node) return [];
  const out: LayoutSession[] = [];
  for (const link of node.links) {
    if (link.child.case === 'session') {
      out.push({ sessionId: link.child.value.uniqueIdentifier, title: link.child.value.title });
    } else if (link.child.case === 'node') {
      out.push(...collectSessions(link.child.value));
    }
  }
  return out;
}
