import { makeAutoObservable } from 'mobx';
import type { ProtocolState } from '../drivers/ProtocolDriver';

export interface ConnectionSnapshot {
  state: ConnectionState;
  socketPath: string;
  socketExists: boolean;
  protocolVersion: string;
  advisoryName: string;
  cookieRequestedAt: number | null;
  lastError: string | null;
  wireFramesSeen: number;
  lastLatencyMs: number | null;
}

export type ConnectionState =
  | 'idle'
  | 'detecting'
  | 'requesting-cookie'
  | 'connecting'
  | 'ready'
  | 'error';

export class ConnectionStore {
  state: ConnectionState = 'idle';
  socketPath = '';
  socketExists = false;
  protocolVersion = '';
  advisoryName = '';
  cookieRequestedAt: number | null = null;
  lastError: string | null = null;
  wireFramesSeen = 0;
  lastLatencyMs: number | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setSocket(path: string, exists: boolean): void {
    this.socketPath = path;
    this.socketExists = exists;
  }

  setState(next: ConnectionState): void {
    this.state = next;
    if (next !== 'error') this.lastError = null;
  }

  setError(message: string): void {
    this.state = 'error';
    this.lastError = message;
  }

  syncFromProtocol(protoState: ProtocolState, protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
    if (protoState === 'disconnected') this.state = 'idle';
    else if (protoState === 'connecting') this.state = 'connecting';
    else if (protoState === 'ready') this.state = 'ready';
  }

  noteCookieRequested(): void {
    this.cookieRequestedAt = Date.now();
  }

  recordFrame(): void {
    this.wireFramesSeen += 1;
  }

  setLatency(ms: number): void {
    this.lastLatencyMs = ms;
  }

  snapshot(): ConnectionSnapshot {
    return {
      state: this.state,
      socketPath: this.socketPath,
      socketExists: this.socketExists,
      protocolVersion: this.protocolVersion,
      advisoryName: this.advisoryName,
      cookieRequestedAt: this.cookieRequestedAt,
      lastError: this.lastError,
      wireFramesSeen: this.wireFramesSeen,
      lastLatencyMs: this.lastLatencyMs,
    };
  }
}
