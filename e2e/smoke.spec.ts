import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

test('Entity Workspace launches on a single Inspect lens and switches lenses on demand', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // Two axes, not a bag of co-present panels: the entity rail is always present, and exactly one lens
  // is focal. A fresh launch lands on Inspect — Variables + Screen — and nothing else is co-rendered.
  await expect(win.getByTestId('entity-workspace')).toBeVisible();
  await expect(win.getByTestId('entity-spine-rail')).toBeVisible();
  await expect(win.getByTestId('lens-switcher')).toBeVisible();
  await expect(win.getByTestId('facet-variables')).toBeVisible();
  await expect(win.getByTestId('facet-screen')).toBeVisible();
  // The other subjects are not on screen — co-presence is gone by construction.
  await expect(win.getByTestId('facet-console')).toHaveCount(0);
  await expect(win.getByTestId('facet-build')).toHaveCount(0);

  // The live context strip is shell furniture, not lens content: it is present on the Inspect lens.
  await expect(win.getByTestId('live-context-strip')).toBeVisible();
  await expect(win.getByTestId('strip-connection')).toBeVisible();

  // The screen is shell furniture stacked below the lens, not Inspect-only content: it is present on
  // the Inspect launch and stays present when the focal subject swaps to Build.
  await expect(win.getByTestId('facet-screen')).toBeVisible();

  // The lens switcher swaps the focal subject whole: Build replaces Inspect, not adds to it.
  await win.getByTestId('lens-build').click();
  await expect(win.getByTestId('facet-build')).toBeVisible();
  await expect(win.getByTestId('author-pane')).toBeVisible();
  await expect(win.getByTestId('facet-variables')).toHaveCount(0);
  // The screen companion survives the lens swap — the observe pane is below every lens, not just Inspect.
  await expect(win.getByTestId('facet-screen')).toBeVisible();

  // The screen is togglable from the lens header: hiding it removes the pane (and its divider) so the
  // lens fills the column; showing it stacks the pane back below.
  await win.getByTestId('screen-toggle').click();
  await expect(win.getByTestId('facet-screen')).toHaveCount(0);
  await win.getByTestId('screen-toggle').click();
  await expect(win.getByTestId('facet-screen')).toBeVisible();

  // The entity rail persists across every lens — it is navigation, not a lens.
  await expect(win.getByTestId('entity-spine-rail')).toBeVisible();
  // And so does the context strip: switching lenses never tears down the observe loop's readout.
  await expect(win.getByTestId('live-context-strip')).toBeVisible();

  await win.getByTestId('lens-inspect').click();
  await expect(win.getByTestId('facet-variables')).toBeVisible();
  await expect(win.getByTestId('facet-build')).toHaveCount(0);
  await expect(win.getByTestId('live-context-strip')).toBeVisible();

  // Settings is a utility affordance reached from the rail's gear, not a peer lens.
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
  await win.getByTestId('lens-console').click();
  await win.getByTestId('action-activate').click();
  await win.getByTestId('activate-id-input').fill('t1');
  await win.getByTestId('snippet-name').fill('clone-safety probe');
  await win.getByTestId('snippet-save').click();
  const snippet = win.locator('[data-testid^="snippet-snip-"]').first();
  await expect(snippet).toBeVisible();
  await snippet.locator('[data-testid^="snippet-fire-"]').click();

  // Cause/effect is one glance on the Console lens itself: the just-fired action surfaces in the inline
  // Result panel WITHOUT switching to Events. This is the coupling under test — firing here reads the
  // same spine snapshot the Events timeline does, so the event appears in place.
  const consoleResult = win.getByTestId('console-result');
  await expect(
    consoleResult.locator('[data-testid^="activity-row-"][data-facet="action"]'),
  ).toHaveCount(1, { timeout: 10_000 });

  // The same spine, viewed in the Events lens: the action recorded while on Console survives the switch
  // and renders identically there — one source of truth, two surfaces, never a second projection.
  await win.getByTestId('lens-events').click();

  // The event reaching the spine is the contract under test, not the action's success — with no
  // connection the result is a loud ✗, which is exactly the honest shape.
  const actionRows = win.locator('[data-testid^="activity-row-"][data-facet="action"]');
  await expect(actionRows).toHaveCount(1, { timeout: 10_000 });

  await app.close();
});

test('a saved snippet survives a reload — the console remembers experiments across restart', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // Save a snippet on the Console lens. The acceptance is that it is still listed after a reload — the
  // in-memory store is the authority, localStorage is the mirror it rehydrates from on restart.
  await win.getByTestId('lens-console').click();
  await win.getByTestId('action-activate').click();
  await win.getByTestId('activate-id-input').fill('persist-me');
  await win.getByTestId('snippet-name').fill('remembered snippet');
  await win.getByTestId('snippet-save').click();
  const saved = win.locator('[data-testid^="snippet-snip-"]').first();
  await expect(saved).toBeVisible();
  await expect(saved).toContainText('remembered snippet');

  // Reload the renderer: the same userData partition keeps localStorage, so a fresh RootStore rehydrates
  // the snippet. The persisted active lens also restores Console, so the snippet card is on screen again.
  await win.reload();
  await expect(win.getByTestId('facet-console')).toBeVisible();
  const restored = win.locator('[data-testid^="snippet-snip-"]').first();
  await expect(restored).toBeVisible();
  await expect(restored).toContainText('remembered snippet');

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
  await win.getByTestId('lens-build').click();
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

  await win.getByTestId('lens-build').click();
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

test('Explore lens deep-links the OSC catalog to the matching escape template editor', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // The app launches on the Inspect lens, so the Build lens (and its escape editor) is not mounted at
  // all — landing on it is proof the deep-link switched both the lens and the workbench artifact.
  await expect(win.getByTestId('workbench-escape-editor')).not.toBeVisible();

  // CurrentDir is not the default template (SetMark is), so selecting it proves the link sets the
  // template, not just the artifact.
  await win.getByTestId('lens-explore').click();
  await expect(win.getByTestId('facet-explore')).toBeVisible();
  await win.getByTestId('explorer-search-input').fill('OSC 1337 CurrentDir');
  await win.getByTestId('explorer-try-escape-osc1337-current-dir').click();
  await expect(win.getByTestId('workbench-escape-editor')).toBeVisible();
  await expect(win.getByTestId('escape-template-select')).toContainText('CurrentDir');

  // The literal epic acceptance: search "OSC 1337 SetMark", land on the SetMark template entry.
  await win.getByTestId('lens-explore').click();
  await win.getByTestId('explorer-search-input').fill('OSC 1337 SetMark');
  await win.getByTestId('explorer-try-escape-osc1337-set-mark').click();
  await expect(win.getByTestId('escape-template-select')).toContainText('SetMark');

  await app.close();
});

test('Explore lens "Try in Console" deep-links a protobuf message to its console action', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // send-text is the default action, so route to a non-default one to prove the link selects it.
  await win.getByTestId('lens-explore').click();
  await win.getByTestId('explorer-search-input').fill('InvokeFunctionRequest');
  await expect(win.getByTestId('explorer-result-rpc-actions-invoke-function')).toBeVisible();
  await win.getByTestId('explorer-try-rpc-actions-invoke-function').click();
  // The deep-link switches to the Console lens and the invoke-function form mounts only when selected.
  await expect(win.getByTestId('facet-console')).toBeVisible();
  await expect(win.getByTestId('form-invoke-function')).toBeVisible();

  await app.close();
});

test('Explore lens deep-links a read-only capability to its home lens', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();

  // A read method (monitor/layout) has no Console form — it deep-links to the lens where its data lives.
  // Starting from Explore and landing on Inspect's Variables facet proves the lens arm of the navigator.
  await win.getByTestId('lens-explore').click();
  await win.getByTestId('explorer-search-input').fill('LayoutSnapshot');
  const row = win.getByTestId('explorer-result-rpc-monitor-layout');
  await expect(row).toBeVisible();
  // It is classified read, not mutate — the typed kind surfaces as the row badge.
  await expect(win.getByTestId('explorer-kind-badge-rpc-monitor-layout')).toHaveText('read');
  await win.getByTestId('explorer-try-rpc-monitor-layout').click();
  await expect(win.getByTestId('facet-variables')).toBeVisible();
  await expect(win.getByTestId('facet-explore')).toHaveCount(0);

  await app.close();
});
