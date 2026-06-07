import { ipcMain, webContents, type WebContents } from 'electron';
import { create } from '@bufbuild/protobuf';
import {
  ListSessionsRequestSchema,
} from '@shared/proto/gen/api_pb';
import { convertLayout } from '@shared/converters';
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
import type { DynamicProfileStore } from './stores/DynamicProfileStore';
import type { RegistrationStore } from './stores/RegistrationStore';
import type { CustomEscapeStore } from './stores/CustomEscapeStore';
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';
import type { DynamicProfileWatcher } from './drivers/DynamicProfileWatcher';
import {
  actionSendText,
  actionInject,
  actionActivate,
  actionMenuItem,
  actionInvokeFunction,
  actionRestartSession,
  actionClose,
  actionRawProtobuf,
} from './actions';
import { listProfiles, setProfileProperty } from './workbench';

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
  registrations: RegistrationStore;
  customEscape: CustomEscapeStore;
}

export interface WorkbenchStoresRef {
  dynamicProfiles: DynamicProfileStore;
  dynamicProfileWatcher: DynamicProfileWatcher;
}

export function registerIpc(
  store: ConnectionStore,
  orchestrator: ConnectionOrchestrator,
  monitor: MonitorStoresRef,
  workbench: WorkbenchStoresRef,
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
      const layout = convertLayout(response.submessage.value);
      return {
        windows: layout.windows,
        buriedSessions: layout.buriedSessions,
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
    'monitor/focus-variables': async ({ entity }) => {
      await orchestrator.setFocusedVariables(entity);
      return monitor.variables.snapshot();
    },
    'monitor/keystrokes': async () => monitor.keystrokes.snapshot(),
    'monitor/prompts': async () => monitor.prompts.snapshot(),
    'monitor/focus-log': async () => monitor.focus.snapshot(),
    'monitor/screen': async () => monitor.screen.snapshot(),
    'monitor/set-keystroke-advanced': async ({ advanced }) => {
      await orchestrator.setKeystrokeAdvanced(advanced);
      return { advanced: monitor.keystrokes.advanced };
    },
    'actions/send-text': (args) => actionSendText(orchestrator, args),
    'actions/inject': (args) => actionInject(orchestrator, args),
    'actions/activate': (args) => actionActivate(orchestrator, args),
    'actions/menu-item': (args) => actionMenuItem(orchestrator, args),
    'actions/invoke-function': (args) => actionInvokeFunction(orchestrator, args),
    'actions/restart-session': (args) => actionRestartSession(orchestrator, args),
    'actions/close': (args) => actionClose(orchestrator, args),
    'actions/raw-protobuf': (args) => actionRawProtobuf(orchestrator, args),
    'workbench/list-profiles': () => listProfiles(orchestrator),
    'workbench/set-profile-property': (args) => setProfileProperty(orchestrator, args),
    'workbench/dynamic-profiles': async () => {
      await workbench.dynamicProfileWatcher.refresh().catch(() => void 0);
      return workbench.dynamicProfiles.snapshot();
    },
    'workbench/save-dynamic-profile': async ({ basename, body }) => {
      try {
        const p = await workbench.dynamicProfileWatcher.writeFile(basename, body);
        return { ok: true, error: null, path: p };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          path: null,
        };
      }
    },
    'workbench/delete-dynamic-profile': async ({ basename }) => {
      try {
        await workbench.dynamicProfileWatcher.deleteFile(basename);
        return { ok: true, error: null };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'workbench/register-rpc': async (spec) => {
      try {
        await orchestrator.registerRpc(spec);
        return { ok: true, error: null, registrationId: spec.id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          registrationId: null,
        };
      }
    },
    'workbench/unregister-rpc': async ({ id }) => {
      try {
        await orchestrator.unregisterRpc(id);
        return { ok: true, error: null };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'workbench/registrations': async () => monitor.registrations.snapshot(),
    'workbench/subscribe-custom-escape': async ({ sessionId, identity }) => {
      try {
        const id = `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await orchestrator.subscribeCustomEscape(id, sessionId, identity);
        return { ok: true, error: null, subscriptionId: id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          subscriptionId: null,
        };
      }
    },
    'workbench/unsubscribe-custom-escape': async ({ subscriptionId }) => {
      try {
        await orchestrator.unsubscribeCustomEscape(subscriptionId);
        return { ok: true, error: null };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'workbench/custom-escape': async () => monitor.customEscape.snapshot(),
  };

  ipcMain.handle('rpc', async (_event, payload: { method: RpcMethod; args: unknown }) => {
    const handler = handlers[payload.method] as (a: unknown) => Promise<unknown>;
    try {
      return await handler(payload.args);
    } catch (err) {
      throw new Error(
        `[rpc:${payload.method}] ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
      );
    }
  });
}

export function broadcast<K extends EventKind>(kind: K, payload: EventPayload<K>): void {
  const channel = `event:${String(kind)}`;
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }
}

export type { WebContents };
