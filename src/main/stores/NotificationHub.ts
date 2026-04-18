import { makeAutoObservable } from 'mobx';
import type { Notification } from '@shared/proto/gen/api_pb';

export type NotificationKind =
  | 'keystroke'
  | 'screen-update'
  | 'prompt'
  | 'custom-escape'
  | 'new-session'
  | 'terminate-session'
  | 'layout-changed'
  | 'focus-changed'
  | 'variable-changed'
  | 'server-rpc'
  | 'broadcast-changed'
  | 'profile-changed'
  | 'location-changed'
  | 'unknown';

export interface NotificationEntry {
  seq: number;
  at: number;
  kind: NotificationKind;
  sessionId: string | null;
  summary: string;
}

export interface NotificationSnapshot {
  entries: NotificationEntry[];
  totalSeen: number;
  capacity: number;
}

const DEFAULT_CAPACITY = 2000;

export class NotificationHub {
  private readonly capacity: number;
  private ring: (NotificationEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<NotificationEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  record(n: Notification): NotificationEntry {
    const { kind, sessionId, summary } = classify(n);
    const entry: NotificationEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      kind,
      sessionId,
      summary,
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<NotificationEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): NotificationSnapshot {
    const entries: NotificationEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          kind: e.kind,
          sessionId: e.sessionId,
          summary: e.summary,
        });
      }
    }
    return { entries, totalSeen: this.totalSeen, capacity: this.capacity };
  }
}

function classify(n: Notification): {
  kind: NotificationKind;
  sessionId: string | null;
  summary: string;
} {
  if (n.keystrokeNotification) {
    const k = n.keystrokeNotification;
    return {
      kind: 'keystroke',
      sessionId: k.session ?? null,
      summary: `${k.characters ?? ''}`,
    };
  }
  if (n.screenUpdateNotification) {
    return {
      kind: 'screen-update',
      sessionId: n.screenUpdateNotification.session ?? null,
      summary: '',
    };
  }
  if (n.promptNotification) {
    const p = n.promptNotification;
    return {
      kind: 'prompt',
      sessionId: p.session ?? null,
      summary: `${p.event.case ?? 'prompt'}`,
    };
  }
  if (n.customEscapeSequenceNotification) {
    const c = n.customEscapeSequenceNotification;
    return {
      kind: 'custom-escape',
      sessionId: c.session ?? null,
      summary: `${c.senderIdentity ?? ''}: ${(c.payload ?? '').slice(0, 80)}`,
    };
  }
  if (n.newSessionNotification) {
    return {
      kind: 'new-session',
      sessionId: n.newSessionNotification.sessionId ?? null,
      summary: `new session ${n.newSessionNotification.sessionId ?? ''}`,
    };
  }
  if (n.terminateSessionNotification) {
    return {
      kind: 'terminate-session',
      sessionId: n.terminateSessionNotification.sessionId ?? null,
      summary: `terminated ${n.terminateSessionNotification.sessionId ?? ''}`,
    };
  }
  if (n.layoutChangedNotification) {
    return { kind: 'layout-changed', sessionId: null, summary: 'layout changed' };
  }
  if (n.focusChangedNotification) {
    return {
      kind: 'focus-changed',
      sessionId: null,
      summary: `${n.focusChangedNotification.event.case ?? ''}`,
    };
  }
  if (n.variableChangedNotification) {
    const v = n.variableChangedNotification;
    return {
      kind: 'variable-changed',
      sessionId: v.identifier || null,
      summary: `${v.name ?? ''}=${(v.jsonNewValue ?? '').slice(0, 80)}`,
    };
  }
  if (n.serverOriginatedRpcNotification) {
    return {
      kind: 'server-rpc',
      sessionId: null,
      summary: `rpc ${n.serverOriginatedRpcNotification.rpc?.name ?? ''}`,
    };
  }
  if (n.broadcastDomainsChanged) {
    return { kind: 'broadcast-changed', sessionId: null, summary: 'broadcast domains changed' };
  }
  if (n.profileChangedNotification) {
    return {
      kind: 'profile-changed',
      sessionId: null,
      summary: `profile ${n.profileChangedNotification.guid ?? ''}`,
    };
  }
  if (n.locationChangeNotification) {
    return {
      kind: 'location-changed',
      sessionId: n.locationChangeNotification.session ?? null,
      summary: '',
    };
  }
  return { kind: 'unknown', sessionId: null, summary: '' };
}
