import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

export class AppleScriptError extends Error {
  constructor(
    message: string,
    readonly stderr: string = '',
  ) {
    super(message);
    this.name = 'AppleScriptError';
  }
}

export interface Credentials {
  cookie: string;
  key: string;
}

export class AppleScriptDriver {
  async requestCookieAndKey(
    advisoryName: string,
    reusable = false,
  ): Promise<Credentials> {
    if (advisoryName.includes('"') || advisoryName.includes('\\')) {
      throw new AppleScriptError(
        `advisoryName contains characters that cannot be AppleScript-escaped: ${advisoryName}`,
      );
    }

    const reusableClause = reusable ? ' reusable' : '';
    const script = `tell application "iTerm2" to request cookie${reusableClause} and key for app named "${advisoryName}"`;

    let stdout: string;
    try {
      const result = await pExecFile('/usr/bin/osascript', ['-e', script]);
      stdout = result.stdout;
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new AppleScriptError(
        `osascript failed: ${e.message}`,
        e.stderr ?? '',
      );
    }

    const trimmed = stdout.trim();
    const sep = trimmed.indexOf(' ');
    if (sep < 0) {
      throw new AppleScriptError(
        `osascript returned unexpected output: ${trimmed}`,
      );
    }

    return {
      cookie: trimmed.slice(0, sep),
      key: trimmed.slice(sep + 1),
    };
  }
}
