import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, repoRoot } from './launch-app';

const SAMPLE_FIXTURE = path.join(repoRoot, 'e2e/fixtures/sample-wire-log.ndjson');

test('a recorded wire-log fixture replays against the disconnected timeline', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('entity-workspace')).toBeVisible();

  // Replay-only mode: tear down any live connection first so the spine belongs to the fixture, not to
  // iTerm2. Disconnect settles its teardown synchronously, so the replay that follows cannot be wiped
  // by a late close.
  const replay = await win.evaluate(async (fixturePath) => {
    await window.ipc.invoke('connection/disconnect', undefined as never);
    return window.ipc.invoke('fixture/replay', { path: fixturePath });
  }, SAMPLE_FIXTURE);

  // The IPC reports exactly what was restored — the wire-log span, against no connection.
  expect(replay).toEqual({ ok: true, path: SAMPLE_FIXTURE, eventCount: 5 });

  // The disconnected timeline projects the recorded frames; the polling timeline picks them up.
  const frameRows = win.locator('[data-testid^="activity-row-"][data-facet="frame"]');
  await expect(frameRows).toHaveCount(4, { timeout: 10_000 });
  await expect(
    win.locator('[data-testid^="activity-row-"][data-facet="notification"]'),
  ).toHaveCount(1);

  // The recorded SetProfilePropertyRequest frame is one of them — the round-trip the fixture captured.
  await expect(win.getByText('setProfilePropertyRequest').first()).toBeVisible();

  await app.close();
});

test('replay is refused while connected, leaving the live spine intact', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  const app = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('entity-workspace')).toBeVisible();

  // Drive the connection to a live state. If no iTerm2 is present the connect lands in 'error' (a
  // non-live state replay accepts), so this assertion only bites when a connection actually succeeds —
  // it never falsely fails on a machine without iTerm2.
  const outcome = await win.evaluate(async (fixturePath) => {
    const snap = await window.ipc.invoke('connection/connect', undefined as never);
    const replay = await window.ipc.invoke('fixture/replay', { path: fixturePath });
    return { state: snap.state, replay };
  }, SAMPLE_FIXTURE);

  const live = ['detecting', 'requesting-cookie', 'connecting', 'ready'].includes(outcome.state);
  test.skip(!live, 'no live iTerm2 connection available to exercise the refusal path');
  const { replay } = outcome;
  expect(replay.ok).toBe(false);
  if (!replay.ok) expect(replay.error).toMatch(/cannot replay while connected/);

  await app.close();
});
