import type { RpcMethod } from './rpc';
import type { AppActionKind } from './domain';
import type { LensId } from './lenses';
import { ESCAPE_TEMPLATES } from './escape-sequences';
import type { EscapeTemplate } from './escape-sequences';
import { TEMPLATE_TARGETS } from './templateDesigner';

// [LAW:types-are-the-program] The deep-link target is the strongest true theorem about "where does this
// capability take you": exactly three shapes exist. An escape link names a template (an escape editor
// without a template is meaningless); a console link names an action; a lens link names a workspace lens
// (the home where a read capability's data surfaces). No illegal pairing is representable, so the
// navigator's exhaustive match needs no defensive arm. [LAW:dataflow-not-control-flow]
export type DocLink =
  | { kind: 'escape'; templateId: string }
  | { kind: 'console'; action: AppActionKind }
  | { kind: 'lens'; lens: LensId };

// [LAW:types-are-the-program] read vs mutate is a domain fact about the capability — does invoking it
// change iTerm2's state — NOT a UI guess re-derived from a method prefix. It cannot be derived from the
// namespace: within actions/* `get-selection` reads while `send-text` mutates; within monitor/*
// `set-watched` mutates while `variables` reads. So each catalog entry declares it.
export type CapabilityKind = 'read' | 'mutate';

// The capability's API family. For an RPC capability this is exactly the method's namespace (the part
// before the slash) — derived from the one source, the method key, never hand-repeated. Escape and
// template capabilities are their own families, joined into the same catalog.
export type CapabilityGroup =
  | 'system'
  | 'connection'
  | 'monitor'
  | 'fixture'
  | 'registration'
  | 'fleet'
  | 'actions'
  | 'workbench'
  | 'escape'
  | 'template';

// The unit the Explorer renders and searches: one capability of the API surface, with its typed kind,
// a searchable wire reference (proto message / result type / OSC code), and an optional deep-link to the
// place you can try it. A null link is the honest "this capability has no in-app destination" (app
// lifecycle / dev-tooling methods) — never a fake target.
export interface Capability {
  // Stable, unique across the whole catalog — deterministic test handles and React keys.
  id: string;
  // The canonical identifier: the RpcMethod key, the escape template id, or the template-target id.
  ref: string;
  title: string;
  kind: CapabilityKind;
  group: CapabilityGroup;
  summary: string;
  // The wire name a reader of the protobuf/Python API would search for (SendTextRequest, VariableSnapshot,
  // OSC 1337). Scored like the title so searching the wire name lands on its own row.
  reference: string;
  keywords: readonly string[];
  link: DocLink | null;
}

interface RpcCapabilityMeta {
  title: string;
  kind: CapabilityKind;
  summary: string;
  reference: string;
  keywords: readonly string[];
  link: DocLink | null;
}

// [LAW:one-source-of-truth] [LAW:types-are-the-program] A total Record over RpcMethod: every one of the
// 55 wire methods has exactly one catalog entry, and a method added to RpcSchema cannot compile until it
// is classified here. This compile-time totality IS the exhaustiveness guarantee — not a test bolted on
// after. The 19 actions/* link into the Console form that fires them; read methods link to the lens
// where their data lives; app-lifecycle methods (ping, connect, focus) carry a null link because they
// have no in-app destination to "try".
const RPC_CAPABILITIES: Record<RpcMethod, RpcCapabilityMeta> = {
  'system/ping': {
    title: 'Ping',
    kind: 'read',
    summary: 'Round-trip health check of the renderer↔main IPC bridge.',
    reference: 'system/ping',
    keywords: ['ping', 'health', 'ipc', 'self-test'],
    link: null,
  },
  'system/open-automation-settings': {
    title: 'Open Automation settings',
    kind: 'mutate',
    summary: 'Open macOS System Settings → Privacy & Security → Automation to grant permission.',
    reference: 'Automation permission',
    keywords: ['automation', 'permission', 'tcc', 'privacy', 'settings'],
    link: null,
  },
  'connection/snapshot': {
    title: 'Connection snapshot',
    kind: 'read',
    summary: "Read the current connection state to iTerm2's API socket.",
    reference: 'ConnectionSnapshot',
    keywords: ['connection', 'state', 'socket', 'status'],
    link: null,
  },
  'connection/connect': {
    title: 'Connect',
    kind: 'mutate',
    summary: "Open the WebSocket connection to iTerm2's Python API.",
    reference: 'ConnectionSnapshot',
    keywords: ['connect', 'socket', 'open'],
    link: null,
  },
  'connection/disconnect': {
    title: 'Disconnect',
    kind: 'mutate',
    summary: "Close the WebSocket connection to iTerm2's Python API.",
    reference: 'ConnectionSnapshot',
    keywords: ['disconnect', 'socket', 'close'],
    link: null,
  },
  'connection/list-sessions': {
    title: 'List sessions',
    kind: 'read',
    summary: 'Enumerate the live windows, tabs, and sessions iTerm2 reports.',
    reference: 'ListSessionsSummary',
    keywords: ['sessions', 'list', 'layout', 'windows', 'tabs'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/layout': {
    title: 'Layout',
    kind: 'read',
    summary: 'The window/tab/session tree of the live iTerm2 layout.',
    reference: 'LayoutSnapshot',
    keywords: ['layout', 'tree', 'windows', 'tabs', 'sessions'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/variables': {
    title: 'Variables',
    kind: 'read',
    summary: "The focused entity's live iTerm2 variable scope.",
    reference: 'VariableSnapshot',
    keywords: ['variables', 'scope', 'interpolation'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/events': {
    title: 'Event spine',
    kind: 'read',
    summary: 'The whole retained event log — frames, notifications, actions, invocations.',
    reference: 'AppEventLogSnapshot',
    keywords: ['events', 'spine', 'timeline', 'log', 'activity'],
    link: { kind: 'lens', lens: 'events' },
  },
  'fixture/capture': {
    title: 'Capture fixture',
    kind: 'mutate',
    summary: 'Save a span of the wire log as replayable NDJSON.',
    reference: 'FixtureFileResult',
    keywords: ['fixture', 'capture', 'record', 'ndjson', 'replay'],
    link: { kind: 'lens', lens: 'events' },
  },
  'fixture/replay': {
    title: 'Replay fixture',
    kind: 'mutate',
    summary: 'Replay a recorded fixture into the disconnected event spine.',
    reference: 'FixtureFileResult',
    keywords: ['fixture', 'replay', 'playback'],
    link: { kind: 'lens', lens: 'events' },
  },
  'registration/export-python': {
    title: 'Export Python stub',
    kind: 'mutate',
    summary: 'Export an RPC registration as a runnable iTerm2 Python script.',
    reference: 'FileExportResult',
    keywords: ['python', 'export', 'stub', 'registration', 'script'],
    link: { kind: 'lens', lens: 'build' },
  },
  'monitor/focus-session': {
    title: 'Focus session',
    kind: 'mutate',
    summary: 'Set which session the workspace observes and acts against.',
    reference: 'monitor/focus-session',
    keywords: ['focus', 'session', 'select'],
    link: null,
  },
  'monitor/focus-variables': {
    title: 'Focus variables',
    kind: 'read',
    summary: "Read a chosen entity's variable scope without changing focus.",
    reference: 'VariableSnapshot',
    keywords: ['variables', 'focus', 'entity', 'scope'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/probe-variable': {
    title: 'Probe variable',
    kind: 'read',
    summary: "Evaluate a \\(…) interpolation expression against iTerm2's own evaluator.",
    reference: 'AppProbeResult',
    keywords: ['probe', 'variable', 'interpolation', 'evaluate', 'expression'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/watchlist': {
    title: 'Watchlist',
    kind: 'read',
    summary: 'The set of variables subscribed for live change notifications.',
    reference: 'WatchlistSnapshot',
    keywords: ['watchlist', 'watch', 'subscribe', 'variables'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/set-watched': {
    title: 'Set watched',
    kind: 'mutate',
    summary: 'Add or remove a variable from the live watchlist.',
    reference: 'WatchlistSnapshot',
    keywords: ['watch', 'unwatch', 'watchlist', 'subscribe'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/screen': {
    title: 'Screen contents',
    kind: 'read',
    summary: "A snapshot of the focused session's terminal screen with cell colors.",
    reference: 'ScreenSnapshot',
    keywords: ['screen', 'grid', 'cells', 'mirror', 'contents'],
    link: { kind: 'lens', lens: 'inspect' },
  },
  'monitor/prompts': {
    title: 'Prompts',
    kind: 'read',
    summary: 'The last OSC-133 shell prompt per session, across the fleet.',
    reference: 'PromptSnapshot',
    keywords: ['prompt', 'osc133', 'shell', 'command'],
    link: { kind: 'lens', lens: 'fleet' },
  },
  'fleet/refresh': {
    title: 'Refresh fleet',
    kind: 'mutate',
    summary: 'Trigger a coalesced sweep of every live session for the fleet snapshot.',
    reference: 'FleetSnapshot',
    keywords: ['fleet', 'refresh', 'sweep', 'sessions'],
    link: { kind: 'lens', lens: 'fleet' },
  },
  'actions/send-text': {
    title: 'Send text',
    kind: 'mutate',
    summary: 'Send text to the focused session as if typed.',
    reference: 'SendTextRequest',
    keywords: ['type', 'input', 'keystrokes', 'python', 'Session.async_send_text', 'async_send_text'],
    link: { kind: 'console', action: 'send-text' },
  },
  'actions/inject': {
    title: 'Inject bytes',
    kind: 'mutate',
    summary: "Inject raw bytes into the session's terminal input.",
    reference: 'InjectRequest',
    keywords: ['bytes', 'raw', 'feed', 'python', 'Session.async_inject', 'async_inject'],
    link: { kind: 'console', action: 'inject' },
  },
  'actions/activate': {
    title: 'Activate',
    kind: 'mutate',
    summary: 'Bring a window, tab, session, or the app to the front.',
    reference: 'ActivateRequest',
    keywords: ['focus', 'front', 'select', 'raise', 'python', 'Window.async_activate', 'async_activate'],
    link: { kind: 'console', action: 'activate' },
  },
  'actions/menu-item': {
    title: 'Menu item',
    kind: 'mutate',
    summary: 'Invoke an application menu item by identifier (queryOnly reads its state).',
    reference: 'MenuItemRequest',
    keywords: ['menu', 'command', 'python', 'MainMenu.async_select_menu_item', 'async_select_menu_item'],
    link: { kind: 'console', action: 'menu-item' },
  },
  'actions/invoke-function': {
    title: 'Invoke function',
    kind: 'mutate',
    summary: 'Call a registered RPC / Python API function by invocation.',
    reference: 'InvokeFunctionRequest',
    keywords: ['rpc', 'function', 'call', 'invocation', 'python', 'iterm2.async_invoke_function', 'async_invoke_function'],
    link: { kind: 'console', action: 'invoke-function' },
  },
  'actions/restart-session': {
    title: 'Restart session',
    kind: 'mutate',
    summary: "Restart the session's program.",
    reference: 'RestartSessionRequest',
    keywords: ['restart', 'relaunch', 'python', 'Session.async_restart', 'async_restart'],
    link: { kind: 'console', action: 'restart-session' },
  },
  'actions/close': {
    title: 'Close',
    kind: 'mutate',
    summary: 'Close sessions, tabs, or windows.',
    reference: 'CloseRequest',
    keywords: ['kill', 'quit', 'terminate', 'python', 'Session.async_close', 'async_close'],
    link: { kind: 'console', action: 'close' },
  },
  'actions/saved-arrangement': {
    title: 'Saved arrangement',
    kind: 'mutate',
    summary: 'Save or restore a named window arrangement.',
    reference: 'SavedArrangementRequest',
    keywords: ['arrangement', 'layout', 'save', 'restore', 'python', 'Arrangement.async_save', 'async_save'],
    link: { kind: 'console', action: 'saved-arrangement' },
  },
  'actions/set-broadcast-domains': {
    title: 'Set broadcast domains',
    kind: 'mutate',
    summary: 'Set which sessions receive broadcast input.',
    reference: 'SetBroadcastDomainsRequest',
    keywords: ['broadcast', 'domains', 'input'],
    link: { kind: 'console', action: 'set-broadcast-domains' },
  },
  'actions/get-selection': {
    title: 'Get selection',
    kind: 'read',
    summary: 'Read the selected text range from a session.',
    reference: 'SelectionRequest.GetSelectionRequest',
    keywords: ['selection', 'copy', 'read'],
    link: { kind: 'console', action: 'get-selection' },
  },
  'actions/set-selection': {
    title: 'Set selection',
    kind: 'mutate',
    summary: 'Set the selected text range in a session.',
    reference: 'SelectionRequest.SetSelectionRequest',
    keywords: ['selection', 'highlight', 'write'],
    link: { kind: 'console', action: 'set-selection' },
  },
  'actions/transaction': {
    title: 'Transaction',
    kind: 'mutate',
    summary: 'Begin or end an atomic batch of API calls.',
    reference: 'TransactionRequest',
    keywords: ['transaction', 'atomic', 'batch'],
    link: { kind: 'console', action: 'transaction' },
  },
  'actions/osascript': {
    title: 'osascript',
    kind: 'mutate',
    summary: "Run AppleScript or JXA against iTerm2's scripting dictionary.",
    reference: 'sdef',
    keywords: ['applescript', 'jxa', 'osascript', 'sdef', 'dictionary', 'scripting', 'tell application'],
    link: { kind: 'console', action: 'osascript' },
  },
  'actions/raw-protobuf': {
    title: 'Raw protobuf',
    kind: 'mutate',
    summary: 'Send a hand-authored ClientOriginatedMessage envelope on the wire.',
    reference: 'ClientOriginatedMessage',
    keywords: ['raw', 'protobuf', 'envelope', 'wire'],
    link: { kind: 'console', action: 'raw-protobuf' },
  },
  'actions/tmux-send-command': {
    title: 'tmux: send command',
    kind: 'mutate',
    summary: 'Send a command to a tmux integration connection.',
    reference: 'TmuxRequest.SendCommand',
    keywords: ['tmux', 'command'],
    link: { kind: 'console', action: 'tmux-send-command' },
  },
  'actions/tmux-create-window': {
    title: 'tmux: create window',
    kind: 'mutate',
    summary: 'Create a window in a tmux integration connection.',
    reference: 'TmuxRequest.CreateWindow',
    keywords: ['tmux', 'window', 'create'],
    link: { kind: 'console', action: 'tmux-create-window' },
  },
  'actions/tmux-set-window-visible': {
    title: 'tmux: set window visible',
    kind: 'mutate',
    summary: 'Show or hide a tmux integration window.',
    reference: 'TmuxRequest.SetWindowVisible',
    keywords: ['tmux', 'visible', 'hide', 'show'],
    link: { kind: 'console', action: 'tmux-set-window-visible' },
  },
  'actions/get-preference': {
    title: 'Get preference',
    kind: 'read',
    summary: 'Read an iTerm2 preference value by key.',
    reference: 'PreferencesRequest',
    keywords: ['preference', 'setting', 'defaults'],
    link: { kind: 'console', action: 'get-preference' },
  },
  'actions/apply-color-preset': {
    title: 'Apply color preset',
    kind: 'mutate',
    summary: 'Apply a color preset to profiles in bulk.',
    reference: 'ColorPresetRequest',
    keywords: ['color', 'preset', 'theme', 'profile'],
    link: { kind: 'console', action: 'apply-color-preset' },
  },
  'workbench/list-profiles': {
    title: 'List profiles',
    kind: 'read',
    summary: 'Enumerate iTerm2 profiles and their properties.',
    reference: 'ProfileListResult',
    keywords: ['profiles', 'list'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/dynamic-profiles': {
    title: 'Dynamic profiles',
    kind: 'read',
    summary: 'Read the dynamic-profile JSON files iTerm2 loads from disk.',
    reference: 'DynamicProfileSnapshot',
    keywords: ['dynamic', 'profiles', 'json'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/save-dynamic-profile': {
    title: 'Save dynamic profile',
    kind: 'mutate',
    summary: 'Write a dynamic-profile JSON file iTerm2 will load.',
    reference: 'workbench/save-dynamic-profile',
    keywords: ['dynamic', 'profile', 'save', 'write'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/delete-dynamic-profile': {
    title: 'Delete dynamic profile',
    kind: 'mutate',
    summary: 'Delete a dynamic-profile JSON file.',
    reference: 'workbench/delete-dynamic-profile',
    keywords: ['dynamic', 'profile', 'delete'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/register-rpc': {
    title: 'Register RPC',
    kind: 'mutate',
    summary: 'Register a server-originated RPC the app answers (title, status bar, etc).',
    reference: 'RegistrationSpec',
    keywords: ['register', 'rpc', 'registration', 'callback'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/unregister-rpc': {
    title: 'Unregister RPC',
    kind: 'mutate',
    summary: 'Tear down a previously registered server-originated RPC.',
    reference: 'workbench/unregister-rpc',
    keywords: ['unregister', 'rpc', 'registration'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/registrations': {
    title: 'Registrations',
    kind: 'read',
    summary: 'The set of server-originated RPCs currently registered.',
    reference: 'RegistrationSnapshot',
    keywords: ['registrations', 'rpc', 'list'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/subscribe-custom-escape': {
    title: 'Subscribe custom escape',
    kind: 'mutate',
    summary: 'Subscribe to a session’s OSC 1337 Custom control sequences.',
    reference: 'workbench/subscribe-custom-escape',
    keywords: ['custom', 'escape', 'subscribe', 'osc1337'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/unsubscribe-custom-escape': {
    title: 'Unsubscribe custom escape',
    kind: 'mutate',
    summary: 'Tear down a custom control-sequence subscription.',
    reference: 'workbench/unsubscribe-custom-escape',
    keywords: ['custom', 'escape', 'unsubscribe'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/custom-escape': {
    title: 'Custom escapes',
    kind: 'read',
    summary: 'The custom control sequences received from subscribed sessions.',
    reference: 'CustomEscapeSnapshot',
    keywords: ['custom', 'escape', 'osc1337', 'control'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/arrangements': {
    title: 'Arrangements',
    kind: 'read',
    summary: 'The named window arrangements iTerm2 has saved.',
    reference: 'ArrangementSnapshot',
    keywords: ['arrangements', 'layout', 'list'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/broadcast-domains': {
    title: 'Broadcast domains',
    kind: 'read',
    summary: 'The current broadcast-input grouping of sessions.',
    reference: 'BroadcastDomainsResult',
    keywords: ['broadcast', 'domains', 'input'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/key-bindings': {
    title: 'Key bindings',
    kind: 'read',
    summary: "The global key bindings from iTerm2's preferences.",
    reference: 'KeyBindingsSnapshot',
    keywords: ['key', 'bindings', 'shortcuts', 'keymap'],
    link: { kind: 'lens', lens: 'build' },
  },
  'workbench/sdef-text': {
    title: 'sdef dictionary',
    kind: 'read',
    summary: "iTerm2's AppleScript scripting dictionary (sdef XML).",
    reference: 'SdefTextResult',
    keywords: ['sdef', 'applescript', 'dictionary', 'scripting'],
    link: { kind: 'lens', lens: 'console' },
  },
  'workbench/tmux-connections': {
    title: 'tmux connections',
    kind: 'read',
    summary: 'The live tmux integration connections iTerm2 reports.',
    reference: 'TmuxConnectionsResult',
    keywords: ['tmux', 'connections', 'list'],
    link: { kind: 'lens', lens: 'console' },
  },
  'workbench/color-presets': {
    title: 'Color presets',
    kind: 'read',
    summary: 'The named color presets available to apply to profiles.',
    reference: 'ColorPresetsResult',
    keywords: ['color', 'presets', 'theme', 'list'],
    link: { kind: 'lens', lens: 'console' },
  },
};

// The method namespace IS the group — derived from the one source, the key, never hand-repeated.
function rpcGroup(method: RpcMethod): CapabilityGroup {
  return method.slice(0, method.indexOf('/')) as CapabilityGroup;
}

function rpcCapabilities(): Capability[] {
  return (Object.entries(RPC_CAPABILITIES) as Array<[RpcMethod, RpcCapabilityMeta]>).map(
    ([method, meta]) => ({
      id: `rpc-${method.replace('/', '-')}`,
      ref: method,
      group: rpcGroup(method),
      title: meta.title,
      kind: meta.kind,
      summary: meta.summary,
      reference: meta.reference,
      keywords: meta.keywords,
      link: meta.link,
    }),
  );
}

function escapeReference(t: EscapeTemplate): string {
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

// [LAW:one-source-of-truth] The escape arm of the catalog is derived from ESCAPE_TEMPLATES, never a hand
// re-listing — a template added or renamed there appears here for free. An escape capability is `mutate`:
// invoking it emits a control sequence the terminal acts on (even a report-request like ReportCellSize is
// a sequence you SEND), so the operation changes terminal state.
function escapeCapabilities(): Capability[] {
  return ESCAPE_TEMPLATES.map((t) => ({
    id: `escape-${t.id}`,
    ref: t.id,
    title: t.label,
    kind: 'mutate' as const,
    group: 'escape' as const,
    summary: t.description,
    reference: escapeReference(t),
    keywords: [t.id, t.group, t.label],
    link: { kind: 'escape' as const, templateId: t.id },
  }));
}

// [LAW:one-source-of-truth] The template-designer targets (SetBadgeFormat, OSC 1/2 titles) live in
// TEMPLATE_TARGETS, not the escape catalog, because they carry live/snapshot apply semantics the escape
// catalog doesn't. They were indexed nowhere before; here they join the one catalog, linking to the
// Template lens where they are authored and applied against real variables.
function templateCapabilities(): Capability[] {
  return TEMPLATE_TARGETS.map((t) => ({
    id: `template-${t.id}`,
    ref: t.id,
    title: t.label,
    kind: 'mutate' as const,
    group: 'template' as const,
    summary: t.description,
    reference: t.applyMode === 'live' ? 'OSC 1337 SetBadgeFormat' : 'OSC title',
    keywords: [t.id, t.applyMode, 'badge', 'title', 'osc'],
    link: { kind: 'lens' as const, lens: 'template' as const },
  }));
}

// [LAW:effects-at-boundaries] A pure builder: same inputs, same catalog, no IO. The renderer builds it
// once at module load; tests build it freely. Build order is the display order within each group.
export function buildCapabilityCatalog(): Capability[] {
  return [...rpcCapabilities(), ...escapeCapabilities(), ...templateCapabilities()];
}

function haystackScore(cap: Capability, token: string): number {
  // Title and wire reference matches outrank keyword matches, which outrank summary matches — so
  // "SendTextRequest" lands on its own row before a row that merely mentions it in prose.
  if (cap.title.toLowerCase().includes(token)) return 3;
  if (cap.reference.toLowerCase().includes(token)) return 3;
  if (cap.keywords.some((k) => k.toLowerCase().includes(token))) return 2;
  if (cap.summary.toLowerCase().includes(token)) return 1;
  return 0;
}

// The kind filter is part of the search surface: 'all' keeps both, otherwise narrow to read or mutate.
// [LAW:dataflow-not-control-flow] A value over a fixed boundary, not a branch that runs a different path.
export type CapabilityKindFilter = CapabilityKind | 'all';

// [LAW:effects-at-boundaries] Pure ranked filter. A capability survives only if every query token hits
// somewhere (AND semantics) AND it satisfies the kind filter, so "monitor read" narrows to read methods
// matching "monitor". Empty query (with kind 'all') returns the whole catalog in build order.
export function searchCapabilities(
  catalog: readonly Capability[],
  query: string,
  kind: CapabilityKindFilter = 'all',
): Capability[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: Array<{ cap: Capability; score: number }> = [];
  for (const cap of catalog) {
    if (kind !== 'all' && cap.kind !== kind) continue;
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const score = haystackScore(cap, token);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (matchedAll) scored.push({ cap, score: total });
  }
  // Array.sort is stable, so ties keep build order — deterministic results for a given query.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cap);
}
