import { makeAutoObservable, observable } from 'mobx';
import type { AppFocusEntry, AppFocusEventKind } from '@shared/domain';

export type { AppFocusEventKind as FocusEventKind };
export type { AppFocusEntry as FocusEntry };

export interface FocusLogSnapshot {
  entries: AppFocusEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 500;

export class FocusLogStore {
  private readonly capacity: number;
  private ring: (AppFocusEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<AppFocusEntry | undefined>(capacity);
    makeAutoObservable<FocusLogStore, 'ring'>(this, {
      ring: observable.shallow,
    });
  }

  record(entry: Omit<AppFocusEntry, 'seq' | 'at'>): AppFocusEntry {
    const full: AppFocusEntry = {
      ...entry,
      seq: this.nextSeq++,
      at: Date.now(),
    };
    this.ring[this.head] = full;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return full;
  }

  clear(): void {
    this.ring = new Array<AppFocusEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): FocusLogSnapshot {
    const entries: AppFocusEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) entries.push(e);
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}
