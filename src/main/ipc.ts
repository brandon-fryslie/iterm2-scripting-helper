import { ipcMain, webContents, type WebContents } from 'electron';
import { app } from 'electron';
import { create } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ListSessionsRequestSchema,
} from '@shared/proto/gen/api_pb';
import type {
  RpcMethod,
  RpcArgs,
  RpcResult,
  EventKind,
  EventPayload,
  ListSessionsSummary,
} from '@shared/rpc';
import type { ConnectionStore } from './stores/ConnectionStore';
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

type Handlers = { [M in RpcMethod]: (args: RpcArgs<M>) => Promise<RpcResult<M>> };

export function registerIpc(
  store: ConnectionStore,
  orchestrator: ConnectionOrchestrator,
): void {
  const handlers: Handlers = {
    'system/ping': async () => ({
      ok: true,
      now: Date.now(),
      electron: process.versions.electron ?? 'unknown',
    }),

    'connection/snapshot': async () => store.snapshot(),

    'connection/connect': async () => {
      try {
        await orchestrator.connect();
      } catch {
        /* error already recorded on store */
      }
      return store.snapshot();
    },

    'connection/disconnect': async () => {
      await orchestrator.disconnect();
      return store.snapshot();
    },

    'connection/list-sessions': async (): Promise<ListSessionsSummary> => {
      const envelope = {
        submessage: {
          case: 'listSessionsRequest' as const,
          value: create(ListSessionsRequestSchema, {}),
        },
      };
      const response = await orchestrator.sendRequest(envelope);
      if (response.submessage.case === 'error') {
        throw new Error(response.submessage.value);
      }
      if (response.submessage.case !== 'listSessionsResponse') {
        throw new Error(
          `expected listSessionsResponse, got ${response.submessage.case ?? '<none>'}`,
        );
      }
      const r = response.submessage.value;
      return {
        windows: r.windows.map((w) => ({
          windowId: w.windowId,
          tabs: w.tabs.map((t) => ({
            tabId: t.tabId,
            sessions: collectSessions(t),
          })),
        })),
      };
    },
  };

  ipcMain.handle('rpc', async (_event, payload: { method: RpcMethod; args: unknown }) => {
    const handler = handlers[payload.method] as (a: unknown) => Promise<unknown>;
    return handler(payload.args);
  });
}

function collectSessions(tab: {
  root?: unknown;
}): Array<{ sessionId: string }> {
  const out: Array<{ sessionId: string }> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (typeof n.uniqueIdentifier === 'string') {
      out.push({ sessionId: n.uniqueIdentifier });
    }
    if (Array.isArray(n.links)) {
      for (const link of n.links) walk((link as { node?: unknown }).node);
    }
  };
  walk(tab.root);
  return out;
}

export function broadcast<K extends EventKind>(kind: K, payload: EventPayload<K>): void {
  const channel = `event:${String(kind)}`;
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }
}

export type { WebContents };
export { app };
