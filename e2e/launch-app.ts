import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..');

const mainEntry = path.join(repoRoot, '.vite/build/main.js');
const ensureElectronInstallScript = path.join(
  repoRoot,
  'scripts/ensure-electron-install.cjs',
);
const playwrightElectronLoader = path.join(
  path.dirname(require.resolve('playwright-core/package.json')),
  'lib/server/electron/loader.js',
);

export function launchApp() {
  const executablePath = resolveElectronExecutablePath();

  return electron.launch({
    executablePath,
    args: ['-r', playwrightElectronLoader, mainEntry],
    cwd: repoRoot,
  });
}

function resolveElectronExecutablePath(): string {
  const configured = process.env.ELECTRON_EXECUTABLE_PATH;
  if (configured) return configured;

  // [LAW:single-enforcer] Electron binary repair stays owned by the verifier script.
  return execFileSync(process.execPath, [ensureElectronInstallScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}
