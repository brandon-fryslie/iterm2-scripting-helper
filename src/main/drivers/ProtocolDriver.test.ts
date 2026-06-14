import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { ProtocolDriver } from './ProtocolDriver';

// The production socket lives at "~/Library/Application Support/iTerm2/private/socket" — a path with a
// space. `ws` derives its connect target from `parsedUrl.pathname`, which percent-encodes that space to
// "%20", so a `ws+unix://` URL built from the raw path asks the kernel for a socket that does not exist.
// ProtocolDriver works around this by symlinking the real socket to a space-free name in tmpdir. These
// tests pin that workaround against a REAL Unix-domain socket whose path contains a space, with no iTerm2.

// A short path: macOS caps Unix-socket paths (sun_path) at ~104 bytes, so the space — not deep nesting —
// is what these tests reproduce.
function spacedSocketPath(base: string): string {
  return path.join(base, 'App Support', 'socket');
}

function helperSymlinks(): string[] {
  return readdirSync(os.tmpdir()).filter((name) =>
    name.startsWith(`iterm2-helper-${process.pid}-`),
  );
}

describe('ProtocolDriver ws+unix Application Support workaround', () => {
  let base: string;
  let socketPath: string;
  let httpServer: http.Server;
  let wss: WebSocketServer;

  beforeEach(async () => {
    base = mkdtempSync(path.join(os.tmpdir(), 'wb-sock-'));
    socketPath = spacedSocketPath(base);
    mkdirSync(path.dirname(socketPath), { recursive: true });

    httpServer = http.createServer();
    wss = new WebSocketServer({ server: httpServer });
    // iTerm2 reports its protocol version in the upgrade response; mirror that so the driver has a real
    // header to capture.
    wss.on('headers', (headers) => headers.push('x-iterm2-protocol-version: 1.7'));
    await new Promise<void>((resolve) => httpServer.listen(socketPath, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  });

  function connectOptions() {
    return {
      socketPath,
      advisoryName: 'workbench-test',
      cookie: 'test-cookie',
      key: 'test-key',
      libraryVersion: '0.0.0-test',
    };
  }

  it('connects through the symlink to a socket whose path contains a space', async () => {
    const driver = new ProtocolDriver();
    const info = await driver.connect(connectOptions());

    expect(driver.getState()).toBe('ready');
    expect(info.protocolVersion).toBe('1.7');

    await driver.disconnect();
  });

  // The accept/reject companion: prove the naive direct URL fails, so the workaround above is verified
  // against the actual failure it prevents rather than against nothing.
  it('rejects a direct ws+unix URL built from the spaced path', async () => {
    const directUrl = `ws+unix://${socketPath}:/`;
    const ws = new WebSocket(directUrl, 'api.iterm2.com', {
      headers: { Origin: 'ws://localhost/', Host: 'localhost:0' },
    });

    const outcome = await new Promise<{ opened: boolean; code?: string }>((resolve) => {
      ws.once('open', () => resolve({ opened: true }));
      ws.once('error', (err: NodeJS.ErrnoException) =>
        resolve({ opened: false, code: err.code }),
      );
    });

    expect(outcome.opened).toBe(false);
    expect(outcome.code).toBe('ENOENT');
  });

  it('removes the temp symlink after disconnect, leaving no dangling socket', async () => {
    const driver = new ProtocolDriver();
    await driver.connect(connectOptions());
    expect(helperSymlinks()).toHaveLength(1);

    await driver.disconnect();
    expect(helperSymlinks()).toHaveLength(0);
  });
});
