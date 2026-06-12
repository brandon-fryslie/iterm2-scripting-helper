import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ActionResult, OsascriptLanguage } from '@shared/rpc';
import type { AppEntityRef } from '@shared/domain';

const execFileAsync = promisify(execFile);

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
      { timeout: 30_000 },
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

export async function getSdefText(): Promise<{ text: string | null }> {
  try {
    const { stdout } = await execFileAsync('sdef', ['/Applications/iTerm.app'], {
      timeout: 10_000,
    });
    return { text: stdout };
  } catch {
    return { text: null };
  }
}
