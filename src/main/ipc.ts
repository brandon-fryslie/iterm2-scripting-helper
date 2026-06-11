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
  ActionResult,
} from '@shared/rpc';
import type { ConnectionStore } from './stores/ConnectionStore';
import type { LayoutStore } from './stores/LayoutStore';
import type { VariableStore } from './stores/VariableStore';
import type { WatchlistStore } from './stores/WatchlistStore';
import { type AppEventLog } from './stores/AppEventLog';
import type { AppEntityRef, AppActionKind } from '@shared/domain';
import type { ScreenStreamStore } from './stores/ScreenStreamStore';
import type { DynamicProfileStore } from './stores/DynamicProfileStore';
import { registrationSnapshot, type RegistrationStore } from './stores/RegistrationStore';
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
import { listProfiles } from './workbench';

type Handlers = { [M in RpcMethod]: (args: RpcArgs<M>) => Promise<RpcResult<M>> };

export interface MonitorStoresRef {
  layout: LayoutStore;
  variables: VariableStore;
  watchlist: WatchlistStore;
  appEvents: AppEventLog;
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
  // [LAW:single-enforcer] The one place a fired action joins the spine. Every action handler runs its
  // protocol request through here, so the rule "firing an action appends one 'action' event scoped to
  // the focused entity" is enforced once, not re-implemented per action. The entity is the value the
  // renderer fired against; the override (if any) rides along inside `rest` as action-local data.
  const action =
    <A extends { entity: AppEntityRef }>(
      kind: AppActionKind,
      run: (args: A) => Promise<ActionResult>,
    ) =>
    async (args: A): Promise<ActionResult> => {
      const result = await run(args);
      const { entity, ...rest } = args;
      monitor.appEvents.append({
        kind: 'action',
        at: Date.now(),
        entity,
        causedBy: null,
        payload: { action: kind, args: rest, result },
      });
      return result;
    };

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
      // [LAW:one-source-of-truth] Explicit list-sessions refreshes the monitor layout authority.
      monitor.layout.apply(layout);
      return {
        windows: layout.windows,
        buriedSessions: layout.buriedSessions,
      };
    },

    'monitor/layout': async () => {
      await orchestrator.refreshLayout();
      return monitor.layout.snapshot();
    },
    'monitor/variables': async () => monitor.variables.snapshot(),
    // The whole spine, for the unified activity timeline and provenance walking. The per-domain
    // wire/notification/action panes that used to be separate projections are gone; the timeline
    // reads this one snapshot and filters it.
    'monitor/events': async () => monitor.appEvents.snapshot(),
    'monitor/focus-session': async ({ sessionId }) => {
      await orchestrator.setFocusedSession(sessionId);
      return { focusedSessionId: monitor.variables.focusedSessionId };
    },
    'monitor/focus-variables': async ({ entity }) => {
      await orchestrator.setFocusedVariables(entity);
      return monitor.variables.snapshot();
    },
    'monitor/probe-variable': async ({ entity, expression }) =>
      orchestrator.probeVariable(entity, expression),
    'monitor/watchlist': async () => monitor.watchlist.snapshot(),
    'monitor/set-watched': async ({ name, watched }) => {
      await orchestrator.setWatched(name, watched);
      return monitor.watchlist.snapshot();
    },
    'monitor/screen': async () => monitor.screen.snapshot(),
    'actions/send-text': action('send-text', (args) => actionSendText(orchestrator, args)),
    'actions/inject': action('inject', (args) => actionInject(orchestrator, args)),
    'actions/activate': action('activate', (args) => actionActivate(orchestrator, args)),
    'actions/menu-item': action('menu-item', (args) => actionMenuItem(orchestrator, args)),
    'actions/invoke-function': action('invoke-function', (args) =>
      actionInvokeFunction(orchestrator, args),
    ),
    'actions/restart-session': action('restart-session', (args) =>
      actionRestartSession(orchestrator, args),
    ),
    'actions/close': action('close', (args) => actionClose(orchestrator, args)),
    'actions/raw-protobuf': action('raw-protobuf', (args) =>
      actionRawProtobuf(orchestrator, args),
    ),
    'workbench/list-profiles': () => listProfiles(orchestrator),
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
    // [LAW:decomposition] The one dispatch on the registration union, at the boundary where the
    // renderer's value enters: each role family routes to its own closed orchestrator method.
    'workbench/register-rpc': async (spec) => {
      try {
        if (spec.role === 'toolbelt') {
          await orchestrator.registerTool(spec);
        } else {
          await orchestrator.registerRpc(spec);
        }
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
        const spec = monitor.registrations.get(id);
        if (spec?.role === 'toolbelt') {
          // The iTerm2 API has no unregister-tool message: a tool persists in iTerm2 until
          // restart, so forgetting one is a pure registry removal with no wire effect.
          monitor.registrations.remove(id);
        } else if (spec) {
          await orchestrator.unregisterRpc(spec);
        }
        return { ok: true, error: null };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'workbench/registrations': async () =>
      registrationSnapshot(monitor.registrations, monitor.appEvents),
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
