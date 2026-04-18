import { makeAutoObservable } from 'mobx';
import { fromBinary } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
} from '@shared/proto/gen/api_pb';

export interface WireLogEntry {
  seq: number;
  at: number;
  direction: 'out' | 'in';
  size: number;
  kind: string;
  id: string;
}

export interface WireLogSnapshot {
  entries: WireLogEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 2000;

export class WireLogStore {
  private readonly capacity: number;
  private ring: (WireLogEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<WireLogEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  recordFrame(direction: 'out' | 'in', bytes: Uint8Array, at: number): WireLogEntry {
    const decoded = this.decode(direction, bytes);
    const entry: WireLogEntry = {
      seq: this.nextSeq++,
      at,
      direction,
      size: bytes.byteLength,
      kind: decoded.kind,
      id: decoded.id,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<WireLogEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): WireLogSnapshot {
    const entries: WireLogEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          direction: e.direction,
          size: e.size,
          kind: e.kind,
          id: e.id,
        });
      }
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }

  private decode(direction: 'out' | 'in', bytes: Uint8Array): { kind: string; id: string } {
    try {
      if (direction === 'out') {
        const msg = fromBinary(ClientOriginatedMessageSchema, bytes);
        return { kind: msg.submessage.case ?? '(empty)', id: msg.id.toString() };
      }
      const msg = fromBinary(ServerOriginatedMessageSchema, bytes);
      return { kind: msg.submessage.case ?? '(empty)', id: msg.id.toString() };
    } catch {
      return { kind: '(decode-failed)', id: '0' };
    }
  }
}
