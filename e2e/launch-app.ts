import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..');

const mainEntry = path.join(repoRoot, '.vite/build/main.js');
const ensureElectronInstallScript = path.join(
  repoRoot,
  'scripts/ensure-electron-install.cjs',
);

export function launchApp() {
  const executablePath = resolveElectronExecutablePath();

  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [mainEntry],
    cwd: repoRoot,
  });
}

function resolveElectronExecutablePath(): string | null {
  const configured = process.env.ELECTRON_EXECUTABLE_PATH;
  if (configured) return configured;

  // [LAW:single-enforcer] Electron binary repair stays owned by the verifier script.
  execFileSync(process.execPath, [ensureElectronInstallScript], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  return null;
}
