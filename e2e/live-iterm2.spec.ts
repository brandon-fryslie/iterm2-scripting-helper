import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { launchApp } from './launch-app';

const socketPath = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

// Connection/Settings is a utility affordance behind the rail's gear, not a peer tab. Open it, wait
// for the auto-negotiated session to be ready, then close it so the co-present facets are interactable
// (the overlay backdrop covers them while open).
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

    // The entity rail, live state, and Activity are co-present facets — no tab to switch to. Wire
    // frames and notifications are no longer separate panes; they are facets of the one Activity
    // timeline that every event stream projects through.
    await expect(win.getByTestId('layout-pane')).toBeVisible();
    await expect(win.getByTestId('variables-pane')).toBeVisible();
    await expect(win.getByTestId('activity-timeline')).toBeVisible();
    await expect(win.getByTestId('activity-facet-frame')).toBeVisible();
    await expect(win.getByTestId('activity-facet-notification')).toBeVisible();

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

    expect(cloneErrors.filter((e) => /could not be cloned/i.test(e))).toEqual([]);

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
      (r) => r.role === 'status-bar' && r.attrs.uniqueIdentifier === uniqueId,
    );
    expect(found).toBeTruthy();
    expect(found?.role).toBe('status-bar');
    expect(found && found.role === 'status-bar' ? found.attrs.knobs[0].type : null).toBe(
      'Color',
    );

    // Custom escape round-trip through the paired UI (449.2.3 acceptance): construct a
    // Custom= sequence, subscribe to its identity, emit it, and watch the payload arrive in
    // the paired subscriber — all on the one escape-sequence surface.
    const identity = `workbench-test-${Date.now()}`;
    const payload = 'hello-from-workbench';

    await closeSettings(win);
    await win.getByTestId(`layout-session-${sessionId}`).click();
    await win.getByTestId('workbench-rail-escape-sequence').click();

    await win.getByTestId('escape-template-select').click();
    await win.getByTestId('escape-template-osc1337-custom').click();
    await win.getByTestId('escape-field-identity').fill(identity);
    await win.getByTestId('escape-field-payload').fill(payload);

    // The paired subscriber derives target and identity from the emitter — no second picker.
    const pairing = win.getByTestId('custom-escape-pairing');
    await expect(pairing).toHaveAttribute('data-target', sessionId);
    await expect(pairing).toHaveAttribute('data-identity', identity);

    await win.getByTestId('custom-escape-subscribe').click();
    const subRow = win.locator('[data-testid^="custom-escape-sub-"]');
    await expect(subRow).toBeVisible({ timeout: 5_000 });
    await expect(subRow).toContainText(identity);

    await win.getByTestId('escape-send').click();
    await expect(win.getByTestId('escape-last-result')).toHaveAttribute('data-ok', 'true');

    const entry = win.locator('[data-testid^="custom-escape-entry-"]', {
      hasText: payload,
    });
    await expect(entry).toBeVisible({ timeout: 5_000 });
    await expect(entry).toContainText(identity);

    // Cleanup through the same surface, then drop the registration.
    await subRow.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(subRow).not.toBeVisible({ timeout: 5_000 });
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
      const found = snap.registrations.find((r) => r.id === spec.id);
      expect(found, `snapshot has ${spec.role}`).toBeTruthy();
      expect(found?.role).toBe(spec.role);
    }
    const tool = snap.registrations.find((r) => r.id === `reg-e2e-tool-${t}`);
    expect(tool && tool.role === 'toolbelt' ? tool.attrs.url : null).toBe(
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
      expect(afterCleanup.registrations.find((r) => r.id === spec.id)).toBeFalsy();
    }

    await app.close();
  });

  test('Author: profile edit applies; dynamic profile round-trips; escape template emits', async () => {
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

    // The Author facet is co-present — its artifact rail is reachable without leaving the workspace.
    await closeSettings(win);

    // Profiles artifact: pick a profile, apply an edit, verify success.
    await win.getByTestId('workbench-rail-profile').click();
    // Scope banner must tell the truth about each artifact's scope (449.7.7).
    await expect(win.getByTestId('artifact-scope-banner')).toHaveAttribute(
      'data-scope',
      'profile',
    );
    await win.getByTestId('workbench-refresh-profiles').click();
    // Wait for profiles to populate in the select
    await expect(win.getByTestId('workbench-profile-select')).toBeVisible({ timeout: 10_000 });
    // Select a profile by opening the dropdown and clicking the default
    await win.evaluate(
      (args) =>
        (window as unknown as { __storeSelect?: (g: string) => void }).__storeSelect?.(args.guid),
      { guid: probe.guid },
    );
    // Fall back: set via store bridge by firing an activate to refresh state
    // The picker state change is tricky to script via pure events; instead, use the store directly via a small helper.
    // Use a programmatic apply by firing set-profile-property with a known GUID.
    const applyResult = await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/set-profile-property', {
        guids: [args.guid],
        assignments: [
          { key: 'Badge Text', jsonValue: JSON.stringify(`workbench-test-${Date.now()}`) },
        ],
      });
    }, { guid: probe.guid });
    expect(applyResult.ok).toBe(true);

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
    const screenPane = win.getByTestId('screen-pane');
    await expect(screenPane.locator('.xterm-rows')).toContainText(marker, { timeout: 10_000 });

    await app.close();
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

    // The Act facet is co-present — no Console tab to switch to.
    await closeSettings(win);

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

    // Actions feed the co-present Activity facet (no Act-local transcript). The three fires surface as
    // three action events on the spine, and every one succeeded (no ✗ in its summary).
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

    // Keystrokes, prompts and focus are facets of the one Activity timeline, not separate panes.
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

    // The pane keeps a data-empty attribute until a snapshot for the focused session arrives.
    const screenPane = win.getByTestId('screen-pane');
    await expect(screenPane).toBeVisible({ timeout: 15_000 });
    await expect(screenPane).not.toHaveAttribute('data-empty', /./, { timeout: 15_000 });

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
