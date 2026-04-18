import { makeAutoObservable } from 'mobx';
import type { GetBufferResponse } from '@shared/proto/gen/api_pb';

export interface ScreenCellStyle {
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  blink: boolean;
}

export interface ScreenLine {
  index: number;
  text: string;
}

export interface ScreenBuffer {
  sessionId: string | null;
  lines: ScreenLine[];
  cursor: { x: number; y: number } | null;
  numLinesAboveScreen: number;
  lastUpdatedAt: number;
  requestsInflight: number;
  updatesReceived: number;
  lastError: string | null;
}

const EMPTY: ScreenBuffer = {
  sessionId: null,
  lines: [],
  cursor: null,
  numLinesAboveScreen: 0,
  lastUpdatedAt: 0,
  requestsInflight: 0,
  updatesReceived: 0,
  lastError: null,
};

export class ScreenStreamStore {
  buffer: ScreenBuffer = EMPTY;

  constructor() {
    makeAutoObservable(this);
  }

  setFocused(sessionId: string | null): void {
    this.buffer = { ...EMPTY, sessionId };
  }

  applyGetBufferResponse(sessionId: string, response: GetBufferResponse): void {
    if (this.buffer.sessionId !== sessionId) return;
    this.buffer = {
      sessionId,
      lines: response.contents.map((lc, idx) => ({
        index: idx,
        text: (lc.text ?? '').replace(/\u0000/g, ''),
      })),
      cursor: response.cursor
        ? { x: Number(response.cursor.x), y: Number(response.cursor.y) }
        : null,
      numLinesAboveScreen: Number(response.numLinesAboveScreen ?? 0),
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
    return {
      sessionId: this.buffer.sessionId,
      lines: this.buffer.lines.map((l) => ({ index: l.index, text: l.text })),
      cursor: this.buffer.cursor
        ? { x: this.buffer.cursor.x, y: this.buffer.cursor.y }
        : null,
      numLinesAboveScreen: this.buffer.numLinesAboveScreen,
      lastUpdatedAt: this.buffer.lastUpdatedAt,
      requestsInflight: this.buffer.requestsInflight,
      updatesReceived: this.buffer.updatesReceived,
      lastError: this.buffer.lastError,
    };
  }
}
