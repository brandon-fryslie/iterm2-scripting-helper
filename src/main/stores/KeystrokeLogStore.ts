import { makeAutoObservable } from 'mobx';
import type { KeystrokeNotification } from '@shared/proto/gen/api_pb';
import { KeystrokeNotification_Action, Modifiers } from '@shared/proto/gen/api_pb';

export type KeystrokeAction = 'key-down' | 'key-up' | 'flags-changed';
export type KeystrokeModifier = 'control' | 'option' | 'command' | 'shift' | 'function' | 'numpad';

export interface KeystrokeEntry {
  seq: number;
  at: number;
  sessionId: string;
  characters: string;
  charactersIgnoringModifiers: string;
  modifiers: KeystrokeModifier[];
  keyCode: number;
  action: KeystrokeAction;
}

export interface KeystrokeLogSnapshot {
  entries: KeystrokeEntry[];
  totalSeen: number;
  capacity: number;
  advanced: boolean;
}

const DEFAULT_CAPACITY = 2000;
const ACTION_MAP: Record<KeystrokeNotification_Action, KeystrokeAction> = {
  [KeystrokeNotification_Action.KEY_DOWN]: 'key-down',
  [KeystrokeNotification_Action.KEY_UP]: 'key-up',
  [KeystrokeNotification_Action.FLAGS_CHANGED]: 'flags-changed',
};

export class KeystrokeLogStore {
  private readonly capacity: number;
  private ring: (KeystrokeEntry | undefined)[];
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalSeen = 0;
  advanced = false;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<KeystrokeEntry | undefined>(capacity);
    makeAutoObservable(this);
  }

  setAdvanced(advanced: boolean): void {
    this.advanced = advanced;
  }

  record(n: KeystrokeNotification): KeystrokeEntry {
    const entry: KeystrokeEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      sessionId: n.session,
      characters: n.characters,
      charactersIgnoringModifiers: n.charactersIgnoringModifiers,
      modifiers: n.modifiers.map(modifierName),
      keyCode: n.keyCode,
      action: ACTION_MAP[n.action] ?? 'key-down',
    };
    this.ring[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
    this.totalSeen += 1;
    return entry;
  }

  clear(): void {
    this.ring = new Array<KeystrokeEntry | undefined>(this.capacity);
    this.head = 0;
    this.length = 0;
    this.totalSeen = 0;
    this.nextSeq = 1;
  }

  snapshot(): KeystrokeLogSnapshot {
    const entries: KeystrokeEntry[] = [];
    const start = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const e = this.ring[(start + i) % this.capacity];
      if (e) {
        entries.push({
          seq: e.seq,
          at: e.at,
          sessionId: e.sessionId,
          characters: e.characters,
          charactersIgnoringModifiers: e.charactersIgnoringModifiers,
          modifiers: [...e.modifiers],
          keyCode: e.keyCode,
          action: e.action,
        });
      }
    }
    return {
      entries,
      totalSeen: this.totalSeen,
      capacity: this.capacity,
      advanced: this.advanced,
    };
  }
}

function modifierName(m: Modifiers): KeystrokeModifier {
  switch (m) {
    case Modifiers.CONTROL:
      return 'control';
    case Modifiers.OPTION:
      return 'option';
    case Modifiers.COMMAND:
      return 'command';
    case Modifiers.SHIFT:
      return 'shift';
    case Modifiers.FUNCTION:
      return 'function';
    case Modifiers.NUMPAD:
      return 'numpad';
    default:
      return 'control';
  }
}
