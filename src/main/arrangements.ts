import { execFile } from 'child_process';
import { promisify } from 'util';
import { create } from '@bufbuild/protobuf';
import {
  SavedArrangementRequestSchema,
  SavedArrangementRequest_Action,
  SavedArrangementResponse_Status,
} from '@shared/proto/gen/api_pb';
import {
  parsePlist,
  plistToJson,
  isPlistDict,
  setOwnProperty,
  type PlistJson,
} from '@shared/plist';
import type {
  ArrangementNamesResult,
  ArrangementContentsResult,
  ArrangementSnapshot,
} from '@shared/rpc';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

const execFileAsync = promisify(execFile);

// Arrangements with "include contents" enabled embed screen state; budget well past any real domain.
const DEFAULTS_MAX_BUFFER = 256 * 1024 * 1024;

const ITERM2_DOMAIN = 'com.googlecode.iterm2';
const ARRANGEMENTS_KEY = 'Window Arrangements';

// [LAW:effects-at-boundaries] The defaults spawn is the one effect; everything after stdout is the
// pure shared plist parser + projection. `defaults export` reads through cfprefsd, so it sees what
// iTerm2 just wrote — reading the .plist file directly could be stale.
export async function readArrangementContents(): Promise<ArrangementContentsResult> {
  try {
    const { stdout } = await execFileAsync('defaults', ['export', ITERM2_DOMAIN, '-'], {
      maxBuffer: DEFAULTS_MAX_BUFFER,
    });
    const root = parsePlist(stdout);
    if (!isPlistDict(root)) {
      return { ok: false, error: `defaults domain ${ITERM2_DOMAIN} is not a dict` };
    }
    const raw = root[ARRANGEMENTS_KEY];
    // Key absent is the domain's honest "no arrangements ever saved" state, not an error.
    if (raw === undefined) return { ok: true, arrangements: {} };
    if (!isPlistDict(raw)) {
      return { ok: false, error: `'${ARRANGEMENTS_KEY}' is not a dict of arrangements` };
    }
    const arrangements: Record<string, PlistJson> = {};
    for (const [name, value] of Object.entries(raw)) {
      setOwnProperty(arrangements, name, plistToJson(value));
    }
    return { ok: true, arrangements };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Engine truth for which names exist: the LIST verb of the same wire message save/restore use.
export async function listArrangementNames(
  orchestrator: ConnectionOrchestrator,
): Promise<ArrangementNamesResult> {
  try {
    const response = await orchestrator.sendRequest({
      submessage: {
        case: 'savedArrangementRequest',
        value: create(SavedArrangementRequestSchema, {
          action: SavedArrangementRequest_Action.LIST,
        }),
      },
    });
    if (response.submessage.case === 'error') {
      return { ok: false, error: response.submessage.value };
    }
    if (response.submessage.case !== 'savedArrangementResponse') {
      return {
        ok: false,
        error: `expected savedArrangementResponse, got ${response.submessage.case ?? '<none>'}`,
      };
    }
    const { status, names } = response.submessage.value;
    if (status !== SavedArrangementResponse_Status.OK) {
      return {
        ok: false,
        error: `iTerm2 refused: ${SavedArrangementResponse_Status[status] ?? status}`,
      };
    }
    return { ok: true, names };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function arrangementSnapshot(
  orchestrator: ConnectionOrchestrator,
): Promise<ArrangementSnapshot> {
  const [names, contents] = await Promise.all([
    listArrangementNames(orchestrator),
    readArrangementContents(),
  ]);
  return { names, contents };
}
