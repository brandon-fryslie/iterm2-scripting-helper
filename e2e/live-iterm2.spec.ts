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

  test('Console: send text + activate + snippet re-fires', async () => {
    const app = await electron.launch({ args: [mainEntry], cwd: repoRoot });
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    await win.getByTestId('connect-button').click();
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

    // Grab a real sessionId and a real tabId via the main-side snapshot
    const probe = await win.evaluate(async () => {
      const layout = await window.ipc.invoke('monitor/layout', undefined as never);
      const w = layout.windows[0];
      const t = w?.tabs[0];
      const s = t?.sessions[0];
      return { sessionId: s?.sessionId ?? '', tabId: t?.tabId ?? '' };
    });
    expect(probe.sessionId).not.toBe('');
    expect(probe.tabId).not.toBe('');

    await win.getByTestId('tab-trigger-console').click();

    // Send text — fire without text (safe no-op on shell); asserts RPC succeeds.
    await win.getByTestId('action-send-text').click();
    await win
      .getByTestId('send-text-session-input')
      .fill(probe.sessionId);
    await win.getByTestId('send-text-input').fill('');
    await win.getByTestId('action-fire').click();
    await expect(
      win.locator('[data-testid^="transcript-"]').first(),
    ).toHaveAttribute('data-ok', 'true', { timeout: 10_000 });

    // Activate a real tab
    await win.getByTestId('action-activate').click();
    await win.getByTestId('activate-id-input').fill(probe.tabId);
    await win.getByTestId('action-fire').click();
    const firstEntry = win.locator('[data-testid^="transcript-"]').first();
    await expect(firstEntry).toHaveAttribute('data-ok', 'true', { timeout: 10_000 });

    // Save as snippet + re-fire
    const beforeSnippet = await win.locator('[data-testid^="transcript-"]').count();
    await win.getByTestId('snippet-name').fill('activate-head-tab');
    await win.getByTestId('snippet-save').click();
    const snippet = win.locator('[data-testid^="snippet-snip-"]').first();
    await expect(snippet).toBeVisible();
    await snippet.locator('[data-testid^="snippet-fire-"]').click();

    await expect(win.locator('[data-testid^="transcript-"]')).toHaveCount(
      beforeSnippet + 1,
      { timeout: 10_000 },
    );

    await app.close();
  });

  test('Monitor: screen renders + keystrokes + prompts panes populate', async () => {
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
    await expect(win.getByTestId('keystrokes-pane')).toBeVisible();
    await expect(win.getByTestId('prompts-pane')).toBeVisible();
    await expect(win.getByTestId('focus-pane')).toBeVisible();

    const firstSession = win.locator('[data-testid^="layout-session-"]').first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();

    await expect(win.getByTestId('screen-body')).toBeVisible({ timeout: 15_000 });
    const bodyLines = win.locator('[data-testid="screen-body"] > div');
    await expect(bodyLines.first()).toBeVisible({ timeout: 10_000 });

    await app.close();
  });
});
