import { _electron as electron } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..');

const mainEntry = path.join(repoRoot, '.vite/build/main.js');
const executablePathFile = path.join(repoRoot, '.electron-executable-path');

export function launchApp() {
  const executablePath =
    process.env.ELECTRON_EXECUTABLE_PATH ||
    (existsSync(executablePathFile)
      ? readFileSync(executablePathFile, 'utf8').trim()
      : null);

  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [mainEntry],
    cwd: repoRoot,
  });
}
