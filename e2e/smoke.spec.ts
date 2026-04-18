import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const mainEntry = path.join(repoRoot, '.vite/build/main.js');

test('four-tab shell renders placeholders and IPC ping round-trips', async () => {
  const app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
  });
  const win = await app.firstWindow();

  for (const id of ['monitor', 'workbench', 'console', 'settings']) {
    await win.getByTestId(`tab-trigger-${id}`).click();
    await expect(win.getByTestId(`tab-${id}-placeholder`)).toBeVisible();
  }

  await expect(win.getByTestId('ping-result')).toContainText(/"ok":\s*true/);

  await app.close();
});
