import { makeAutoObservable } from 'mobx';
import type { FocusChangedNotification } from '@shared/proto/gen/api_pb';

export type FocusEventKind =
  | 'app-active'
  | 'app-inactive'
  | 'window'
  | 'selected-tab'
  | 'session'
  | 'unknown';

export interface FocusEntry {
  seq: number;
  at: number;
  kind: FocusEventKind;
  summary: string;
  sessionId: string | null;
  windowId: string | null;
}

export interface FocusLogSnapshot {
  entries: FocusEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 500;

export class FocusLogStore {
  private readonly capacity: number;
  private ring: (FocusEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<FocusEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  record(n: FocusChangedNotification): FocusEntry {
    const { kind, summary, sessionId, windowId } = classify(n);
    const entry: FocusEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      kind,
      summary,
      sessionId,
      windowId,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<FocusEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): FocusLogSnapshot {
    const entries: FocusEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          kind: e.kind,
          summary: e.summary,
          sessionId: e.sessionId,
          windowId: e.windowId,
        });
      }
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}

function classify(n: FocusChangedNotification): {
  kind: FocusEventKind;
  summary: string;
  sessionId: string | null;
  windowId: string | null;
} {
  switch (n.event.case) {
    case 'applicationActive':
      return {
        kind: n.event.value ? 'app-active' : 'app-inactive',
        summary: n.event.value ? 'application became active' : 'application resigned active',
        sessionId: null,
        windowId: null,
      };
    case 'window':
      return {
        kind: 'window',
        summary: `window ${n.event.value.windowStatus}: ${n.event.value.windowId}`,
        sessionId: null,
        windowId: n.event.value.windowId,
      };
    case 'selectedTab':
      return {
        kind: 'selected-tab',
        summary: `selected tab ${n.event.value}`,
        sessionId: null,
        windowId: null,
      };
    case 'session':
      return {
        kind: 'session',
        summary: `active session ${n.event.value}`,
        sessionId: n.event.value,
        windowId: null,
      };
    default:
      return { kind: 'unknown', summary: '', sessionId: null, windowId: null };
  }
}
