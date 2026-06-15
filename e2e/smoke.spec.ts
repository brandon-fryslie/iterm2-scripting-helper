import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

test('Entity Workspace renders co-present facets and IPC ping round-trips', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // One panel, not a bag of tabs: the entity rail and the screen/variables/activity/act/author facets
  // are all co-present by default, no destination to switch to.
  await expect(win.getByTestId('entity-workspace')).toBeVisible();
  await expect(win.getByTestId('entity-spine-rail')).toBeVisible();
  await expect(win.getByTestId('facet-screen')).toBeVisible();
  await expect(win.getByTestId('facet-variables')).toBeVisible();
  await expect(win.getByTestId('facet-activity')).toBeVisible();
  await expect(win.getByTestId('facet-act')).toBeVisible();
  await expect(win.getByTestId('facet-author')).toBeVisible();

  // The Panels bar hides and shows each facet on demand: hiding Variables removes that pane and
  // leaves the rest standing; toggling it back restores it.
  await win.getByTestId('facet-toggle-variables').click();
  await expect(win.getByTestId('facet-variables')).toHaveCount(0);
  await expect(win.getByTestId('facet-screen')).toBeVisible();
  await win.getByTestId('facet-toggle-variables').click();
  await expect(win.getByTestId('facet-variables')).toBeVisible();

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

test('dynamic profile editor surfaces JSON, shape, and parent-resolution states live', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // Everything asserted here derives from the buffer alone via the shared analyzer — typing is
  // enough; nothing is saved, so the user's real DynamicProfiles folder is never touched.
  await win.getByTestId('workbench-rail-dynamic-profile').click();
  const body = win.getByTestId('dynamic-profile-editor-body');

  await body.fill('{ "Profiles": [ broken');
  await expect(win.getByTestId('dynamic-analysis-json-error')).toBeVisible();
  // A malformed buffer may not be written: that is what would make iTerm2 ignore the folder.
  await expect(win.getByTestId('dynamic-profile-save')).toBeDisabled();

  await body.fill('{ "NotProfiles": [] }');
  await expect(win.getByTestId('dynamic-analysis-shape-error')).toBeVisible();
  await expect(win.getByTestId('dynamic-profile-save')).toBeEnabled();

  await body.fill(
    '{ "Profiles": [ { "Name": "No Guid", "Dynamic Profile Parent Name": "No Such Parent" } ] }',
  );
  const entry = win.getByTestId('dynamic-profile-entry-0');
  await expect(entry).toContainText('missing required "Guid"');
  await expect(win.getByTestId('parent-fallback')).toContainText('default profile');

  // A parent pointing at a sibling in the same buffer resolves without any disk round-trip.
  await body.fill(
    '{ "Profiles": [ { "Guid": "p1", "Name": "Parent" }, ' +
      '{ "Guid": "c1", "Name": "Child", "Dynamic Profile Parent Name": "Parent" } ] }',
  );
  await expect(win.getByTestId('parent-resolved')).toContainText('Parent');

  await app.close();
});

test('escape editor previews incomplete input as an error and copies a built sequence offline', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  await win.getByTestId('workbench-rail-escape-sequence').click();

  // A template missing a required field is an error *value* in the preview, never a crash, and
  // emit/copy stay disabled until the sequence exists.
  await win.getByTestId('escape-template-select').click();
  await win.getByTestId('escape-template-osc1337-current-dir').click();
  await expect(win.getByTestId('escape-build-error')).toContainText(
    'missing required field: path',
  );
  await expect(win.getByTestId('escape-copy')).toBeDisabled();

  await win.getByTestId('escape-field-path').fill('/tmp');
  await expect(win.getByTestId('escape-sequence-readable')).toContainText('CurrentDir=/tmp');

  // The clipboard half of the acceptance needs no iTerm2 connection at all.
  await win.getByTestId('escape-copy').click();
  await expect(win.getByTestId('escape-copied')).toBeVisible();
  const clipboard = await win.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe('\x1b]1337;CurrentDir=/tmp\x1b\\');

  await app.close();
});

test('docs index deep-links the OSC catalog to the matching escape template editor', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // The Author pane opens on Profiles, so the escape editor is not even mounted yet — landing on it
  // is the proof the deep-link switched the workbench artifact, not a coincidence of defaults.
  await expect(win.getByTestId('workbench-escape-editor')).not.toBeVisible();

  // CurrentDir is not the default template (SetMark is), so selecting it proves the link sets the
  // template, not just the artifact.
  await win.getByTestId('settings-gear').click();
  await win.getByTestId('docs-search-input').fill('OSC 1337 CurrentDir');
  await win.getByTestId('docs-result-osc-osc1337-current-dir').click();
  await expect(win.getByTestId('settings-overlay')).not.toBeVisible();
  await expect(win.getByTestId('workbench-escape-editor')).toBeVisible();
  await expect(win.getByTestId('escape-template-select')).toContainText('CurrentDir');

  // The literal epic acceptance: search "OSC 1337 SetMark", land on the SetMark template entry.
  await win.getByTestId('settings-gear').click();
  await win.getByTestId('docs-search-input').fill('OSC 1337 SetMark');
  await win.getByTestId('docs-result-osc-osc1337-set-mark').click();
  await expect(win.getByTestId('settings-overlay')).not.toBeVisible();
  await expect(win.getByTestId('escape-template-select')).toContainText('SetMark');

  await app.close();
});

test('docs index deep-links a protobuf message to its console action', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // send-text is the default action, so route to a non-default one to prove the link selects it.
  await win.getByTestId('settings-gear').click();
  await win.getByTestId('docs-search-input').fill('InvokeFunctionRequest');
  await win.getByTestId('docs-result-proto-invoke-function').click();
  await expect(win.getByTestId('settings-overlay')).not.toBeVisible();
  // The invoke-function form is mounted only when its action is selected.
  await expect(win.getByTestId('form-invoke-function')).toBeVisible();

  await app.close();
});
