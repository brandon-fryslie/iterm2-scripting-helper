import { makeAutoObservable, observable } from 'mobx';
import type { AppLine } from '@shared/domain';

export interface ScreenBuffer {
  sessionId: string | null;
  lines: AppLine[];
  cursor: { x: number; y: number } | null;
  lastUpdatedAt: number;
  requestsInflight: number;
  updatesReceived: number;
  lastError: string | null;
}

const EMPTY: ScreenBuffer = {
  sessionId: null,
  lines: [],
  cursor: null,
  lastUpdatedAt: 0,
  requestsInflight: 0,
  updatesReceived: 0,
  lastError: null,
};

export class ScreenStreamStore {
  buffer: ScreenBuffer = EMPTY;

  constructor() {
    makeAutoObservable(this, {
      buffer: observable.ref,
    });
  }

  setFocused(sessionId: string | null): void {
    this.buffer = { ...EMPTY, sessionId };
  }

  applyBuffer(sessionId: string, lines: AppLine[], cursor: { x: number; y: number } | null): void {
    if (this.buffer.sessionId !== sessionId) return;
    this.buffer = {
      sessionId,
      lines,
      cursor,
      lastUpdatedAt: Date.now(),
      requestsInflight: Math.max(0, this.buffer.requestsInflight - 1),
      updatesReceived: this.buffer.updatesReceived + 1,
      lastError: null,
    };
  }

  noteFetchStarted(): void {
    this.buffer = {
      ...this.buffer,
      requestsInflight: this.buffer.requestsInflight + 1,
    };
  }

  noteFetchFailed(error?: string): void {
    this.buffer = {
      ...this.buffer,
      requestsInflight: Math.max(0, this.buffer.requestsInflight - 1),
      lastError: error ?? 'unknown error',
    };
  }

  clear(): void {
    this.buffer = EMPTY;
  }

  snapshot(): ScreenBuffer {
    return this.buffer;
  }
}
