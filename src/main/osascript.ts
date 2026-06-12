import type { ActionResult, OsascriptLanguage, SdefTextResult } from '@shared/rpc';
import type { AppEntityRef } from '@shared/domain';
import { execFileAsync } from './execFileAsync';

// [LAW:effects-at-boundaries] osascript runs locally as a subprocess — no wire protocol involved.
// The action boundary is the same (ActionResult shape, action() spine append), but the effect is
// a child process, not a TCP message. `entity` is present because the action() wrapper requires it
// for the spine event; the subprocess itself is not session-scoped.
export async function actionOsascript(
  args: { entity: AppEntityRef; script: string; language: OsascriptLanguage },
): Promise<ActionResult> {
  const started = Date.now();
  if (!args.script.trim()) {
    return {
      ok: false,
      error: 'script is empty',
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'osascript',
      ['-l', args.language, '-e', args.script],
      // [LAW:no-ambient-temporal-coupling] SIGKILL (not SIGTERM) ensures the subprocess is
      // terminated even when osascript is blocked in a display dialog run-loop.
      { timeout: 30_000, killSignal: 'SIGKILL' },
    );
    return {
      ok: true,
      error: null,
      latencyMs: Date.now() - started,
      responseCase: null,
      requestId: null,
      payload: {
        result: stdout.trim(),
        ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
      },
    };
  } catch (err: unknown) {
    // execFile rejects on non-zero exit; stderr carries the AppleScript error message.
    const stderr = (err as { stderr?: string }).stderr?.trim();
    const message = stderr || (err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      error: message,
      latencyMs: Date.now() - started,
      responseCase: null,
      requestId: null,
      payload: null,
    };
  }
}

// [LAW:effects-at-boundaries] sdef output is static for a given iTerm2 version — one subprocess
// per main-process lifetime is the right cost. Concurrent calls share the in-flight Promise.
// Failures clear the cache so the next panel open retries cleanly.
// [LAW:no-silent-failure] The real error cause is propagated in SdefTextResult.error so the
// renderer can distinguish missing sdef binary, wrong app path, timeout, and permission errors.
let _sdefFetch: Promise<SdefTextResult> | null = null;

export function getSdefText(): Promise<SdefTextResult> {
  if (_sdefFetch !== null) return _sdefFetch;
  _sdefFetch = execFileAsync('sdef', ['/Applications/iTerm.app'], { timeout: 10_000 })
    .then(({ stdout }): SdefTextResult => ({ text: stdout, error: null }))
    .catch((err: unknown): SdefTextResult => {
      _sdefFetch = null; // clear so the next open retries
      const message = err instanceof Error ? err.message : String(err);
      console.error('[getSdefText] sdef subprocess failed:', message);
      return { text: null, error: message };
    });
  return _sdefFetch;
}
