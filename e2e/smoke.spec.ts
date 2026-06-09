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
