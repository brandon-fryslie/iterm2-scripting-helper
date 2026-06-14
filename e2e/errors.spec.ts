import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

// 449.4.4: a driver failure is a first-class event — it raises a toast and lands in the durable Errors
// pane, with no silent catch. The deterministic trigger is a connect with no iTerm2 present: the driver
// lands in 'error'. If a live iTerm2 answers the connect (so it goes 'ready'), the failure path can't
// be exercised and the test skips — the same conditional shape the replay refusal spec uses.
test('a driver failure raises a toast and is recorded in the durable Errors pane', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('entity-workspace')).toBeVisible();

  // Drive the connection from the UI. With no iTerm2 the connect resolves to 'error'; with one it
  // resolves live, in which case there is no failure to assert and we skip.
  const state = await win.evaluate(
    async () => (await window.ipc.invoke('connection/connect', undefined as never)).state,
  );
  test.skip(
    state !== 'error',
    'a live iTerm2 answered the connect; no driver failure to surface',
  );

  // The failure surfaced as a toast on the always-on layer, toned as an error.
  const errorToast = win.locator('[data-testid^="toast-"][data-tone="error"][data-source="driver"]');
  await expect(errorToast.first()).toBeVisible({ timeout: 10_000 });

  // And it is durable: the Errors pane in Settings lists it after the transient toast is gone.
  await win.getByTestId('settings-gear').click();
  const panel = win.getByTestId('settings-errors-panel');
  await expect(panel).toBeVisible();
  const rows = panel.locator('[data-testid^="error-row-"]');
  await expect(rows.first()).toBeVisible();

  // Clear empties the durable record.
  await win.getByTestId('settings-errors-clear').click();
  await expect(rows).toHaveCount(0);

  await app.close();
});
