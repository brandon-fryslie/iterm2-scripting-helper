import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

test('four-tab shell renders placeholders and IPC ping round-trips', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  for (const id of ['monitor', 'workbench', 'console', 'settings']) {
    await win.getByTestId(`tab-trigger-${id}`).click();
    await expect(win.getByTestId(`tab-${id}-placeholder`)).toBeVisible();
  }

  await expect(win.getByTestId('ping-result')).toContainText(/"ok":\s*true/);

  await app.close();
});
