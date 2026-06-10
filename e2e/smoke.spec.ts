import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

test('Entity Workspace renders co-present facets and IPC ping round-trips', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // One panel, not a bag of tabs: the entity rail and the observe/act/author facets are all
  // co-present, no destination to switch to.
  await expect(win.getByTestId('entity-workspace')).toBeVisible();
  await expect(win.getByTestId('entity-spine-rail')).toBeVisible();
  await expect(win.getByTestId('facet-live')).toBeVisible();
  await expect(win.getByTestId('facet-activity')).toBeVisible();
  await expect(win.getByTestId('facet-act')).toBeVisible();
  await expect(win.getByTestId('facet-author')).toBeVisible();

  // Settings is a utility affordance reached from the rail's gear, not a peer tab.
  await win.getByTestId('settings-gear').click();
  await expect(win.getByTestId('settings-overlay')).toBeVisible();
  await expect(win.getByTestId('ping-result')).toContainText(/"ok":\s*true/);
  await win.getByTestId('settings-close').click();
  await expect(win.getByTestId('settings-overlay')).not.toBeVisible();

  await app.close();
});

test('snippet re-fire crosses IPC and lands on the Activity spine without a connection', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // Regression for iterm2-e2e-fly: a saved snippet's args lived inside a deeply-observable MobX
  // array, so the re-fire sent Proxies that Electron's structured clone rejected — the action died
  // before reaching the main process and never joined the spine. No live iTerm2 is needed to cover
  // that seam: a disconnected fire still appends a (failed) action event to the spine.
  await win.getByTestId('action-activate').click();
  await win.getByTestId('activate-id-input').fill('t1');
  await win.getByTestId('snippet-name').fill('clone-safety probe');
  await win.getByTestId('snippet-save').click();
  const snippet = win.locator('[data-testid^="snippet-snip-"]').first();
  await expect(snippet).toBeVisible();
  await snippet.locator('[data-testid^="snippet-fire-"]').click();

  // The event reaching the spine is the contract under test, not the action's success — with no
  // connection the result is a loud ✗, which is exactly the honest shape.
  const actionRows = win.locator('[data-testid^="activity-row-"][data-facet="action"]');
  await expect(actionRows).toHaveCount(1, { timeout: 10_000 });

  await app.close();
});
