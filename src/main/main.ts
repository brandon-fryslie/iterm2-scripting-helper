import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { autorun } from 'mobx';
import started from 'electron-squirrel-startup';
import { autoUpdater } from 'electron-updater';
import { resolveUpdaterConfig } from './updaterConfig';
import { registerIpc, broadcast } from './ipc';
import { ConnectionStore } from './stores/ConnectionStore';
import { LayoutStore } from './stores/LayoutStore';
import { VariableStore } from './stores/VariableStore';
import { WatchlistStore } from './stores/WatchlistStore';
import { AppEventLog } from './stores/AppEventLog';
import { ScreenStreamStore } from './stores/ScreenStreamStore';
import { PromptStore } from './stores/PromptStore';
import { DynamicProfileStore } from './stores/DynamicProfileStore';
import { RegistrationStore, registrationSnapshot } from './stores/RegistrationStore';
import { CustomEscapeStore } from './stores/CustomEscapeStore';
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';
import { DynamicProfileWatcher } from './drivers/DynamicProfileWatcher';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
// Baked at make time by vite.main.config.mts; empty string when no feed URL was configured.
declare const WORKBENCH_UPDATE_FEED_URL: string;

// Start checking the static update feed, but only when this build is packaged and carries a
// feed URL — electron-updater throws outside a packaged app, and a URL-less build has nothing
// to check. The decision is pure; this boundary performs the effect. [LAW:effects-at-boundaries]
function startAutoUpdater(): void {
  const decision = resolveUpdaterConfig({
    isPackaged: app.isPackaged,
    feedUrl: WORKBENCH_UPDATE_FEED_URL,
  });
  if (decision.kind === 'disabled') {
    console.log(`[updater] disabled: ${decision.reason}`);
    return;
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: decision.feedUrl });
  console.log(`[updater] checking ${decision.feedUrl} for updates`);
  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    console.error('[updater] update check failed:', err);
  });
}

if (started) {
  app.quit();
}

// [LAW:effects-at-boundaries] Putting a window on the user's screen is a side effect on their
// desktop. The e2e launcher declares background intent as a value at the process boundary; this
// is the one place that honors it — the window is never shown at all (Playwright drives it via
// CDP, which needs neither focus nor an on-screen window; throttling is disabled so the hidden
// renderer still paints and lays out).
const runInBackground = process.env.WORKBENCH_BACKGROUND === '1';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !runInBackground,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !runInBackground,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

const connectionStore = new ConnectionStore();
const layoutStore = new LayoutStore();
const appEventLog = new AppEventLog();
const variableStore = new VariableStore(appEventLog);
const watchlistStore = new WatchlistStore();
const screenStreamStore = new ScreenStreamStore();
const promptStore = new PromptStore();
const dynamicProfileStore = new DynamicProfileStore();
const registrationStore = new RegistrationStore();
const customEscapeStore = new CustomEscapeStore();

const monitorStores = {
  layout: layoutStore,
  variables: variableStore,
  watchlist: watchlistStore,
  appEvents: appEventLog,
  screen: screenStreamStore,
  prompt: promptStore,
  registrations: registrationStore,
  customEscape: customEscapeStore,
};

const orchestrator = new ConnectionOrchestrator(
  connectionStore,
  monitorStores,
  {
    advisoryName: 'iTerm2 Scripting Workbench',
    libraryVersion: `node ${app.getVersion()}`,
  },
);

orchestrator.on('error', (err: unknown) => {
  connectionStore.setError(err instanceof Error ? err.message : String(err));
});

const dynamicProfileWatcher = new DynamicProfileWatcher(dynamicProfileStore);

autorun(() => {
  broadcast('connection-state', connectionStore.snapshot());
});

autorun(() => {
  broadcast('layout-snapshot', layoutStore.snapshot());
});

autorun(() => {
  broadcast('variables-snapshot', variableStore.snapshot());
});

autorun(() => {
  broadcast('watchlist-snapshot', watchlistStore.snapshot());
});

autorun(() => {
  broadcast('screen-snapshot', screenStreamStore.snapshot());
});

autorun(() => {
  broadcast('prompt-snapshot', promptStore.snapshot());
});

autorun(() => {
  broadcast('dynamic-profiles-snapshot', dynamicProfileStore.snapshot());
});

// The registrations snapshot is built by the single shared builder. Two triggers, no shared mutable
// mirror: the autorun re-broadcasts when a spec changes (observable), and the orchestrator's
// 'invocation' event re-broadcasts when a new invocation lands on the spine (not a MobX observable).
autorun(() => {
  broadcast('registrations-snapshot', registrationSnapshot(registrationStore, appEventLog));
});

orchestrator.on('invocation', () => {
  broadcast('registrations-snapshot', registrationSnapshot(registrationStore, appEventLog));
});

autorun(() => {
  broadcast('custom-escape-snapshot', customEscapeStore.snapshot());
});

// The event spine is pulled on demand via monitor/events (the activity timeline polls it). It can
// mutate tens of times per second under load and the IPC channel doesn't handle firehose broadcasts
// well. A post-MVP heartbeat-based delta push will replace this polling story.

app.whenReady().then(() => {
  if (runInBackground && process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }
  registerIpc(connectionStore, orchestrator, monitorStores, {
    dynamicProfiles: dynamicProfileStore,
    dynamicProfileWatcher,
  });
  void dynamicProfileWatcher.start();
  createWindow();
  startAutoUpdater();

  void orchestrator.connect().catch(() => { /* error recorded on store */ });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await orchestrator.disconnect().catch(() => void 0);
  await dynamicProfileWatcher.stop().catch(() => void 0);
  if (process.platform !== 'darwin') app.quit();
});
