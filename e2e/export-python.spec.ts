import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

// The acceptance bar for 449.4.3: "an exported Python stub runs unchanged in
// ~/Library/Application Support/iTerm2/Scripts/." This drives the real export IPC end-to-end (code
// generation + the file write at the boundary) with an explicit path — the same automation hook the
// replay spec uses — then byte-compiles the written file with python3 as the deterministic proxy for
// "runs unchanged". No iTerm2 connection is needed: a registration stub is authored offline.
test('an exported registration stub is written and compiles as valid Python 3', async () => {
  test.skip(
    process.env.CI === 'true',
    'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
  );

  let python: string | null = null;
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    python = 'python3';
  } catch {
    python = null;
  }
  test.skip(python === null, 'python3 not available to compile the exported stub');

  const target = path.join(mkdtempSync(path.join(tmpdir(), 'pystub-e2e-')), 'status_clock.py');

  const app = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('entity-workspace')).toBeVisible();

  const result = await win.evaluate(
    (outPath) =>
      window.ipc.invoke('registration/export-python', {
        path: outPath,
        body: {
          role: 'status-bar',
          name: 'status_clock',
          arguments: ['session_id'],
          defaults: [{ name: 'session_id', path: 'id' }],
          timeout: 0,
          responseTemplate: '"12:00"',
          attrs: {
            shortDescription: 'Clock',
            detailedDescription: 'Shows the time',
            knobs: [
              {
                name: 'Tint',
                type: 'Color',
                placeholder: 'Pick',
                jsonDefaultValue: JSON.stringify({
                  'Red Component': 0.2,
                  'Green Component': 0.6,
                  'Blue Component': 1,
                  'Alpha Component': 1,
                }),
                key: 'tint',
              },
            ],
            exemplar: '12:34',
            updateCadence: 1,
            uniqueIdentifier: 'com.example.clock',
            format: 'PLAIN_TEXT',
          },
        },
      }),
    target,
  );

  // The IPC reports the written path and nothing fabricated.
  expect(result).toEqual({ ok: true, path: target });

  // The file iTerm2 would run is real, names the verified API, and byte-compiles without error.
  const source = readFileSync(target, 'utf8');
  expect(source).toContain('@iterm2.StatusBarRPC');
  expect(source).toContain('await component.async_register(connection, status_clock)');
  expect(source).toContain('iterm2.run_forever(main)');
  expect(() =>
    execFileSync(python as string, ['-m', 'py_compile', target], { stdio: 'pipe' }),
  ).not.toThrow();

  await app.close();
});
