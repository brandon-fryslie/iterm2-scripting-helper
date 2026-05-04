import { makeAutoObservable, observable } from 'mobx';
import type { AppPromptEntry, AppPromptEventKind } from '@shared/domain';

export type { AppPromptEventKind as PromptEventKind };
export type { AppPromptEntry as PromptEntry };

export interface PromptLogSnapshot {
  entries: AppPromptEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 2000;

export class PromptLogStore {
  private readonly capacity: number;
  private ring: (AppPromptEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<AppPromptEntry | undefined>(capacity);
    makeAutoObservable<PromptLogStore, 'ring'>(this, {
      ring: observable.shallow,
    });
  }

  record(entry: Omit<AppPromptEntry, 'seq' | 'at'> | null): AppPromptEntry | null {
    if (!entry) return null;
    const full: AppPromptEntry = {
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
    this.ring = new Array<AppPromptEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): PromptLogSnapshot {
    const entries: AppPromptEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) entries.push(e);
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}
