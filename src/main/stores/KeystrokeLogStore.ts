import { makeAutoObservable, observable } from 'mobx';
import type { AppKeystrokeEntry, AppKeystrokeModifier, AppKeystrokeAction } from '@shared/domain';

export type { AppKeystrokeAction as KeystrokeAction, AppKeystrokeModifier as KeystrokeModifier };
export type { AppKeystrokeEntry as KeystrokeEntry };

export interface KeystrokeLogSnapshot {
  entries: AppKeystrokeEntry[];
  totalSeen: number;
  capacity: number;
  advanced: boolean;
}

const DEFAULT_CAPACITY = 2000;

export class KeystrokeLogStore {
  private readonly capacity: number;
  private ring: (AppKeystrokeEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;
  advanced = false;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<AppKeystrokeEntry | undefined>(capacity);
    makeAutoObservable<KeystrokeLogStore, 'ring'>(this, {
      ring: observable.shallow,
    });
  }

  setAdvanced(advanced: boolean): void {
    this.advanced = advanced;
  }

  record(entry: Omit<AppKeystrokeEntry, 'seq' | 'at'>): AppKeystrokeEntry {
    const full: AppKeystrokeEntry = { ...entry, seq: this.nextSeq++, at: Date.now() };
    this.ring[this.head] = full;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return full;
  }

  clear(): void {
    this.ring = new Array<AppKeystrokeEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): KeystrokeLogSnapshot {
    const entries: AppKeystrokeEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) entries.push(e);
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity, advanced: this.advanced };
  }
}
