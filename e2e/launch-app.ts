import { _electron as electron } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..');

const mainEntry = path.join(repoRoot, '.vite/build/main.js');
const executablePathFile = path.join(repoRoot, '.electron-executable-path');
const ensureElectronInstallScript = path.join(
  repoRoot,
  'scripts/ensure-electron-install.cjs',
);

export function launchApp() {
  const executablePath = resolveElectronExecutablePath();

  return electron.launch({
    executablePath,
    args: [mainEntry],
    cwd: repoRoot,
  });
}

function resolveElectronExecutablePath(): string {
  const configured = process.env.ELECTRON_EXECUTABLE_PATH;
  if (configured) return configured;

  if (existsSync(executablePathFile)) {
    const recorded = readFileSync(executablePathFile, 'utf8').trim();
    if (recorded) return recorded;
  }

  // [LAW:single-enforcer] Electron binary repair stays owned by the verifier script.
  return execFileSync(process.execPath, [ensureElectronInstallScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}
