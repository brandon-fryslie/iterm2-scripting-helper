import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { autorun } from 'mobx';
import started from 'electron-squirrel-startup';
import { registerIpc, broadcast } from './ipc';
import { ConnectionStore } from './stores/ConnectionStore';
import { LayoutStore } from './stores/LayoutStore';
import { VariableStore } from './stores/VariableStore';
import { WireLogStore } from './stores/WireLogStore';
import { NotificationHub } from './stores/NotificationHub';
import { KeystrokeLogStore } from './stores/KeystrokeLogStore';
import { PromptLogStore } from './stores/PromptLogStore';
import { FocusLogStore } from './stores/FocusLogStore';
import { ScreenStreamStore } from './stores/ScreenStreamStore';
import { DynamicProfileStore } from './stores/DynamicProfileStore';
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';
import { DynamicProfileWatcher } from './drivers/DynamicProfileWatcher';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) {
  app.quit();
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
const variableStore = new VariableStore();
const wireLogStore = new WireLogStore();
const notificationHub = new NotificationHub();
const keystrokeLogStore = new KeystrokeLogStore();
const promptLogStore = new PromptLogStore();
const focusLogStore = new FocusLogStore();
const screenStreamStore = new ScreenStreamStore();
const dynamicProfileStore = new DynamicProfileStore();

const monitorStores = {
  layout: layoutStore,
  variables: variableStore,
  wire: wireLogStore,
  notifications: notificationHub,
  keystrokes: keystrokeLogStore,
  prompts: promptLogStore,
  focus: focusLogStore,
  screen: screenStreamStore,
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
  broadcast('screen-snapshot', screenStreamStore.snapshot());
});

autorun(() => {
  broadcast('dynamic-profiles-snapshot', dynamicProfileStore.snapshot());
});

// Keystrokes, prompts, notifications, wire, focus are pulled on demand via
// monitor/* RPCs. Their ring buffers can mutate tens of times per second
// under load and the IPC channel doesn't handle firehose broadcasts well.
// A post-MVP heartbeat-based delta push will replace this polling story.

app.whenReady().then(() => {
  registerIpc(connectionStore, orchestrator, monitorStores, {
    dynamicProfiles: dynamicProfileStore,
    dynamicProfileWatcher,
  });
  void dynamicProfileWatcher.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await orchestrator.disconnect().catch(() => void 0);
  await dynamicProfileWatcher.stop().catch(() => void 0);
  if (process.platform !== 'darwin') app.quit();
});
