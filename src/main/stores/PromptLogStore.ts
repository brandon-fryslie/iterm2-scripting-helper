import { makeAutoObservable } from 'mobx';
import type { PromptNotification } from '@shared/proto/gen/api_pb';

export type PromptEventKind = 'prompt' | 'command-start' | 'command-end';

export interface PromptEntry {
  seq: number;
  at: number;
  sessionId: string;
  uniquePromptId: string;
  kind: PromptEventKind;
  command: string | null;
  status: number | null;
}

export interface PromptLogSnapshot {
  entries: PromptEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 2000;

export class PromptLogStore {
  private readonly capacity: number;
  private ring: (PromptEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<PromptEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  record(n: PromptNotification): PromptEntry | null {
    const { kind, command, status } = classify(n);
    if (!kind) return null;
    const entry: PromptEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      sessionId: n.session,
      uniquePromptId: n.uniquePromptId,
      kind,
      command,
      status,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<PromptEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): PromptLogSnapshot {
    const entries: PromptEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          sessionId: e.sessionId,
          uniquePromptId: e.uniquePromptId,
          kind: e.kind,
          command: e.command,
          status: e.status,
        });
      }
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}

function classify(n: PromptNotification): {
  kind: PromptEventKind | null;
  command: string | null;
  status: number | null;
} {
  switch (n.event.case) {
    case 'prompt':
      return { kind: 'prompt', command: null, status: null };
    case 'commandStart':
      return {
        kind: 'command-start',
        command: n.event.value.command,
        status: null,
      };
    case 'commandEnd':
      return {
        kind: 'command-end',
        command: null,
        status: n.event.value.status,
      };
    default:
      return { kind: null, command: null, status: null };
  }
}
