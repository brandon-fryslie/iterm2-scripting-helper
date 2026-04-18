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

test.describe('live iTerm2', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.ITERM2_INTEGRATION !== '1',
      'opt-in: re-run with ITERM2_INTEGRATION=1 and iTerm2 open',
    );
    test.skip(!existsSync(socketPath), `iTerm2 socket missing at ${socketPath}`);
  });

  test('Settings: negotiates cookie + connects + list-sessions', async () => {
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

  test('Monitor: layout + variables + wire + notifications cross-link on focus', async () => {
    const app = await electron.launch({ args: [mainEntry], cwd: repoRoot });
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    await win.getByTestId('connect-button').click();
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

    await win.getByTestId('tab-trigger-monitor').click();
    await expect(win.getByTestId('layout-pane')).toBeVisible();
    await expect(win.getByTestId('wire-pane')).toBeVisible();
    await expect(win.getByTestId('variables-pane')).toBeVisible();
    await expect(win.getByTestId('notifications-pane')).toBeVisible();

    const firstSession = win.locator('[data-testid^="layout-session-"]').first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();

    await expect(firstSession).toHaveAttribute('data-focused', 'true');
    await expect(
      win.locator('[data-testid^="variable-hostname"]'),
    ).toBeVisible({ timeout: 10_000 });

    await app.close();
  });
});
