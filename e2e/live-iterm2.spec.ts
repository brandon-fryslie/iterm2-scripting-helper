import { test, expect } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { launchApp } from './launch-app';

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
    const app = await launchApp();
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.

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
    const app = await launchApp();
    const win = await app.firstWindow();

    // A focus ref forwarded to the main process as a MobX proxy fails structured
    // clone ("could not be cloned"), silently rejecting monitor/focus-variables.
    const cloneErrors: string[] = [];
    win.on('pageerror', (e) => cloneErrors.push(String(e)));
    win.on('console', (m) => {
      if (m.type() === 'error') cloneErrors.push(m.text());
    });

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

    await win.getByTestId('tab-trigger-monitor').click();
    await expect(win.getByTestId('layout-pane')).toBeVisible();
    await expect(win.getByTestId('variables-pane')).toBeVisible();
    // Footer panes are tabbed; each mounts only while its tab is active.
    await win.getByRole('tab', { name: 'Wire' }).click();
    await expect(win.getByTestId('wire-pane')).toBeVisible();
    await win.getByRole('tab', { name: 'Notifications' }).click();
    await expect(win.getByTestId('notifications-pane')).toBeVisible();

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

    // A multi-reference interpolated template is rejected with context, not a misleading null.
    await probe.getByTestId('variable-probe-input').fill('\\(session.name)/\\(session.username)');
    await probe.getByTestId('variable-probe-submit').click();
    await expect(probeResult).toHaveAttribute('data-outcome', 'error', { timeout: 10_000 });

    expect(cloneErrors.filter((e) => /could not be cloned/i.test(e))).toEqual([]);

    await app.close();
  });

  test('Workbench v2: status-bar registration + custom-escape subscriber round-trip', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

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
        statusBar: {
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
      (r) => r.statusBar?.uniqueIdentifier === uniqueId,
    );
    expect(found).toBeTruthy();
    expect(found?.role).toBe('status-bar');
    expect(found?.statusBar?.knobs[0].type).toBe('Color');

    // Subscribe to custom escape on the focused session with an identity filter
    const identity = `workbench-test-${Date.now()}`;
    const subResult = await win.evaluate(async (args) => {
      return window.ipc.invoke('workbench/subscribe-custom-escape', {
        sessionId: args.sessionId,
        identity: args.identity,
      });
    }, { sessionId, identity });
    expect(subResult.ok).toBe(true);
    expect(subResult.subscriptionId).toBeTruthy();

    // Inject an OSC 1337 Custom= payload as terminal output (not typed input,
    // which would just go to the shell) and expect it to surface in the
    // subscriber log.
    const payload = 'hello-from-workbench';
    const sequence = `\x1b]1337;Custom=id=${identity}:${payload}\x1b\\`;
    const bytesHex = Array.from(new TextEncoder().encode(sequence))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await win.evaluate(async (args) => {
      return window.ipc.invoke('actions/inject', {
        sessionIds: [args.sessionId],
        bytesHex: args.bytesHex,
      });
    }, { sessionId, bytesHex });

    await expect(async () => {
      const snap = await win.evaluate(() =>
        window.ipc.invoke('workbench/custom-escape', undefined as never),
      );
      const matching = snap.entries.find(
        (e) => e.identity === identity && e.payload.includes(payload),
      );
      expect(matching).toBeTruthy();
    }).toPass({ timeout: 5000 });

    // Cleanup
    const subscriptionId = subResult.subscriptionId ?? '';
    const regId = regResult.registrationId ?? '';
    await win.evaluate(async (args) => {
      await window.ipc.invoke('workbench/unsubscribe-custom-escape', {
        subscriptionId: args.subscriptionId,
      });
      await window.ipc.invoke('workbench/unregister-rpc', { id: args.regId });
    }, { subscriptionId, regId });

    await app.close();
  });

  test('Workbench: profile edit applies; dynamic profile round-trips; escape template emits', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

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

    await win.getByTestId('tab-trigger-workbench').click();

    // Profiles tab: pick a profile, apply an edit, verify success.
    await win.getByTestId('workbench-rail-profile').click();
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

    // Escape Sequence: build a SetMark sequence and emit to session.
    await win.getByTestId('workbench-rail-escape-sequence').click();
    const emit = await win.evaluate(async (args) => {
      const text = '\x1b]1337;SetMark\x1b\\';
      return window.ipc.invoke('actions/send-text', {
        sessionId: args.sessionId,
        text,
      });
    }, { sessionId: probe.sessionId });
    expect(emit.ok).toBe(true);

    await app.close();
  });

  test('Console: send text + activate + snippet re-fires', async () => {
    const app = await launchApp();
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.
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
      const first = t?.root?.children?.[0];
      const sessionId = first?.kind === 'session' ? first.session.sessionId : '';
      return { sessionId, tabId: t?.tabId ?? '' };
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
    const app = await launchApp();
    const win = await app.firstWindow();

    await win.getByTestId('tab-trigger-settings').click();
    // App auto-connects on startup (main.ts); wait for the negotiated session to be ready.
    await expect(win.getByTestId('connection-state-badge')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

    await win.getByTestId('tab-trigger-monitor').click();
    // Footer panes are tabbed; each mounts only while its tab is active.
    await expect(win.getByTestId('keystrokes-pane')).toBeVisible();
    await win.getByRole('tab', { name: 'Prompts' }).click();
    await expect(win.getByTestId('prompts-pane')).toBeVisible();
    await win.getByRole('tab', { name: 'Focus' }).click();
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
