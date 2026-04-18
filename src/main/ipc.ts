import { ipcMain, webContents, type WebContents } from 'electron';
import { create } from '@bufbuild/protobuf';
import {
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
import type { LayoutStore } from './stores/LayoutStore';
import type { VariableStore } from './stores/VariableStore';
import type { WireLogStore } from './stores/WireLogStore';
import type { NotificationHub } from './stores/NotificationHub';
import type { KeystrokeLogStore } from './stores/KeystrokeLogStore';
import type { PromptLogStore } from './stores/PromptLogStore';
import type { FocusLogStore } from './stores/FocusLogStore';
import type { ScreenStreamStore } from './stores/ScreenStreamStore';
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

type Handlers = { [M in RpcMethod]: (args: RpcArgs<M>) => Promise<RpcResult<M>> };

export interface MonitorStoresRef {
  layout: LayoutStore;
  variables: VariableStore;
  wire: WireLogStore;
  notifications: NotificationHub;
  keystrokes: KeystrokeLogStore;
  prompts: PromptLogStore;
  focus: FocusLogStore;
  screen: ScreenStreamStore;
}

export function registerIpc(
  store: ConnectionStore,
  orchestrator: ConnectionOrchestrator,
  monitor: MonitorStoresRef,
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

    'monitor/layout': async () => monitor.layout.snapshot(),
    'monitor/variables': async () => monitor.variables.snapshot(),
    'monitor/wire-log': async () => monitor.wire.snapshot(),
    'monitor/notifications': async () => monitor.notifications.snapshot(),
    'monitor/focus-session': async ({ sessionId }) => {
      await orchestrator.setFocusedSession(sessionId);
      return { focusedSessionId: monitor.variables.focusedSessionId };
    },
    'monitor/keystrokes': async () => monitor.keystrokes.snapshot(),
    'monitor/prompts': async () => monitor.prompts.snapshot(),
    'monitor/focus-log': async () => monitor.focus.snapshot(),
    'monitor/screen': async () => monitor.screen.snapshot(),
    'monitor/set-keystroke-advanced': async ({ advanced }) => {
      await orchestrator.setKeystrokeAdvanced(advanced);
      return { advanced: monitor.keystrokes.advanced };
    },
  };

  ipcMain.handle('rpc', async (_event, payload: { method: RpcMethod; args: unknown }) => {
    const handler = handlers[payload.method] as (a: unknown) => Promise<unknown>;
    return handler(payload.args);
  });
}

function collectSessions(tab: {
  root?: import('@shared/proto/gen/api_pb').SplitTreeNode;
}): Array<{ sessionId: string }> {
  const out: Array<{ sessionId: string }> = [];
  const walk = (node: import('@shared/proto/gen/api_pb').SplitTreeNode | undefined): void => {
    if (!node) return;
    for (const link of node.links) {
      if (link.child.case === 'session') {
        out.push({ sessionId: link.child.value.uniqueIdentifier });
      } else if (link.child.case === 'node') {
        walk(link.child.value);
      }
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
