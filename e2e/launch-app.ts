import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  // [LAW:no-ambient-temporal-coupling] Each launch owns a fresh, isolated userData directory so
  // persisted state (the active lens, region sizes) cannot leak between tests or across runs. Without
  // this seam a test's lens switch would be restored by the next launch, and the "launches on the
  // Inspect default" assertion would depend on execution order — a fresh profile is the only honest
  // way to assert what a fresh launch does.
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'iterm2-helper-e2e-'));

  return electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`, '-r', playwrightElectronLoader, mainEntry],
    cwd: repoRoot,
    // Tests must never steal foreground focus from whatever the user is doing.
    env: { ...process.env, WORKBENCH_BACKGROUND: '1' },
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
