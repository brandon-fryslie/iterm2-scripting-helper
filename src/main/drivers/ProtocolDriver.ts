import { EventEmitter } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import path from 'node:path';
import os from 'node:os';
import { symlinkSync, existsSync, unlinkSync } from 'node:fs';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  type ClientOriginatedMessage,
  type ServerOriginatedMessage,
  type Notification,
} from '@shared/proto/gen/api_pb';

export type ProtocolState = 'disconnected' | 'connecting' | 'ready';

export interface ProtocolDriverOptions {
  socketPath: string;
  advisoryName: string;
  cookie: string;
  key: string;
  libraryVersion: string;
  disableAuthUi?: boolean;
}

export interface ProtocolConnectedInfo {
  protocolVersion: string;
}

export interface WireFrame {
  direction: 'out' | 'in';
  bytes: Uint8Array;
  at: number;
  // [LAW:one-source-of-truth] The single protocol-event identity, minted here at the transport
  // boundary. Every event derived from this frame (the wire-frame event, a notification, a resulting
  // variable change) carries this same number and joins on it.
  frameSeq: number;
}

// [LAW:no-ambient-temporal-coupling] A response is resolved together with the frameSeq of the frame
// that carried it, so a consumer (e.g. a variable dump) can attribute the response's effects to that
// exact frame without depending on emit ordering or timestamp windowing.
export interface ProtocolResponse {
  message: ServerOriginatedMessage;
  frameSeq: number;
}

// A notification arrives carrying the frameSeq of the inbound frame it was decoded from, so the
// resulting variable change can share that frameSeq and the three join with no timestamp matching.
export interface ProtocolNotification {
  notification: Notification;
  frameSeq: number;
}

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

type PendingResolver = (reply: ProtocolResponse) => void;

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class ProtocolDriver extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<bigint, PendingResolver>();
  private nextId = 1n;
  private nextFrameSeq = 1;
  private linkPath: string | null = null;
  private state: ProtocolState = 'disconnected';
  private protocolVersion = '';

  getState(): ProtocolState {
    return this.state;
  }

  getProtocolVersion(): string {
    return this.protocolVersion;
  }

  async connect(options: ProtocolDriverOptions): Promise<ProtocolConnectedInfo> {
    if (this.state !== 'disconnected') {
      throw new ProtocolError(`connect called in state ${this.state}`);
    }
    if (!existsSync(options.socketPath)) {
      throw new ProtocolError(`socket not found: ${options.socketPath}`);
    }

    this.setState('connecting');

    this.linkPath = path.join(
      os.tmpdir(),
      `iterm2-helper-${process.pid}-${Date.now()}.sock`,
    );
    if (existsSync(this.linkPath)) unlinkSync(this.linkPath);
    symlinkSync(options.socketPath, this.linkPath);

    const url = `ws+unix://${this.linkPath}:/`;
    const ws = new WebSocket(url, 'api.iterm2.com', {
      headers: {
        Origin: 'ws://localhost/',
        Host: 'localhost:0',
        'x-iterm2-library-version': options.libraryVersion,
        'x-iterm2-advisory-name': options.advisoryName,
        'x-iterm2-cookie': options.cookie,
        'x-iterm2-key': options.key,
        'x-iterm2-disable-auth-ui': (options.disableAuthUi ?? true) ? 'true' : 'false',
      },
    });
    this.ws = ws;

    const info = await new Promise<ProtocolConnectedInfo>((resolve, reject) => {
      let resolved = false;
      ws.once('upgrade', (res) => {
        const v = res.headers['x-iterm2-protocol-version'];
        if (typeof v === 'string') this.protocolVersion = v;
        else if (Array.isArray(v) && v[0]) this.protocolVersion = v[0];
      });
      ws.once('open', () => {
        resolved = true;
        resolve({ protocolVersion: this.protocolVersion });
      });
      ws.once('error', (err) => {
        if (!resolved) reject(new ProtocolError('websocket error during open', err));
      });
    });

    ws.on('message', (data) => this.onMessage(data));
    ws.on('close', (code, reasonBuf) => this.onClose(code, reasonBuf.toString('utf8')));
    ws.on('error', (err) => this.emit('error', err));

    this.setState('ready');
    this.emit('open', info);
    return info;
  }

  async send(msg: Omit<ClientOriginatedMessage, 'id' | '$typeName'>): Promise<ProtocolResponse> {
    if (this.state !== 'ready' || !this.ws) {
      throw new ProtocolError(`send called in state ${this.state}`);
    }
    const id = this.nextId++;
    const envelope = create(ClientOriginatedMessageSchema, { ...msg, id });
    const bytes = toBinary(ClientOriginatedMessageSchema, envelope);

    const response = new Promise<ProtocolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProtocolError(`request ${id} timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
    });

    this.emitFrame('out', bytes);
    this.ws.send(bytes);
    return response;
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      // [LAW:no-ambient-temporal-coupling] An intentional disconnect owns its teardown timing: drop both
      // listeners and run the close path synchronously, so by the time disconnect resolves the spine is
      // already torn down — never on a later ws 'close' tick that would race whatever runs right after
      // (e.g. a fixture replay restoring the spine).
      ws.removeAllListeners('message');
      ws.removeAllListeners('close');
      ws.close();
      this.finishClose(1000, 'client disconnect');
      return;
    }
    this.cleanupSymlink();
    this.pending.clear();
    this.setState('disconnected');
  }

  private onMessage(data: RawData): void {
    const bytes = toUint8Array(data);
    const frameSeq = this.emitFrame('in', bytes);

    let server: ServerOriginatedMessage;
    try {
      server = fromBinary(ServerOriginatedMessageSchema, bytes);
    } catch (err) {
      this.emit('error', new ProtocolError('failed to decode server frame', err));
      return;
    }

    if (server.submessage.case === 'notification') {
      this.emit('notification', {
        notification: server.submessage.value satisfies Notification,
        frameSeq,
      });
      return;
    }

    const resolver = this.pending.get(server.id);
    if (!resolver) {
      this.emit('error', new ProtocolError(`no pending request for response id ${server.id}`));
      return;
    }
    this.pending.delete(server.id);
    resolver({ message: server, frameSeq });
  }

  private onClose(code: number, reason: string): void {
    this.finishClose(code, reason);
  }

  // The single teardown both an unexpected drop (ws 'close') and an intentional disconnect route
  // through, so the spine and connection state always settle the same way regardless of which path
  // closed the socket.
  private finishClose(code: number, reason: string): void {
    this.ws = null;
    this.cleanupSymlink();
    this.pending.clear();
    this.setState('disconnected');
    this.emit('close', { code, reason });
  }

  private cleanupSymlink(): void {
    if (this.linkPath) {
      try {
        if (existsSync(this.linkPath)) unlinkSync(this.linkPath);
      } catch {
        /* best-effort */
      }
      this.linkPath = null;
    }
  }

  private emitFrame(direction: 'out' | 'in', bytes: Uint8Array): number {
    const frameSeq = this.nextFrameSeq++;
    this.emit('frame', { direction, bytes, at: Date.now(), frameSeq } satisfies WireFrame);
    return frameSeq;
  }

  private setState(next: ProtocolState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('state', next);
  }
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) {
    const total = data.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of data) {
      out.set(b, off);
      off += b.length;
    }
    return out;
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new ProtocolError('unsupported RawData type from ws');
}
