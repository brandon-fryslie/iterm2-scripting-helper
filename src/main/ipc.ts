import { ipcMain, dialog, webContents, type WebContents } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
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
import { applyFixtureNdjson, buildFixtureNdjson } from './fixture';
import { buildPythonStub, pythonStubFileName } from '@shared/pythonStub';
import type { DynamicProfileWatcher } from './drivers/DynamicProfileWatcher';
import {
  actionSendText,
  actionInject,
  actionActivate,
  actionMenuItem,
  actionInvokeFunction,
  actionRestartSession,
  actionClose,
  actionSavedArrangement,
  actionSetBroadcastDomains,
  actionGetSelection,
  actionSetSelection,
  actionTransaction,
  actionRawProtobuf,
  actionTmuxSendCommand,
  actionTmuxCreateWindow,
  actionTmuxSetWindowVisible,
  actionGetPreference,
  actionApplyColorPreset,
} from './actions';
import { actionOsascript, getSdefText } from './osascript';
import { listProfiles } from './workbench';
import { arrangementSnapshot } from './arrangements';
import { getBroadcastDomains } from './broadcastDomains';
import { readKeyBindingsSnapshot } from './keyBindings';
import { listTmuxConnections } from './tmux';
import { listColorPresets } from './colorPresets';

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
    // [LAW:effects-at-boundaries] The capture/replay logic is pure (src/main/fixture.ts); this handler
    // is the one place the file picker and disk IO live. An explicit path skips the dialog (automation
    // and e2e); absent, the native dialog runs and a user cancel is the honest no-op `{ ok: false,
    // error: null }`, distinct from a write/read failure (`error` a string).
    'fixture/capture': async ({ span, path: explicitPath }) => {
      const { ndjson, eventCount } = buildFixtureNdjson(monitor.appEvents, span ?? null, Date.now());
      const target = await resolveFilePath(explicitPath, {
        mode: 'save',
        title: 'Save wire-log fixture',
        ...FIXTURE_FILE,
      });
      if (!target) return { ok: false, error: null };
      try {
        await writeFile(target, ndjson, 'utf8');
        return { ok: true, path: target, eventCount };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'fixture/replay': async ({ path: explicitPath }) => {
      const target = await resolveFilePath(explicitPath, {
        mode: 'open',
        title: 'Replay wire-log fixture',
        ...FIXTURE_FILE,
      });
      if (!target) return { ok: false, error: null };
      let ndjson: string;
      try {
        ndjson = await readFile(target, 'utf8');
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // The connection state is the single authority on whether replay is allowed; the guard lives in
      // the pure core so its rule is unit-tested, not re-implemented at the boundary.
      const result = applyFixtureNdjson(monitor.appEvents, ndjson, store.state);
      return result.ok ? { ok: true, path: target, eventCount: result.eventCount } : result;
    },
    // [LAW:effects-at-boundaries] Code generation is pure (shared/pythonStub.ts); this handler only
    // resolves the destination and writes. The save dialog shares the one file-picker seam below,
    // defaulting to a .py named after the function so the file lands runnable in the Scripts folder.
    'registration/export-python': async ({ body, path: explicitPath }) => {
      // [LAW:no-silent-failure] Code generation can reject malformed authoring (e.g. an invalid
      // response template) by throwing; that becomes a returned error, never a silently-degraded stub.
      let source: string;
      try {
        source = buildPythonStub(body);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      const target = await resolveFilePath(explicitPath, {
        mode: 'save',
        title: 'Export Python stub',
        defaultName: pythonStubFileName(body),
        filterName: 'Python',
        extensions: ['py'],
      });
      if (!target) return { ok: false, error: null };
      try {
        await writeFile(target, source, 'utf8');
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
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
    'actions/saved-arrangement': action('saved-arrangement', (args) =>
      actionSavedArrangement(orchestrator, args),
    ),
    'actions/set-broadcast-domains': action('set-broadcast-domains', (args) =>
      actionSetBroadcastDomains(orchestrator, args),
    ),
    'actions/get-selection': action('get-selection', (args) =>
      actionGetSelection(orchestrator, args),
    ),
    'actions/set-selection': action('set-selection', (args) =>
      actionSetSelection(orchestrator, args),
    ),
    'actions/transaction': action('transaction', (args) =>
      actionTransaction(orchestrator, args),
    ),
    'actions/osascript': action('osascript', (args) => actionOsascript(args)),
    'actions/raw-protobuf': action('raw-protobuf', (args) =>
      actionRawProtobuf(orchestrator, args),
    ),
    'actions/tmux-send-command': action('tmux-send-command', (args) =>
      actionTmuxSendCommand(orchestrator, args),
    ),
    'actions/tmux-create-window': action('tmux-create-window', (args) =>
      actionTmuxCreateWindow(orchestrator, args),
    ),
    'actions/tmux-set-window-visible': action('tmux-set-window-visible', (args) =>
      actionTmuxSetWindowVisible(orchestrator, args),
    ),
    'actions/get-preference': action('get-preference', (args) =>
      actionGetPreference(orchestrator, args),
    ),
    'actions/apply-color-preset': action('apply-color-preset', (args) =>
      actionApplyColorPreset(orchestrator, args),
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
    'workbench/arrangements': async () => arrangementSnapshot(orchestrator),
    'workbench/broadcast-domains': async () => getBroadcastDomains(orchestrator),
    'workbench/key-bindings': async () => readKeyBindingsSnapshot(),
    'workbench/sdef-text': async () => getSdefText(),
    'workbench/tmux-connections': async () => listTmuxConnections(orchestrator),
    'workbench/color-presets': async () => listColorPresets(orchestrator),
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

// The NDJSON specifics for the capture/replay dialogs — one spec reused by both so the file kind lives
// in a single place.
const FIXTURE_FILE = {
  defaultName: 'wire-log.ndjson',
  filterName: 'NDJSON',
  extensions: ['ndjson'],
} as const;

interface FileDialogSpec {
  mode: 'save' | 'open';
  title: string;
  defaultName: string;
  filterName: string;
  extensions: readonly string[];
}

// [LAW:effects-at-boundaries] [LAW:single-enforcer] The one place a native file picker lives, so every
// file export/import shares one cancel convention: an explicit path skips the dialog (for automation/
// e2e); absent, the native dialog runs and a user cancel returns null — the handler's honest
// `{ ok: false, error: null }` no-op, never confused with a write/read failure. The file kind (title,
// default name, extension filter) is a value the caller supplies, not baked into this seam.
async function resolveFilePath(
  explicit: string | null | undefined,
  spec: FileDialogSpec,
): Promise<string | null> {
  if (explicit) return explicit;
  const filters = [{ name: spec.filterName, extensions: [...spec.extensions] }];
  if (spec.mode === 'save') {
    const res = await dialog.showSaveDialog({
      title: spec.title,
      defaultPath: spec.defaultName,
      filters,
    });
    return res.canceled || !res.filePath ? null : res.filePath;
  }
  const res = await dialog.showOpenDialog({
    title: spec.title,
    properties: ['openFile'],
    filters,
  });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

export function broadcast<K extends EventKind>(kind: K, payload: EventPayload<K>): void {
  const channel = `event:${String(kind)}`;
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }
}

export type { WebContents };
