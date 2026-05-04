import { makeAutoObservable } from 'mobx';
import type { GetBufferResponse, CellStyle as ProtoCellStyle } from '@shared/proto/gen/api_pb';

export interface CellStyleRun {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  repeats: number;
}

export interface StyledLine {
  index: number;
  text: string;
  styles: CellStyleRun[];
}

export interface ScreenBuffer {
  sessionId: string | null;
  lines: StyledLine[];
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

const ANSI_16: readonly string[] = [
  '#000000', '#800000', '#008000', '#808000',
  '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00',
  '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
];

function colorToHex(c: ProtoCellStyle['fgColor'] | ProtoCellStyle['bgColor']): string | null {
  if (c.case === 'fgStandard' || c.case === 'bgStandard') {
    return ANSI_16[c.value] ?? null;
  }
  if (c.case === 'fgRgb' || c.case === 'bgRgb') {
    const { red, green, blue } = c.value;
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
  }
  return null;
}

function convertProtoStyle(s: ProtoCellStyle): CellStyleRun {
  return {
    fg: colorToHex(s.fgColor),
    bg: colorToHex(s.bgColor),
    bold: s.bold,
    faint: s.faint,
    italic: s.italic,
    underline: s.underline,
    strikethrough: s.strikethrough,
    inverse: s.inverse,
    repeats: s.repeats || 1,
  };
}

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
        styles: lc.style.map(convertProtoStyle),
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
      lines: this.buffer.lines.map((l) => ({
        index: l.index,
        text: l.text,
        styles: l.styles,
      })),
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
