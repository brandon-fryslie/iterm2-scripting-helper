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
import { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

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

const orchestrator = new ConnectionOrchestrator(
  connectionStore,
  {
    layout: layoutStore,
    variables: variableStore,
    wire: wireLogStore,
    notifications: notificationHub,
  },
  {
    advisoryName: 'iTerm2 Scripting Workbench',
    libraryVersion: `node ${app.getVersion()}`,
  },
);

orchestrator.on('frame', (frame) => {
  broadcast('wire-frame', {
    direction: frame.direction,
    size: frame.bytes.byteLength,
    at: frame.at,
  });
});

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
  broadcast('wire-snapshot', wireLogStore.snapshot());
});

autorun(() => {
  broadcast('notifications-snapshot', notificationHub.snapshot());
});

app.whenReady().then(() => {
  registerIpc(connectionStore, orchestrator, {
    layout: layoutStore,
    variables: variableStore,
    wire: wireLogStore,
    notifications: notificationHub,
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await orchestrator.disconnect().catch(() => void 0);
  if (process.platform !== 'darwin') app.quit();
});
