import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { AppleScriptDriver, AppleScriptError } from './AppleScriptDriver';
import {
  ProtocolDriver,
  ProtocolError,
  type WireFrame,
} from './ProtocolDriver';
import type { ConnectionStore } from '../stores/ConnectionStore';
import type { ServerOriginatedMessage, Notification } from '@shared/proto/gen/api_pb';

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

export interface OrchestratorOptions {
  advisoryName: string;
  libraryVersion: string;
  socketPath?: string;
}

export class ConnectionOrchestrator extends EventEmitter {
  private readonly applescript = new AppleScriptDriver();
  private readonly protocol = new ProtocolDriver();
  private readonly options: Required<OrchestratorOptions>;
  private credentials: { cookie: string; key: string } | null = null;

  constructor(
    private readonly store: ConnectionStore,
    options: OrchestratorOptions,
  ) {
    super();
    this.options = {
      socketPath: DEFAULT_SOCKET_PATH,
      ...options,
    };
    this.store.advisoryName = this.options.advisoryName;
    this.store.setSocket(this.options.socketPath, existsSync(this.options.socketPath));

    this.protocol.on('frame', (frame: WireFrame) => {
      this.store.recordFrame();
      this.emit('frame', frame);
    });
    this.protocol.on('notification', (n: Notification) => this.emit('notification', n));
    this.protocol.on('state', () =>
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion()),
    );
    this.protocol.on('close', ({ code, reason }) => {
      this.emit('close', { code, reason });
    });
    this.protocol.on('error', (err) => {
      this.store.setError(errString(err));
      this.emit('error', err);
    });
  }

  async connect(): Promise<void> {
    try {
      this.store.setState('detecting');
      const exists = existsSync(this.options.socketPath);
      this.store.setSocket(this.options.socketPath, exists);
      if (!exists) {
        throw new ProtocolError(
          `iTerm2 private socket not found at ${this.options.socketPath}. Is iTerm2 running?`,
        );
      }

      this.store.setState('requesting-cookie');
      this.store.noteCookieRequested();
      this.credentials = await this.applescript.requestCookieAndKey(
        this.options.advisoryName,
      );

      this.store.setState('connecting');
      await this.protocol.connect({
        socketPath: this.options.socketPath,
        advisoryName: this.options.advisoryName,
        libraryVersion: this.options.libraryVersion,
        cookie: this.credentials.cookie,
        key: this.credentials.key,
      });
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion());
    } catch (err) {
      this.store.setError(errString(err));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.protocol.disconnect();
    this.credentials = null;
  }

  async sendRequest(
    msg: Parameters<ProtocolDriver['send']>[0],
  ): Promise<ServerOriginatedMessage> {
    const started = Date.now();
    const response = await this.protocol.send(msg);
    this.store.setLatency(Date.now() - started);
    return response;
  }

  getSocketPath(): string {
    return this.options.socketPath;
  }
}

function errString(err: unknown): string {
  if (err instanceof AppleScriptError || err instanceof ProtocolError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
