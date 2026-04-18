#!/usr/bin/env node
import { WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { symlinkSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  ListSessionsRequestSchema,
} from '../src/shared/proto/gen/api_pb.ts';

const pExecFile = promisify(execFile);

const APP_NAME = 'iTerm2 Scripting Workbench (verify)';
const REAL_SOCKET = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

async function requestCookie() {
  const script = `tell application "iTerm2" to request cookie and key for app named "${APP_NAME}"`;
  const { stdout } = await pExecFile('/usr/bin/osascript', ['-e', script]);
  const trimmed = stdout.trim();
  const sep = trimmed.indexOf(' ');
  if (sep < 0) throw new Error(`unexpected osascript output: ${trimmed}`);
  return { cookie: trimmed.slice(0, sep), key: trimmed.slice(sep + 1) };
}

function symlinkSocket() {
  const link = path.join(os.tmpdir(), `iterm2-verify-${process.pid}.sock`);
  if (existsSync(link)) unlinkSync(link);
  symlinkSync(REAL_SOCKET, link);
  return link;
}

async function main() {
  console.log('[1/4] requesting cookie+key from iTerm2...');
  const { cookie, key } = await requestCookie();
  console.log('      cookie=' + cookie.slice(0, 8) + '...  key=' + key.slice(0, 8) + '...');

  console.log('[2/4] creating /tmp symlink to socket...');
  const linkPath = symlinkSocket();
  console.log('      ' + linkPath);

  console.log('[3/4] opening WebSocket...');
  const url = `ws+unix://${linkPath}:/`;
  const ws = new WebSocket(url, 'api.iterm2.com', {
    headers: {
      Origin: 'ws://localhost/',
      Host: 'localhost:0',
      'x-iterm2-library-version': 'node 1.0',
      'x-iterm2-advisory-name': APP_NAME,
      'x-iterm2-cookie': cookie,
      'x-iterm2-key': key,
      'x-iterm2-disable-auth-ui': 'true',
    },
  });

  ws.on('upgrade', (res) => {
    console.log(
      '      response protocol version: ' +
        (res.headers['x-iterm2-protocol-version'] ?? '<missing>'),
    );
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  console.log('      open.');

  console.log('[4/4] sending ListSessionsRequest...');
  const msg = create(ClientOriginatedMessageSchema, {
    id: 1n,
    submessage: {
      case: 'listSessionsRequest',
      value: create(ListSessionsRequestSchema, {}),
    },
  });
  const bytes = toBinary(ClientOriginatedMessageSchema, msg);
  ws.send(bytes);

  const reply = await new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data));
    ws.once('error', reject);
    setTimeout(() => reject(new Error('timeout waiting for response')), 5000);
  });

  const server = fromBinary(ServerOriginatedMessageSchema, reply);
  console.log('      server id=' + server.id);
  console.log('      server error=' + (server.error ?? '(none)'));
  console.log('      server case=' + server.submessage.case);
  if (server.submessage.case === 'listSessionsResponse') {
    const r = server.submessage.value;
    console.log('      windows: ' + r.windows.length);
    for (const w of r.windows) {
      console.log('        window ' + w.windowId + ' tabs: ' + w.tabs.length);
      for (const t of w.tabs) {
        console.log('          tab ' + t.tabId);
      }
    }
  }

  ws.close();
  unlinkSync(linkPath);
  console.log('\nhandshake OK.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
