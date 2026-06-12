import { execFile } from 'child_process';
import { promisify } from 'util';
import { parsePlist, plistToJson, isPlistDict, type PlistJson } from '@shared/plist';
import type { KeyBindingsSnapshot, SnippetEntry, KeyBindingEntry } from '@shared/rpc';

const execFileAsync = promisify(execFile);

const ITERM2_DOMAIN = 'com.googlecode.iterm2';
const DEFAULTS_MAX_BUFFER = 32 * 1024 * 1024;

// Paste-relevant preference keys surfaced for scripting context: these control the behavior
// of PasteRequest and the "Paste Special" family of key actions.
const PASTE_KEYS = [
  'PasteSpecialBracketedPasteMode',
  'PasteSpecialActLikeDefaultPaste',
  'PasteSpecialRemoveControlCodes',
  'PasteSpecialUseRegexSubstitution',
  'PasteSpecialRegexSubstitutionPattern',
  'PasteSpecialRegexSubstitutionReplacement',
  'PasteSpecialTabTransform',
  'PasteSpecialSpacesPerTab',
  'PasteSpecialDelay',
  'QuickPasteSize',
  'LimitPasteSpeed',
  'NumberOfLinesForSlowPaste',
  'WaitBetweenPastes',
  'PasteSpecialChunkSize',
  'PasteSpecialChunkDelay',
];

// [LAW:effects-at-boundaries] One spawn of `defaults export`; all structure extraction is pure.
export async function readKeyBindingsSnapshot(): Promise<KeyBindingsSnapshot> {
  try {
    const { stdout } = await execFileAsync('defaults', ['export', ITERM2_DOMAIN, '-'], {
      maxBuffer: DEFAULTS_MAX_BUFFER,
    });

    const root = parsePlist(stdout);
    if (!isPlistDict(root)) {
      return { ok: false, error: `defaults domain root is not a dict` };
    }

    const globalBindings = extractKeyMap(root['GlobalKeyMap']);
    const snippets = extractSnippets(root['Snippets']);
    const pasteConfig = extractPasteConfig(root);

    return { ok: true, globalBindings, snippets, pasteConfig };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function extractKeyMap(raw: unknown): KeyBindingEntry[] {
  if (!isPlistDict(raw as never)) return [];
  const entries: KeyBindingEntry[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPlistDict(value as never)) continue;
    const dict = value as Record<string, unknown>;
    const action = typeof dict['Action'] === 'number' ? dict['Action'] : 0;
    const parameter = typeof dict['Parameter'] === 'string' ? dict['Parameter'] : '';
    const label = typeof dict['Label'] === 'string' ? dict['Label'] : '';
    const version = typeof dict['Version'] === 'number' ? dict['Version'] : 0;
    entries.push({ key, action, parameter, label, version });
  }
  // Stable order: sort by encoded key so the list is deterministic across reads.
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function extractSnippets(raw: unknown): SnippetEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: SnippetEntry[] = [];
  for (const item of raw) {
    if (!isPlistDict(item as never)) continue;
    const dict = item as Record<string, unknown>;
    const title = typeof dict['Title'] === 'string' ? dict['Title'] : '(untitled)';
    const value = typeof dict['Value'] === 'string' ? dict['Value'] : '';
    const tags = Array.isArray(dict['Tags'])
      ? dict['Tags'].filter((t): t is string => typeof t === 'string')
      : [];
    entries.push({ title, value, tags });
  }
  return entries;
}

function extractPasteConfig(root: Record<string, unknown>): Record<string, PlistJson> {
  const out: Record<string, PlistJson> = {};
  for (const key of PASTE_KEYS) {
    if (key in root) {
      out[key] = plistToJson(root[key] as never);
    }
  }
  return out;
}
