import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { launchApp } from './launch-app';

const socketPath = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

// Connection/Settings is a utility affordance behind the rail's gear, not a peer lens. Open it, wait
// for the auto-negotiated session to be ready, then close it so the focal lens is interactable (the
// overlay backdrop covers it while open).
async function connectViaGear(win: Page): Promise<void> {
  await win.getByTestId('settings-gear').click();
  await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 20_000 },
  );
}

async function closeSettings(win: Page): Promise<void> {
  await win.getByTestId('settings-close').click();
  await expect(win.getByTestId('settings-overlay')).not.toBeVisible();
}

// The workspace shows exactly one focal lens at a time; a subject's panes are mounted only while its
// lens is focal. Each launch gets an isolated userData dir (launch-app), so the persisted lens cannot
// leak between launches — every test still selects the lens it drives because that subject's panes are
// only mounted when its lens is focal, not because of any cross-launch carryover.
type Lens = 'inspect' | 'events' | 'console' | 'build';
async function selectLens(win: Page, lens: Lens): Promise<void> {
  await win.getByTestId(`lens-${lens}`).click();
  await expect(win.getByTestId(`facet-${lens === 'inspect' ? 'variables' : lens}`)).toBeVisible();
}

test.describe('live iTerm2', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.ITERM2_INTEGRATION !== '1',
      'opt-in: re-run with ITERM2_INTEGRATION=1 and iTerm2 open',
    );
    test.skip(!existsSync(socketPath), `iTerm2 socket missing at ${socketPath}`);
  });

  test('Settings: negotiates cookie + connects + list-sessions', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    // App auto-connects on startup (main.ts); the gear overlay surfaces the negotiated state.
    await connectViaGear(win);
    await expect(win.getByTestId('protocol-version')).not.toHaveText('(n/a)');
    await expect(win.getByTestId('capability-table')).toBeVisible();

    await win.getByTestId('list-sessions-button').click();
    await expect(win.getByTestId('list-sessions-summary')).toContainText(
      /\d+ window\(s\)/,
    );

    await app.close();
  });

  test('Live state: layout + variables + wire + notifications cross-link on focus', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    // A focus ref forwarded to the main process as a MobX proxy fails structured
    // clone ("could not be cloned"), silently rejecting monitor/focus-variables.
    const cloneErrors: string[] = [];
    win.on('pageerror', (e) => cloneErrors.push(String(e)));
    win.on('console', (m) => {
      if (m.type() === 'error') cloneErrors.push(m.text());
    });

    await connectViaGear(win);
    await closeSettings(win);

    // The entity rail is always present; the Inspect lens shows the focused entity's live state. Wire
    // frames and notifications are facets of the Events lens's one timeline, asserted at the end once
    // that lens is focal — they are not co-present with Inspect.
    await selectLens(win, 'inspect');
    await expect(win.getByTestId('layout-pane')).toBeVisible();
    await expect(win.getByTestId('variables-pane')).toBeVisible();

    const firstSession = win.locator('[data-testid^="layout-session-"]').first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();

    await expect(firstSession).toHaveAttribute('data-focused', 'true');
    await expect(win.getByTestId('variables-pane')).not.toHaveAttribute(
      'data-empty',
      'loading',
      { timeout: 10_000 },
    );
    // hostname is a default-watched path, so it surfaces in the focused session's scope group...
    const sessionScope = win.getByTestId('variable-scope-session');
    await expect(sessionScope.getByTestId('variable-hostname')).toBeVisible({
      timeout: 10_000,
    });
    // ...and in the pinned Watching section, which persists across focus and updates live.
    const watchlist = win.getByTestId('variables-watchlist');
    await expect(watchlist).toBeVisible();
    await expect(watchlist.getByTestId('variable-hostname')).toHaveAttribute(
      'data-watched',
      'true',
    );

    expect(cloneErrors.filter((e) => /could not be cloned/i.test(e))).toEqual([]);

    // Expression probe: a variable path resolves against the focused session scope.
    const probe = win.getByTestId('variable-probe');
    await probe.getByTestId('variable-probe-input').fill('session.name');
    await probe.getByTestId('variable-probe-submit').click();
    const probeResult = win.getByTestId('variable-probe-result');
    await expect(probeResult).toHaveAttribute('data-outcome', 'value', { timeout: 10_000 });
    await expect(probeResult).not.toBeEmpty();

    // A multi-reference interpolated template evaluates whole through the probe_eval RPC round-trip:
    // iTerm2 interpolates both refs against the focused scope and the fully-interpolated value comes
    // back, with the literal "/" separator between them proving both references resolved.
    await probe.getByTestId('variable-probe-input').fill('\\(session.name)/\\(session.username)');
    await probe.getByTestId('variable-probe-submit').click();
    await expect(probeResult).toHaveAttribute('data-outcome', 'value', { timeout: 10_000 });
    // The evaluated value carries the literal "/" between the two resolved refs — proof iTerm2
    // interpolated the whole template, not just one reference.
    await expect(probeResult.getByTestId('variable-probe-value')).toContainText('/');

    // The headline of the Inspect lens: a variable row feeds the probe instead of the user retyping a
    // path they can already see. Clicking the row's insert control appends that variable's reference to
    // the one probe draft the input renders, and it then evaluates live against the focused session.
    await probe.getByTestId('variable-probe-input').fill('');
    await sessionScope.getByTestId('probe-insert-hostname').click();
    await expect(probe.getByTestId('variable-probe-input')).toHaveValue('\\(hostname)');
    await probe.getByTestId('variable-probe-submit').click();
    await expect(probeResult).toHaveAttribute('data-outcome', 'value', { timeout: 10_000 });

    expect(cloneErrors.filter((e) => /could not be cloned/i.test(e))).toEqual([]);

    // The Events lens projects every stream through one timeline; wire frames and notifications are
    // facets of it. Switching lenses never tears down the live subscriptions that feed them — the
    // shell is the single lifecycle owner, so a non-focal lens's store stays live.
    await selectLens(win, 'events');
    await expect(win.getByTestId('activity-timeline')).toBeVisible();
    await expect(win.getByTestId('activity-facet-frame')).toBeVisible();
    await expect(win.getByTestId('activity-facet-notification')).toBeVisible();

    await app.close();
  });

  test('Author v2: status-bar registration + custom-escape subscriber round-trip', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    const sessionId = await win.evaluate(async () => {
      const layout = await window.ipc.invoke('monitor/layout', undefined as never);
      const tab = layout.windows[0]?.tabs[0];
      const first = tab?.root?.children?.[0];
      if (!first || first.kind !== 'session') return '';
      return first.session.sessionId;
    });
    expect(sessionId).not.toBe('');

    // Register a status-bar component with a Color knob + verify it appears
    // in the registrations list.
    const uniqueId = `com.example.workbench-test-${Date.now()}`;
    const regResult = await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/register-rpc', {
        id: `reg-test-${args.t}`,
        persistent: true,
        role: 'status-bar',
        name: `wb_test_${args.t}`,
        arguments: ['knobs'],
        defaults: [],
        timeout: 5,
        responseTemplate: '"workbench-test"',
        attrs: {
          shortDescription: 'Workbench test',
          detailedDescription: 'Live-integration demo component',
          exemplar: '12:34',
          updateCadence: 1,
          uniqueIdentifier: args.uniqueId,
          format: 'PLAIN_TEXT',
          knobs: [
            {
              name: 'colorKnob',
              type: 'Color',
              placeholder: 'Tint',
              jsonDefaultValue: JSON.stringify({
                'Red Component': 0.2,
                'Green Component': 0.6,
                'Blue Component': 1,
                'Alpha Component': 1,
                'Color Space': 'sRGB',
              }),
              key: 'tint',
            },
          ],
        },
      });
    }, { t: Date.now(), uniqueId });
    expect(regResult.ok).toBe(true);

    // Confirm it's in the registrations snapshot
    const activeRegs = await win.evaluate(async () => {
      return window.ipc.invoke('workbench/registrations', undefined as never);
    });
    const found = activeRegs.registrations.find(
      (r) => r.spec.role === 'status-bar' && r.spec.attrs.uniqueIdentifier === uniqueId,
    );
    expect(found).toBeTruthy();
    expect(found?.spec.role).toBe('status-bar');
    expect(
      found && found.spec.role === 'status-bar' ? found.spec.attrs.knobs[0].type : null,
    ).toBe('Color');

    // Custom escape round-trip through the paired UI (449.2.3 acceptance): construct a
    // Custom= sequence, subscribe to its identity, emit it, and watch the payload arrive in
    // the paired subscriber — all on the one escape-sequence surface.
    const identityA = `wb-a-${Date.now()}`;
    const identityB = `wb-b-${Date.now()}`;
    const payload = `hello-from-workbench-${Date.now()}`;

    await closeSettings(win);
    await win.getByTestId(`layout-session-${sessionId}`).click();
    await selectLens(win, 'build');
    await win.getByTestId('workbench-rail-escape-sequence').click();

    await win.getByTestId('escape-template-select').click();
    await win.getByTestId('escape-template-osc1337-custom').click();
    await win.getByTestId('escape-field-identity').fill(identityA);

    // The paired subscriber derives target and identity from the emitter — no second picker.
    const pairing = win.getByTestId('custom-escape-pairing');
    await expect(pairing).toHaveAttribute('data-target', sessionId);
    await expect(pairing).toHaveAttribute('data-identity', identityA);

    await win.getByTestId('custom-escape-subscribe').click();
    const subRows = win.locator('[data-testid^="custom-escape-sub-"]');
    const subA = subRows.filter({ hasText: identityA });
    await expect(subA).toBeVisible({ timeout: 5_000 });

    // Second identity on the same session: the orchestrator must multiplex both local
    // subscriptions over the single per-session wire subscription.
    await win.getByTestId('escape-field-identity').fill(identityB);
    await win.getByTestId('custom-escape-subscribe').click();
    const subB = subRows.filter({ hasText: identityB });
    await expect(subB).toBeVisible({ timeout: 5_000 });

    // Dropping A must not tear down the shared wire subscription B still needs.
    await subA.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(subA).not.toBeVisible({ timeout: 5_000 });

    await win.getByTestId('escape-field-payload').fill(payload);
    await win.getByTestId('escape-send').click();
    await expect(win.getByTestId('escape-last-result')).toHaveAttribute('data-ok', 'true');

    const entry = win.locator('[data-testid^="custom-escape-entry-"]', {
      hasText: payload,
    });
    await expect(entry).toBeVisible({ timeout: 5_000 });
    await expect(entry).toContainText(identityB);

    // Cleanup through the same surface, then drop the registration.
    await subB.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(subB).not.toBeVisible({ timeout: 5_000 });
    const regId = regResult.registrationId ?? '';
    await win.evaluate(async (args) => {
      await window.ipc.invoke('workbench/unregister-rpc', { id: args.regId });
    }, { regId });

    await app.close();
  });

  test('Author v2: every registration role registers, generic receives an invocation, all unregister', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    const t = Date.now();
    // One spec per role — the full registration matrix from iterm2-roadmap-449.2.2. The shapes are
    // typechecked against RegistrationSpec, so this test also pins the IPC contract per role.
    const rpcCommon = {
      arguments: [] as string[],
      defaults: [] as Array<{ name: string; path: string }>,
      timeout: 5,
      persistent: true,
    };
    const specs = [
      {
        ...rpcCommon,
        id: `reg-e2e-generic-${t}`,
        role: 'generic' as const,
        name: `wb_e2e_gen_${t}`,
        arguments: ['x'],
        responseTemplate: '"e2e-generic-response"',
      },
      {
        ...rpcCommon,
        id: `reg-e2e-sb-${t}`,
        role: 'status-bar' as const,
        name: `wb_e2e_sb_${t}`,
        arguments: ['knobs'],
        responseTemplate: '"e2e-sb"',
        attrs: {
          shortDescription: 'E2E sb',
          detailedDescription: 'Full-matrix role test',
          exemplar: 'e2e',
          updateCadence: 30,
          uniqueIdentifier: `com.example.wb-e2e-sb-${t}`,
          format: 'PLAIN_TEXT' as const,
          knobs: [],
        },
      },
      {
        ...rpcCommon,
        id: `reg-e2e-title-${t}`,
        role: 'session-title' as const,
        name: `wb_e2e_title_${t}`,
        responseTemplate: '"e2e-title"',
        attrs: {
          displayName: 'E2E title',
          uniqueIdentifier: `com.example.wb-e2e-title-${t}`,
        },
      },
      {
        ...rpcCommon,
        id: `reg-e2e-menu-${t}`,
        role: 'context-menu' as const,
        name: `wb_e2e_menu_${t}`,
        responseTemplate: '"e2e-menu"',
        attrs: {
          displayName: 'E2E menu item',
          uniqueIdentifier: `com.example.wb-e2e-menu-${t}`,
        },
      },
      {
        id: `reg-e2e-tool-${t}`,
        persistent: true,
        role: 'toolbelt' as const,
        attrs: {
          displayName: 'E2E tool',
          identifier: `com.example.wb-e2e-tool-${t}`,
          url: 'https://iterm2.com',
          revealIfAlreadyRegistered: false,
        },
      },
    ];

    for (const spec of specs) {
      const result = await win.evaluate(
        (s) => window.ipc.invoke('workbench/register-rpc', s),
        spec,
      );
      expect(result.ok, `register ${spec.role}: ${result.error}`).toBe(true);
      expect(result.registrationId).toBe(spec.id);
    }

    // Every role is present in the snapshot with its role-specific attributes intact.
    const snap = await win.evaluate(() =>
      window.ipc.invoke('workbench/registrations', undefined as never),
    );
    for (const spec of specs) {
      const found = snap.registrations.find((r) => r.spec.id === spec.id);
      expect(found, `snapshot has ${spec.role}`).toBeTruthy();
      expect(found?.spec.role).toBe(spec.role);
    }
    const tool = snap.registrations.find((r) => r.spec.id === `reg-e2e-tool-${t}`);
    expect(tool && tool.spec.role === 'toolbelt' ? tool.spec.attrs.url : null).toBe(
      'https://iterm2.com',
    );

    // The generic role receives an invocation: call our own registered function through
    // iTerm2 (app scope) and expect the configured response template back, plus an
    // invocation event in the projection.
    const invokeResult = await win.evaluate(
      (args) =>
        window.ipc.invoke('actions/invoke-function', {
          entity: { kind: 'app' },
          invocation: `${args.name}(x: 1)`,
          scope: { kind: 'app' },
          timeout: 10,
        }),
      { name: `wb_e2e_gen_${t}` },
    );
    expect(invokeResult.ok, `invoke generic: ${invokeResult.error}`).toBe(true);
    expect(invokeResult.payload?.jsonResult).toBe('"e2e-generic-response"');

    const afterInvoke = await win.evaluate(() =>
      window.ipc.invoke('workbench/registrations', undefined as never),
    );
    const invocation = afterInvoke.invocations.find(
      (i) => i.registrationId === `reg-e2e-generic-${t}`,
    );
    expect(invocation).toBeTruthy();
    expect(invocation?.responded).toBe(true);
    expect(invocation?.responseJson).toBe('"e2e-generic-response"');
    expect(invocation?.args.x).toBe(1);

    // Unregister all (toolbelt is a local forget — iTerm2 has no unregister-tool message).
    for (const spec of specs) {
      const result = await win.evaluate(
        (id) => window.ipc.invoke('workbench/unregister-rpc', { id }),
        spec.id,
      );
      expect(result.ok, `unregister ${spec.role}: ${result.error}`).toBe(true);
    }
    const afterCleanup = await win.evaluate(() =>
      window.ipc.invoke('workbench/registrations', undefined as never),
    );
    for (const spec of specs) {
      expect(afterCleanup.registrations.find((r) => r.spec.id === spec.id)).toBeFalsy();
    }

    await app.close();
  });

  test('Author: profile inspector lists API properties; dynamic profile round-trips; escape template emits', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    // Grab the default profile's GUID and a real sessionId.
    const probe = await win.evaluate(async () => {
      const layout = await window.ipc.invoke('monitor/layout', undefined as never);
      const tab = layout.windows[0]?.tabs[0];
      const first = tab?.root?.children?.[0];
      const s = (first?.kind === 'session' ? first.session.sessionId : '') ?? '';
      const prof = await window.ipc.invoke('workbench/list-profiles', undefined as never);
      const def = prof.profiles.find((p) => p.name === 'Default') ?? prof.profiles[0];
      return { sessionId: s, guid: def?.guid ?? '', name: def?.name ?? '' };
    });
    expect(probe.sessionId).not.toBe('');
    expect(probe.guid).not.toBe('');

    // The Build lens hosts every authoring artifact; its rail is reachable once that lens is focal.
    await closeSettings(win);
    await selectLens(win, 'build');

    // Profiles artifact: pick a profile through the UI, verify the read-only inspector
    // lists the API's raw property keys. There is deliberately NO write path here (449.8.1):
    // iTerm2 Settings > Profiles is the canonical editor of shared profiles.
    await win.getByTestId('workbench-rail-profile').click();
    // Scope banner must tell the truth about each artifact's scope (449.7.7).
    await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
      'data-scope',
      'profile',
    );
    await win.getByTestId('workbench-refresh-profiles').click();
    // Wait for profiles to populate in the select
    await expect(win.getByTestId('workbench-profile-select')).toBeVisible({ timeout: 10_000 });
    await win.getByTestId('workbench-profile-select').click();
    await win.getByRole('option', { name: probe.name }).first().click();
    // Every profile the API reports carries at least Name and Guid keys.
    const inspector = win.getByTestId('profile-inspector');
    await expect(inspector).toBeVisible();
    await expect(
      inspector.locator('[data-testid="profile-inspector-row"][data-key="Name"]'),
    ).toBeVisible();
    const totalRows = await inspector.getByTestId('profile-inspector-row').count();
    expect(totalRows).toBeGreaterThan(1);
    // Filter narrows the listing to matching keys.
    await win.getByTestId('profile-inspector-filter').fill('Guid');
    const filteredRows = await inspector.getByTestId('profile-inspector-row').count();
    expect(filteredRows).toBeGreaterThan(0);
    expect(filteredRows).toBeLessThan(totalRows);
    // Per-row copy puts the exact key string on the clipboard.
    await inspector
      .locator('[data-testid="profile-inspector-row"][data-key="Guid"]')
      .getByTestId('profile-inspector-copy-key')
      .click();
    const clipboardKey = await win.evaluate(() => navigator.clipboard.readText());
    expect(clipboardKey).toBe('Guid');
    await win.getByTestId('profile-inspector-filter').fill('');

    // Dynamic Profiles: write a temp file, verify it appears in the snapshot.
    await win.getByTestId('workbench-rail-dynamic-profile').click();
    await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
      'data-scope',
      'connection',
    );
    const tempBasename = `workbench-test-${Date.now()}.json`;
    const write = await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/save-dynamic-profile', {
        basename: args.basename,
        body: JSON.stringify(
          {
            Profiles: [
              {
                Guid: `testguid-${args.t}`,
                Name: `workbench-test-${args.t}`,
                'Dynamic Profile Parent Name': 'Default',
              },
            ],
          },
          null,
          2,
        ),
      });
    }, { basename: tempBasename, t: Date.now() });
    expect(write.ok).toBe(true);

    // Wait for chokidar to surface the file in the snapshot.
    await expect(async () => {
      const snap = await win.evaluate(() =>
        window.ipc.invoke('workbench/dynamic-profiles', undefined as never),
      );
      expect(snap.files.map((f) => f.basename)).toContain(tempBasename);
    }).toPass({ timeout: 5000 });

    // Clean up the test file.
    await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/delete-dynamic-profile', {
        basename: args.basename,
      });
    }, { basename: tempBasename });

    // Escape Sequence: build the Inline Image (File) template through the real editor UI and
    // emit it to the focused session (epic 449.1 acceptance: the File template emits a valid
    // sequence that renders in the target session).
    await win.getByTestId(`layout-session-${probe.sessionId}`).click();
    await win.getByTestId('workbench-rail-escape-sequence').click();
    // Entity-scoped artifact: banner says so, and the editor anchors its target to focus.
    await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
      'data-scope',
      'entity',
    );

    await win.getByTestId('escape-template-select').click();
    await win.getByTestId('escape-template-osc1337-file-inline').click();
    // 1x1 transparent PNG.
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await win.getByTestId('escape-field-data_base64').fill(pngBase64);

    // The preview derives from the same builder the unit tests pin byte-exactly.
    await expect(win.getByTestId('escape-sequence-hex')).not.toBeEmpty();
    await expect(win.getByTestId('escape-effective-target')).toHaveAttribute(
      'data-target',
      probe.sessionId,
    );

    await win.getByTestId('escape-send').click();
    await expect(win.getByTestId('escape-last-result')).toHaveAttribute('data-ok', 'true');

    // The terminal must keep rendering after consuming the image sequence: inject a marker as
    // output and require it to surface as visible screen content below the image.
    const marker = `escape-e2e-${Date.now()}`;
    const markerHex = Array.from(new TextEncoder().encode(`\r\n${marker}\r\n`))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await win.evaluate(async (args) => {
      return window.ipc.invoke('actions/inject', {
        entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
        sessionIds: [args.sessionId],
        bytesHex: args.markerHex,
      });
    }, { sessionId: probe.sessionId, markerHex });
    // The live screen is the Inspect lens's companion pane.
    await selectLens(win, 'inspect');
    const screenPane = win.getByTestId('screen-pane');
    await expect(screenPane.locator('.xterm-rows')).toContainText(marker, { timeout: 10_000 });

    await app.close();
  });

  test('Author: triggers view is read-only, engine-truthful, and dry-runs against captured session output', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    // The dry run reads the FOCUSED session's captured screen. Borrowing whatever session the
    // user is working in races their redraws (a full-screen TUI overdraws the injected marker
    // within one frame). [LAW:no-ambient-temporal-coupling] the test owns its terminal: a
    // dedicated iTerm2 window, created and closed here.
    const testSessionId = execSync(
      `osascript -e 'tell application "iTerm2"
set w to (create window with default profile)
return unique ID of current session of w
end tell'`,
      { encoding: 'utf8' },
    ).trim();
    expect(testSessionId).toMatch(/^[0-9A-F-]{36}$/);

    // From here real iTerm2 state exists (a window, then a dynamic profile): every exit path
    // must tear both down, or a failed assertion leaks them into the user's environment.
    const t = Date.now();
    const marker = `trigger-e2e-${t}-fire`;
    const profileName = `trigger-test-${t}`;
    const tempBasename = `trigger-test-${t}.json`;
    try {

    // Author a profile WITH triggers the only way this app legitimately can (449.8.2): as a
    // Dynamic Profile. One portable trigger and one ICU-only trigger pin both tester verdicts.
    const write = await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/save-dynamic-profile', {
        basename: args.basename,
        body: JSON.stringify({
          Profiles: [
            {
              Guid: `trigger-testguid-${args.t}`,
              Name: args.profileName,
              'Dynamic Profile Parent Name': 'Default',
              Triggers: [
                { regex: args.marker, action: 'HighlightTrigger' },
                { regex: '\\herror', action: 'BellTrigger' },
              ],
            },
          ],
        }),
      });
    }, { basename: tempBasename, t, profileName, marker });
    expect(write.ok).toBe(true);

    // iTerm2 hot-loads the dynamic profile; it surfaces through the same list-profiles read
    // the triggers view renders from.
    await expect(async () => {
      const prof = await win.evaluate(() =>
        window.ipc.invoke('workbench/list-profiles', undefined as never),
      );
      expect(prof.profiles.map((p) => p.name)).toContain(profileName);
    }).toPass({ timeout: 15_000 });

    await closeSettings(win);
    await selectLens(win, 'inspect');

    // Focus the dedicated session and put the firing marker into its captured output.
    await expect(win.getByTestId(`layout-session-${testSessionId}`)).toBeVisible({
      timeout: 10_000,
    });
    await win.getByTestId(`layout-session-${testSessionId}`).click();
    const markerHex = Array.from(new TextEncoder().encode(`\r\n${marker}\r\n`))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await win.evaluate(async (args) => {
      return window.ipc.invoke('actions/inject', {
        entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
        sessionIds: [args.sessionId],
        bytesHex: args.markerHex,
      });
    }, { sessionId: testSessionId, markerHex });
    await expect(win.getByTestId('screen-pane').locator('.xterm-rows')).toContainText(
      marker,
      { timeout: 10_000 },
    );

    await selectLens(win, 'build');
    await win.getByTestId('workbench-rail-triggers').click();
    await win.getByTestId('triggers-refresh-profiles').click();
    await win.getByTestId('triggers-profile-select').click();
    await win.getByRole('option', { name: profileName }).click();

    // The engine caveat is always visible, and there is no write affordance anywhere.
    await expect(win.getByTestId('triggers-engine-caveat')).toBeVisible();
    await expect(win.getByTestId('workbench-triggers').getByText('Apply to profile')).toHaveCount(0);

    // Default source is the focused session's captured output: the portable trigger fires on the
    // injected marker; the ICU-only trigger is flagged untestable, never a false no-match.
    await expect(win.getByTestId('triggers-session-info')).toContainText(testSessionId);
    await expect(win.getByTestId('trigger-result-0')).toHaveAttribute('data-result', 'fired', {
      timeout: 10_000,
    });
    await expect(win.getByTestId('trigger-result-1')).toHaveAttribute(
      'data-result',
      'untestable',
    );

    // Pasted-text source evaluates the same triggers against the pasted lines.
    await win.getByTestId('triggers-source-pasted').click();
    await expect(win.getByTestId('trigger-result-0')).toHaveAttribute('data-result', 'no-input');
    await win.getByTestId('triggers-sample').fill(`noise\n${marker} tail`);
    await expect(win.getByTestId('trigger-result-0')).toHaveAttribute('data-result', 'fired');

    // A firing trigger names the action it would take and the line it fired on.
    await expect(win.getByTestId('trigger-0')).toContainText('would run HighlightTrigger');

    // The raw JSON is the exact Triggers property value, and Copy puts it on the clipboard.
    // The copy badge is the synchronization point: the write is async behind the click.
    await expect(win.getByTestId('triggers-raw')).toHaveValue(new RegExp(marker));
    await win.getByTestId('triggers-copy-json').click();
    await expect(win.getByTestId('triggers-copy-result')).toHaveText('copied');
    const clipboard = await win.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(marker);

    } finally {
      // Teardown through the app's own typed channel: force-closing the session skips iTerm2's
      // close-confirmation modal, which makes AppleScript window closing hang. Soft assertions
      // keep every teardown step running even when one fails. [LAW:no-silent-failure]
      const closeRes = await win.evaluate(async (args) => {
        return window.ipc.invoke('actions/close', {
          entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
          kind: 'sessions',
          ids: [args.sessionId],
          force: true,
        });
      }, { sessionId: testSessionId });
      expect.soft(closeRes.ok).toBe(true);
      const del = await win.evaluate(async (args) => {
        return window.ipc.invoke('workbench/delete-dynamic-profile', {
          basename: args.basename,
        });
      }, { basename: tempBasename });
      expect.soft(del.ok).toBe(true);
      await app.close();
    }
  });

  test('Author: arrangement artifact saves, lists, inspects, diffs, and restores', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    // The save/restore verbs act on real iTerm2 windows; the test owns its own windows rather
    // than capturing/restoring over the user's. Two windows so the scoped save (one window) and
    // the unscoped save (all windows) are guaranteed to differ for the diff assertion.
    const mkWindow = () =>
      execSync(
        `osascript -e 'tell application "iTerm2"
set w to (create window with default profile)
return unique ID of current session of w
end tell'`,
        { encoding: 'utf8' },
      ).trim();
    const sessionA = mkWindow();
    const sessionB = mkWindow();
    expect(sessionA).toMatch(/^[0-9A-F-]{36}$/);
    expect(sessionB).toMatch(/^[0-9A-F-]{36}$/);

    // The SavedArrangement wire message has no DELETE verb (only iTerm2's Window > Edit Window
    // Arrangements can remove one), so fixed names make reruns overwrite instead of accumulate.
    const nameAll = 'wb-e2e-arrangement-a';
    const nameOne = 'wb-e2e-arrangement-b';

    const layoutWindows = () =>
      win.evaluate(async () => {
        const layout = await window.ipc.invoke('monitor/layout', undefined as never);
        return layout.windows.map((w) => w.windowId);
      });

    try {
      // Wait until the dedicated windows surface in the layout, and capture the window id of
      // sessionA's window for the scoped save.
      let windowIdA = '';
      await expect(async () => {
        const found = await win.evaluate(async (args) => {
          const layout = await window.ipc.invoke('monitor/layout', undefined as never);
          for (const w of layout.windows) {
            for (const t of w.tabs) {
              for (const child of t.root?.children ?? []) {
                if (child.kind === 'session' && child.session.sessionId === args.sessionA) {
                  return w.windowId;
                }
              }
            }
          }
          return '';
        }, { sessionA });
        expect(found).not.toBe('');
        windowIdA = found;
      }).toPass({ timeout: 10_000 });

      await closeSettings(win);
      await selectLens(win, 'build');

      // The artifact is connection-wide and reachable from the workbench rail.
      await win.getByTestId('workbench-rail-arrangement').click();
      await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
        'data-scope',
        'connection',
      );

      // Save all windows through the viewer UI.
      await win.getByTestId('arrangement-save-name').fill(nameAll);
      await win.getByTestId('arrangement-save').click();
      await expect(win.getByTestId('arrangement-last-result')).toContainText('ok');

      // Save one window through the action channel — the windowId variant the Act bar carries.
      const scopedSave = await win.evaluate(async (args) => {
        return window.ipc.invoke('actions/saved-arrangement', {
          entity: { kind: 'app' },
          op: 'save',
          name: args.nameOne,
          windowId: args.windowIdA,
        });
      }, { nameOne, windowIdA });
      expect(scopedSave.ok, `scoped save: ${scopedSave.error}`).toBe(true);

      // Both names converge in both sources: listed by the engine AND readable from defaults
      // (no disagreement badges on their rows).
      await expect(async () => {
        await win.getByTestId('arrangement-refresh').click();
        const rowAll = win.getByTestId(`arrangement-row-${nameAll}`);
        const rowOne = win.getByTestId(`arrangement-row-${nameOne}`);
        await expect(rowAll).toBeVisible();
        await expect(rowOne).toBeVisible();
        await expect(rowAll.locator('text=unknown to engine')).toHaveCount(0);
        await expect(rowAll.locator('text=no defaults content')).toHaveCount(0);
        await expect(rowOne.locator('text=unknown to engine')).toHaveCount(0);
        await expect(rowOne.locator('text=no defaults content')).toHaveCount(0);
      }).toPass({ timeout: 15_000 });

      // JSON inspect renders the parsed defaults content of the saved arrangement.
      await win.getByTestId(`arrangement-inspect-${nameAll}`).click();
      const json = win.getByTestId('arrangement-json');
      await expect(json).toBeVisible();
      await expect(json).toContainText('Tabs');

      // Diff: all-windows vs one-window must differ structurally.
      await win.getByTestId(`arrangement-diff-${nameOne}`).click();
      await expect(win.getByTestId('arrangement-diff-entries')).toBeVisible();

      // Restore the one-window arrangement as a new window and watch the window count grow.
      const before = await layoutWindows();
      await win.getByTestId(`arrangement-restore-${nameOne}`).click();
      await expect(win.getByTestId('arrangement-last-result')).toContainText(
        `restore "${nameOne}": ok`,
      );
      let restoredWindows: string[] = [];
      await expect(async () => {
        const after = await layoutWindows();
        restoredWindows = after.filter((id) => !before.includes(id));
        expect(restoredWindows.length).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000 });

      // A refusal status is a failed action, not a success with fine print: restoring a name
      // that does not exist reports ARRANGEMENT_NOT_FOUND as the error.
      const refused = await win.evaluate(async () => {
        return window.ipc.invoke('actions/saved-arrangement', {
          entity: { kind: 'app' },
          op: 'restore',
          name: 'wb-e2e-no-such-arrangement',
        });
      });
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain('ARRANGEMENT_NOT_FOUND');

      // Every fire above is an action event on the Events lens's one spine.
      await selectLens(win, 'events');
      const actionRows = win.locator(
        '[data-testid^="activity-row-"][data-facet="action"]',
      );
      await expect(actionRows.first()).toBeVisible({ timeout: 10_000 });

      // Close the restored window before teardown closes the originals.
      const closeRestored = await win.evaluate(async (args) => {
        return window.ipc.invoke('actions/close', {
          entity: { kind: 'app' },
          kind: 'windows',
          ids: args.ids,
          force: true,
        });
      }, { ids: restoredWindows });
      expect.soft(closeRestored.ok).toBe(true);
    } finally {
      // Teardown through the app's own typed channel (AppleScript close hangs on the confirm
      // modal); soft assertions keep every step running even when one fails.
      for (const sessionId of [sessionA, sessionB]) {
        const closeRes = await win.evaluate(async (args) => {
          return window.ipc.invoke('actions/close', {
            entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
            kind: 'sessions',
            ids: [args.sessionId],
            force: true,
          });
        }, { sessionId });
        expect.soft(closeRes.ok).toBe(true);
      }
      await app.close();
    }
  });

  test('Author: broadcast domain editor reads, edits, applies, and surfaces refusals', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    // The user's pre-existing table, restored verbatim in teardown — the test's domain rides on
    // sessions it owns, so the captured table never references them. A failed capture aborts
    // before any mutation: restoring a guessed table (or clearing) would rewrite state the test
    // never knew, so teardown only ever restores a table it actually read.
    let initialTable: { ok: true; domains: string[][] } | null = null;
    // Assigned inside the guarded block; teardown closes only sessions that were actually created.
    let sessionA = '';
    let sessionB = '';

    try {
      // Broadcast domains may not span windows, so the test owns one window split into two
      // sessions — the smallest layout where a domain is legal. Created inside the guarded block
      // so any failure from here on still tears down the app and whatever sessions exist.
      const ids = execSync(
        `osascript -e 'tell application "iTerm2"
set w to (create window with default profile)
set sA to current session of w
tell sA
  set sB to (split horizontally with default profile)
end tell
return (unique ID of sA) & "," & (unique ID of sB)
end tell'`,
        { encoding: 'utf8' },
      )
        .trim()
        .split(',');
      [sessionA = '', sessionB = ''] = ids;
      expect(sessionA).toMatch(/^[0-9A-F-]{36}$/);
      expect(sessionB).toMatch(/^[0-9A-F-]{36}$/);

      const captured = await win.evaluate(async () =>
        window.ipc.invoke('workbench/broadcast-domains', undefined as never),
      );
      expect(captured.ok, `initial table read: ${captured.ok ? '' : captured.error}`).toBe(true);
      if (captured.ok) initialTable = captured;

      // Zero the table so the editor starts deterministic: the new domain the test creates is
      // index 0 regardless of what the user had. Teardown restores the captured table verbatim.
      const zeroed = await win.evaluate(async () => {
        return window.ipc.invoke('actions/set-broadcast-domains', {
          entity: { kind: 'app' },
          domains: [],
        });
      });
      expect(zeroed.ok, `zeroing table: ${zeroed.error ?? ''}`).toBe(true);

      // Both sessions must surface in the layout before the editor can place them.
      await expect(async () => {
        const present = await win.evaluate(async (args) => {
          const layout = await window.ipc.invoke('monitor/layout', undefined as never);
          const all: string[] = [];
          for (const w of layout.windows) {
            for (const t of w.tabs) {
              const walk = (node: { children: Array<{ kind: string; session?: { sessionId: string }; node?: unknown }> } | null): void => {
                for (const child of node?.children ?? []) {
                  if (child.kind === 'session' && child.session) all.push(child.session.sessionId);
                  else if (child.kind === 'node') walk(child.node as never);
                }
              };
              walk(t.root);
            }
          }
          return all;
        }, {});
        expect(present).toContain(sessionA);
        expect(present).toContain(sessionB);
      }).toPass({ timeout: 10_000 });

      await closeSettings(win);
      await selectLens(win, 'build');

      // Connection-wide artifact, reachable from the workbench rail.
      await win.getByTestId('workbench-rail-broadcast-domain').click();
      await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
        'data-scope',
        'connection',
      );
      await expect(win.getByTestId('workbench-broadcast-domain')).toBeVisible();
      await win.getByTestId('broadcast-refresh').click();
      await expect(win.getByTestId('broadcast-load-error')).toHaveCount(0);

      // Build a domain with the click-to-move modality (drag and click feed the same move seam).
      await win.getByTestId('broadcast-add-domain').click();
      await win.getByTestId(`broadcast-chip-${sessionA}`).click();
      await win.getByTestId('broadcast-move-here-0').click();
      await win.getByTestId(`broadcast-chip-${sessionB}`).click();
      await win.getByTestId('broadcast-move-here-0').click();
      await expect(win.getByTestId('broadcast-dirty')).toBeVisible();

      // Apply replaces the engine table; the editor refreshes from the engine and reads clean.
      await win.getByTestId('broadcast-apply').click();
      await expect(win.getByTestId('broadcast-last-result')).toContainText('apply: ok');
      await expect(win.getByTestId('broadcast-dirty')).toHaveCount(0);

      // Engine round-trip: the GET verb reports the membership the SET wrote.
      const readBack = await win.evaluate(async () =>
        window.ipc.invoke('workbench/broadcast-domains', undefined as never),
      );
      expect(readBack.ok, `read back: ${readBack.ok ? '' : readBack.error}`).toBe(true);
      if (readBack.ok) {
        const match = readBack.domains.find(
          (d) => d.includes(sessionA) && d.includes(sessionB),
        );
        expect(match, JSON.stringify(readBack.domains)).toBeTruthy();
      }

      // A refusal status is a failed action, not a success with fine print.
      const refused = await win.evaluate(async () => {
        return window.ipc.invoke('actions/set-broadcast-domains', {
          entity: { kind: 'app' },
          domains: [['00000000-0000-0000-0000-000000000000']],
        });
      });
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain('SESSION_NOT_FOUND');

      // Every apply above is an action event on the Events lens's one spine.
      await selectLens(win, 'events');
      const actionRows = win.locator(
        '[data-testid^="activity-row-"][data-facet="action"]',
      );
      await expect(actionRows.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      // Put the user's table back exactly as found, then drop the window. No capture means the
      // test aborted before mutating, so there is nothing to restore — never write a guess.
      if (initialTable !== null) {
        const restored = await win.evaluate(async (args) => {
          return window.ipc.invoke('actions/set-broadcast-domains', {
            entity: { kind: 'app' },
            domains: args.domains,
          });
        }, { domains: initialTable.domains });
        expect.soft(restored.ok).toBe(true);
      }
      for (const sessionId of [sessionA, sessionB].filter(Boolean)) {
        const closeRes = await win.evaluate(async (args) => {
          return window.ipc.invoke('actions/close', {
            entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
            kind: 'sessions',
            ids: [args.sessionId],
            force: true,
          });
        }, { sessionId });
        expect.soft(closeRes.ok).toBe(true);
      }
      await app.close();
    }
  });

  test('Act: send text + activate + snippet re-fires, all feeding Activity', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);

    // Grab a real sessionId and a real tabId via the main-side snapshot
    const probe = await win.evaluate(async () => {
      const layout = await window.ipc.invoke('monitor/layout', undefined as never);
      const w = layout.windows[0];
      const t = w?.tabs[0];
      const first = t?.root?.children?.[0];
      const sessionId = first?.kind === 'session' ? first.session.sessionId : '';
      return { sessionId, tabId: t?.tabId ?? '' };
    });
    expect(probe.sessionId).not.toBe('');
    expect(probe.tabId).not.toBe('');

    // Firing actions lives in the Console lens.
    await closeSettings(win);
    await selectLens(win, 'console');

    // Send text — fire without text (safe no-op on shell).
    await win.getByTestId('action-send-text').click();
    await win
      .getByTestId('send-text-session-input')
      .fill(probe.sessionId);
    await win.getByTestId('send-text-input').fill('');
    await win.getByTestId('action-fire').click();

    // Activate a real tab
    await win.getByTestId('action-activate').click();
    await win.getByTestId('activate-id-input').fill(probe.tabId);
    await win.getByTestId('action-fire').click();

    // Save as snippet + re-fire
    await win.getByTestId('snippet-name').fill('activate-head-tab');
    await win.getByTestId('snippet-save').click();
    const snippet = win.locator('[data-testid^="snippet-snip-"]').first();
    await expect(snippet).toBeVisible();
    await snippet.locator('[data-testid^="snippet-fire-"]').click();

    // Actions feed the Events lens's spine (no Console-local transcript). The three fires surface as
    // three action events there, and every one succeeded (no ✗ in its summary). Switching lenses
    // never drops the events — the firing store stays live behind the non-focal lens.
    await selectLens(win, 'events');
    const actionRows = win.locator(
      '[data-testid^="activity-row-"][data-facet="action"]',
    );
    await expect(actionRows).toHaveCount(3, { timeout: 10_000 });
    await expect(actionRows.filter({ hasText: '✗' })).toHaveCount(0);

    await app.close();
  });

  test('Live state: screen renders + keystrokes + prompts facets populate', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await connectViaGear(win);
    await closeSettings(win);

    // Keystrokes, prompts and focus are facets of the Events lens's one timeline, not separate panes.
    await selectLens(win, 'events');
    await expect(win.getByTestId('activity-timeline')).toBeVisible();
    await expect(win.getByTestId('activity-facet-keystroke')).toBeVisible();
    await expect(win.getByTestId('activity-facet-prompt')).toBeVisible();
    await expect(win.getByTestId('activity-facet-focus')).toBeVisible();

    const firstSession = win.locator('[data-testid^="layout-session-"]').first();
    await expect(firstSession).toBeVisible({ timeout: 10_000 });
    await firstSession.click();

    const sessionId =
      (await firstSession.getAttribute('data-testid'))?.replace('layout-session-', '') ?? '';
    expect(sessionId).not.toBe('');

    // The live screen is the Inspect lens's companion pane; it keeps a data-empty attribute until a
    // snapshot for the focused session arrives.
    await selectLens(win, 'inspect');
    const screenPane = win.getByTestId('screen-pane');
    await expect(screenPane).toBeVisible({ timeout: 15_000 });
    await expect(screenPane).not.toHaveAttribute('data-empty', /./, { timeout: 15_000 });

    // The persistent context strip reads the same always-live stores as the panes: with a live
    // connection and a focused session whose screen has rendered, it reports the connected state and a
    // live screen readout — the observe loop's status is legible at the shell level, not buried in a lens.
    await expect(win.getByTestId('strip-connection-badge')).toHaveAttribute('data-state', 'ready');
    await expect(win.getByTestId('strip-screen')).toHaveAttribute(
      'data-screen-status',
      'live',
      { timeout: 15_000 },
    );

    // Inject a unique marker as terminal output and require it to surface as visible xterm
    // content — element presence alone can't prove the snapshot -> render path works.
    const marker = `screen-e2e-${Date.now()}`;
    const bytesHex = Array.from(new TextEncoder().encode(`\r\n${marker}\r\n`))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await win.evaluate(async (args) => {
      return window.ipc.invoke('actions/inject', {
        entity: { kind: 'session', windowId: '', tabId: '', sessionId: args.sessionId },
        sessionIds: [args.sessionId],
        bytesHex: args.bytesHex,
      });
    }, { sessionId, bytesHex });
    await expect(screenPane.locator('.xterm-rows')).toContainText(marker, {
      timeout: 10_000,
    });

    await app.close();
  });
});
