import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';

const repoRoot = path.resolve(__dirname, '..');
const mainEntry = path.join(repoRoot, '.vite/build/main.js');
const socketPath = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

test('negotiates cookie + connects + list-sessions against live iTerm2', async () => {
  test.skip(
    process.env.ITERM2_INTEGRATION !== '1',
    'opt-in: re-run with ITERM2_INTEGRATION=1 and iTerm2 open',
  );
  test.skip(!existsSync(socketPath), `iTerm2 socket missing at ${socketPath}`);

  const app = await electron.launch({ args: [mainEntry], cwd: repoRoot });
  const win = await app.firstWindow();

  await win.getByTestId('tab-trigger-settings').click();
  await win.getByTestId('connect-button').click();

  await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 20_000 },
  );
  await expect(win.getByTestId('protocol-version')).not.toHaveText('(n/a)');
  await expect(win.getByTestId('capability-table')).toBeVisible();

  await win.getByTestId('list-sessions-button').click();
  await expect(win.getByTestId('list-sessions-summary')).toContainText(
    /\d+ window\(s\)/,
  );

  await app.close();
});
