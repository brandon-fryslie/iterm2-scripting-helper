import { ESCAPE_TEMPLATES } from './escape-sequences';
import type { EscapeTemplate } from './escape-sequences';
import type { AppActionKind } from './domain';

// The docs index is a searchable cross-reference over four catalogs — the iTerm2 Python API, the
// protobuf schema, the AppleScript scripting dictionary (sdef), and the OSC/CSI escape catalog.
// Every entry resolves to a place in the app you can act: a Workbench escape template or a Console
// action. That destination is carried as a value, never re-derived from the entry's prose.
export type DocSource = 'osc' | 'proto' | 'sdef' | 'python';

// [LAW:types-are-the-program] The deep-link target is the strongest true theorem about "where does
// this entry take you": exactly two shapes exist. An escape link always names a template (an escape
// editor without a template is meaningless); a console link always names an action. Neither illegal
// pairing — a template on a non-escape destination, or an action without one — is representable, so
// the navigator's exhaustive match needs no defensive arm. [LAW:dataflow-not-control-flow]
export type DocLink =
  | { kind: 'escape'; templateId: string }
  | { kind: 'console'; action: AppActionKind };

export interface DocEntry {
  // Stable across builds — derived from the source's own id so result rows have deterministic
  // test handles and React keys.
  id: string;
  source: DocSource;
  // The primary searchable name (proto message, Python symbol, OSC code + label).
  title: string;
  subtitle: string;
  // Extra search tokens — aliases and codes that are not in the title but a user would type.
  keywords: readonly string[];
  link: DocLink;
}

function oscTitle(t: EscapeTemplate): string {
  switch (t.group) {
    case 'osc-1337':
      return `OSC 1337 ${t.label}`;
    case 'osc-133':
      return `OSC 133 ${t.label}`;
    case 'osc-8':
      return `OSC 8 ${t.label}`;
    case 'csi':
      return `CSI ${t.label}`;
  }
}

// [LAW:one-source-of-truth] The OSC arm of the index is derived from ESCAPE_TEMPLATES, never a hand
// re-listing. A template added to the catalog appears here for free; one that is renamed cannot
// drift out of sync because there is no second copy to drift.
function oscEntries(): DocEntry[] {
  return ESCAPE_TEMPLATES.map((t) => ({
    id: `osc-${t.id}`,
    source: 'osc' as const,
    title: oscTitle(t),
    subtitle: t.description,
    keywords: [t.id, t.group, t.label],
    link: { kind: 'escape', templateId: t.id },
  }));
}

interface ActionDoc {
  source: Extract<DocSource, 'proto' | 'sdef'>;
  // The wire request message this action puts on the protocol — the name a reader of the protobuf
  // schema would search for. Empty for osascript, which is a local subprocess, not a wire message.
  protoMessage: string;
  subtitle: string;
  keywords: readonly string[];
}

// [LAW:types-are-the-program] A total Record over AppActionKind: a Console action added to the
// closed set in domain.ts cannot compile until it has a doc entry here, so the cross-reference can
// never silently fall behind the actions it indexes.
const ACTION_DOCS: Record<AppActionKind, ActionDoc> = {
  'send-text': {
    source: 'proto',
    protoMessage: 'SendTextRequest',
    subtitle: 'Send text to the focused session as if typed.',
    keywords: ['type', 'input', 'keystrokes'],
  },
  inject: {
    source: 'proto',
    protoMessage: 'InjectRequest',
    subtitle: "Inject raw bytes into the session's terminal input.",
    keywords: ['bytes', 'raw', 'feed'],
  },
  activate: {
    source: 'proto',
    protoMessage: 'ActivateRequest',
    subtitle: 'Bring a window, tab, session, or the app to the front.',
    keywords: ['focus', 'front', 'select', 'raise'],
  },
  'menu-item': {
    source: 'proto',
    protoMessage: 'MenuItemRequest',
    subtitle: 'Invoke an application menu item by identifier.',
    keywords: ['menu', 'command'],
  },
  'invoke-function': {
    source: 'proto',
    protoMessage: 'InvokeFunctionRequest',
    subtitle: 'Call a registered RPC / Python API function by invocation.',
    keywords: ['rpc', 'function', 'call', 'invocation'],
  },
  'restart-session': {
    source: 'proto',
    protoMessage: 'RestartSessionRequest',
    subtitle: "Restart the session's program.",
    keywords: ['restart', 'relaunch'],
  },
  close: {
    source: 'proto',
    protoMessage: 'CloseRequest',
    subtitle: 'Close sessions, tabs, or windows.',
    keywords: ['kill', 'quit', 'terminate'],
  },
  'saved-arrangement': {
    source: 'proto',
    protoMessage: 'SavedArrangementRequest',
    subtitle: 'Save or restore a named window arrangement.',
    keywords: ['arrangement', 'layout', 'save', 'restore'],
  },
  'set-broadcast-domains': {
    source: 'proto',
    protoMessage: 'SetBroadcastDomainsRequest',
    subtitle: 'Set which sessions receive broadcast input.',
    keywords: ['broadcast', 'domains', 'input'],
  },
  'get-selection': {
    source: 'proto',
    protoMessage: 'SelectionRequest.GetSelectionRequest',
    subtitle: 'Read the selected text range from a session.',
    keywords: ['selection', 'copy', 'read'],
  },
  'set-selection': {
    source: 'proto',
    protoMessage: 'SelectionRequest.SetSelectionRequest',
    subtitle: 'Set the selected text range in a session.',
    keywords: ['selection', 'highlight', 'write'],
  },
  transaction: {
    source: 'proto',
    protoMessage: 'TransactionRequest',
    subtitle: 'Begin or end an atomic batch of API calls.',
    keywords: ['transaction', 'atomic', 'batch'],
  },
  osascript: {
    source: 'sdef',
    protoMessage: '',
    subtitle: "Run AppleScript or JXA against iTerm2's scripting dictionary.",
    keywords: ['applescript', 'jxa', 'osascript', 'sdef', 'dictionary', 'scripting', 'tell application'],
  },
  'raw-protobuf': {
    source: 'proto',
    protoMessage: 'ClientOriginatedMessage',
    subtitle: 'Send a hand-authored ClientOriginatedMessage envelope on the wire.',
    keywords: ['raw', 'protobuf', 'envelope', 'wire'],
  },
  'tmux-send-command': {
    source: 'proto',
    protoMessage: 'TmuxRequest.SendCommand',
    subtitle: 'Send a command to a tmux integration connection.',
    keywords: ['tmux', 'command'],
  },
  'tmux-create-window': {
    source: 'proto',
    protoMessage: 'TmuxRequest.CreateWindow',
    subtitle: 'Create a window in a tmux integration connection.',
    keywords: ['tmux', 'window', 'create'],
  },
  'tmux-set-window-visible': {
    source: 'proto',
    protoMessage: 'TmuxRequest.SetWindowVisible',
    subtitle: 'Show or hide a tmux integration window.',
    keywords: ['tmux', 'visible', 'hide', 'show'],
  },
  'get-preference': {
    source: 'proto',
    protoMessage: 'PreferencesRequest',
    subtitle: 'Read an iTerm2 preference value by key.',
    keywords: ['preference', 'setting', 'defaults'],
  },
  'apply-color-preset': {
    source: 'proto',
    protoMessage: 'ColorPresetRequest',
    subtitle: 'Apply a color preset to profiles.',
    keywords: ['color', 'preset', 'theme', 'profile'],
  },
};

function actionEntries(): DocEntry[] {
  // Object.entries over the total Record yields every AppActionKind; the cast restores the key type
  // the Record guarantees but Object.entries widens to string.
  return (Object.entries(ACTION_DOCS) as Array<[AppActionKind, ActionDoc]>).map(
    ([action, doc]) => ({
      id: `${doc.source}-${action}`,
      source: doc.source,
      title: doc.protoMessage || `osascript (${action})`,
      subtitle: doc.subtitle,
      keywords: [action, ...doc.keywords],
      link: { kind: 'console', action },
    }),
  );
}

interface PythonDoc {
  symbol: string;
  subtitle: string;
  keywords: readonly string[];
  action: AppActionKind;
}

// Curated, not derived: the iTerm2 Python API has no in-repo manifest to derive from, so these are
// hand-authored mappings from a Python API symbol to the in-app action that achieves the same
// effect. Each links to a real Console action, so the index cannot point at a destination that does
// not exist.
const PYTHON_DOCS: readonly PythonDoc[] = [
  {
    symbol: 'Session.async_send_text',
    subtitle: 'Python API equivalent of the Send text action.',
    keywords: ['python', 'send', 'text', 'type'],
    action: 'send-text',
  },
  {
    symbol: 'Session.async_inject',
    subtitle: 'Python API equivalent of the Inject action.',
    keywords: ['python', 'inject', 'bytes'],
    action: 'inject',
  },
  {
    symbol: 'Window.async_activate',
    subtitle: 'Python API equivalent of the Activate action (also Tab/Session/App).',
    keywords: ['python', 'activate', 'focus', 'front'],
    action: 'activate',
  },
  {
    symbol: 'MainMenu.async_select_menu_item',
    subtitle: 'Python API equivalent of the Menu item action.',
    keywords: ['python', 'menu', 'select'],
    action: 'menu-item',
  },
  {
    symbol: 'iterm2.async_invoke_function',
    subtitle: 'Python API equivalent of the Invoke function action.',
    keywords: ['python', 'invoke', 'rpc', 'function'],
    action: 'invoke-function',
  },
  {
    symbol: 'Session.async_restart',
    subtitle: 'Python API equivalent of the Restart action.',
    keywords: ['python', 'restart'],
    action: 'restart-session',
  },
  {
    symbol: 'Session.async_close',
    subtitle: 'Python API equivalent of the Close action.',
    keywords: ['python', 'close', 'kill'],
    action: 'close',
  },
  {
    symbol: 'Arrangement.async_save',
    subtitle: 'Python API equivalent of the Arrangement action.',
    keywords: ['python', 'arrangement', 'save', 'restore'],
    action: 'saved-arrangement',
  },
];

function pythonEntries(): DocEntry[] {
  return PYTHON_DOCS.map((d) => ({
    id: `python-${d.action}`,
    source: 'python' as const,
    title: d.symbol,
    subtitle: d.subtitle,
    keywords: d.keywords,
    link: { kind: 'console', action: d.action },
  }));
}

// [LAW:effects-at-boundaries] A pure builder: same inputs, same index, no IO. The renderer builds
// it once at module load; tests build it freely.
export function buildDocIndex(): DocEntry[] {
  return [...oscEntries(), ...actionEntries(), ...pythonEntries()];
}

function haystackScore(entry: DocEntry, token: string): number {
  // Title matches outrank keyword matches, which outrank subtitle matches — so "SendTextRequest"
  // lands on its own row before a row that merely mentions it in prose.
  if (entry.title.toLowerCase().includes(token)) return 3;
  if (entry.keywords.some((k) => k.toLowerCase().includes(token))) return 2;
  if (entry.subtitle.toLowerCase().includes(token)) return 1;
  return 0;
}

// [LAW:effects-at-boundaries] Pure ranked filter. An entry survives only if every query token hits
// somewhere (AND semantics), so "OSC 1337 SetMark" narrows to the one template that satisfies all
// three tokens. Empty query returns the whole index in build order.
export function searchDocs(entries: readonly DocEntry[], query: string): DocEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...entries];
  const scored: Array<{ entry: DocEntry; score: number }> = [];
  for (const entry of entries) {
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const score = haystackScore(entry, token);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (matchedAll) scored.push({ entry, score: total });
  }
  // Array.sort is stable, so ties keep build order — deterministic results for a given query.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}
