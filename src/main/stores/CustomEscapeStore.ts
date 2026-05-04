import { makeAutoObservable, observable } from 'mobx';
import type { CustomEscapeSequenceNotification } from '@shared/proto/gen/api_pb';

export interface CustomEscapeSubscription {
  id: string;
  sessionId: string;
  identity: string;
  createdAt: number;
}

export interface CustomEscapeEntry {
  seq: number;
  at: number;
  subscriptionId: string;
  sessionId: string;
  identity: string;
  payload: string;
}

export interface CustomEscapeSnapshot {
  subscriptions: CustomEscapeSubscription[];
  entries: CustomEscapeEntry[];
  totalSeen: number;
  capacity: number;
}

const CAPACITY = 500;

export class CustomEscapeStore {
  @observable.shallow private readonly subscriptions = new Map<string, CustomEscapeSubscription>();
  @observable.shallow private readonly ring: (CustomEscapeEntry | undefined)[] = new Array(CAPACITY);
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor() {
    makeAutoObservable(this);
  }

  addSubscription(sub: CustomEscapeSubscription): void {
    this.subscriptions.set(sub.id, sub);
  }

  removeSubscription(id: string): void {
    this.subscriptions.delete(id);
  }

  record(n: CustomEscapeSequenceNotification): CustomEscapeEntry | null {
    const sessionId = n.session ?? '';
    const identity = n.senderIdentity ?? '';
    const payload = n.payload ?? '';
    // Find subscription by (session, identity)
    let matching: CustomEscapeSubscription | null = null;
    for (const sub of this.subscriptions.values()) {
      if (sub.sessionId === sessionId && (!sub.identity || sub.identity === identity)) {
        matching = sub;
        break;
      }
    }
    if (!matching) return null;
    const entry: CustomEscapeEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      subscriptionId: matching.id,
      sessionId,
      identity,
      payload,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % CAPACITY;
    if (this.length < CAPACITY) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clearAll(): void {
    this.subscriptions.clear();
    this.ring.fill(undefined);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): CustomEscapeSnapshot {
    const subs = Array.from(this.subscriptions.values());
    const entries: CustomEscapeEntry[] = [];
    const start = (this.head - this.length + CAPACITY) % CAPACITY;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % CAPACITY];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          subscriptionId: e.subscriptionId,
          sessionId: e.sessionId,
          identity: e.identity,
          payload: e.payload,
        });
      }
    }
    return { subscriptions: subs, entries, totalSeen: this.totalSeen, capacity: CAPACITY };
  }
}
