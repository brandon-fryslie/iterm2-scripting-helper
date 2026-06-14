import { makeAutoObservable } from 'mobx';
import type { ProtocolState } from '../drivers/ProtocolDriver';
// [LAW:one-source-of-truth] The snapshot shape is defined once in the shared layer (it crosses the IPC
// boundary); the store reads and writes that one type instead of a structural twin that could drift.
import type { ConnectionSnapshot, ConnectionState, ConnectionFailure } from '@shared/rpc';
import { classifyConnectionFailure } from '../connectionFailure';

export class ConnectionStore {
  state: ConnectionState = 'idle';
  socketPath = '';
  socketExists = false;
  protocolVersion = '';
  advisoryName = '';
  cookieRequestedAt: number | null = null;
  lastError: ConnectionFailure | null = null;
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

  // [LAW:single-enforcer] Every connection-error path funnels here, so the rule "a failure is
  // classified into a typed ConnectionFailure (recoverable Automation denial vs. opaque other)" is
  // applied exactly once. Callers pass the raw cause; classification is the pure boundary logic.
  setError(message: string): void {
    this.state = 'error';
    this.lastError = classifyConnectionFailure(message);
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
