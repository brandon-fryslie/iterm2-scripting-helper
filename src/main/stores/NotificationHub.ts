import { makeAutoObservable, observable } from 'mobx';
import type { AppNotificationEntry, AppNotificationKind } from '@shared/domain';

export type { AppNotificationKind as NotificationKind };
export type { AppNotificationEntry as NotificationEntry };

export interface NotificationSnapshot {
  entries: AppNotificationEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 2000;

export class NotificationHub {
  private readonly capacity: number;
  @observable.shallow private ring: (AppNotificationEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<AppNotificationEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  record(classified: { kind: AppNotificationKind; sessionId: string | null; summary: string; payload: Record<string, unknown> }): AppNotificationEntry {
    const entry: AppNotificationEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      kind: classified.kind,
      sessionId: classified.sessionId,
      summary: classified.summary,
      payload: classified.payload,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<AppNotificationEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): NotificationSnapshot {
    const entries: AppNotificationEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) entries.push(e);
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}
