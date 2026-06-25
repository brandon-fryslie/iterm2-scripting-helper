import { makeAutoObservable, observable, reaction, toJS } from 'mobx';
import type {
  ActionResult,
  AppActionKind,
  ArrangementOp,
  OsascriptLanguage,
  TransactionOp,
  RpcMethod,
  RpcArgs,
} from '@shared/rpc';
import { parseDomainsText } from '@shared/broadcastDomains';
import { versionedCell } from './persistence';
import type { EntityFocusStore } from './EntityFocusStore';

// [LAW:one-source-of-truth] The console fires exactly the action kinds the spine records;
// domain.ts owns the closed set.
export type ActionKind = AppActionKind;

type ActionMethod = Extract<RpcMethod, `actions/${string}`>;
// The protocol args a form produces, before the focused entity is attached at fire time. The entity
// is not part of what the user fills in — it is the focus context, added in `fire`.
type ActionArgs = { [M in ActionMethod]: Omit<RpcArgs<M>, 'entity'> }[ActionMethod];

const ACTION_METHODS: Record<ActionKind, ActionMethod> = {
  'send-text': 'actions/send-text',
  inject: 'actions/inject',
  activate: 'actions/activate',
  'menu-item': 'actions/menu-item',
  'invoke-function': 'actions/invoke-function',
  'restart-session': 'actions/restart-session',
  close: 'actions/close',
  'saved-arrangement': 'actions/saved-arrangement',
  'set-broadcast-domains': 'actions/set-broadcast-domains',
  'get-selection': 'actions/get-selection',
  'set-selection': 'actions/set-selection',
  transaction: 'actions/transaction',
  osascript: 'actions/osascript',
  'raw-protobuf': 'actions/raw-protobuf',
  'tmux-send-command': 'actions/tmux-send-command',
  'tmux-create-window': 'actions/tmux-create-window',
  'tmux-set-window-visible': 'actions/tmux-set-window-visible',
  'get-preference': 'actions/get-preference',
  'apply-color-preset': 'actions/apply-color-preset',
};

export interface Snippet {
  id: string;
  name: string;
  action: ActionKind;
  args: unknown;
  createdAt: number;
}

export interface ActionForms {
  'send-text': { sessionId: string; text: string; suppressBroadcast: boolean };
  inject: { sessionId: string; bytesHex: string };
  activate: {
    kind: 'window' | 'tab' | 'session' | 'app';
    id: string;
    orderWindowFront: boolean;
    selectSession: boolean;
    selectTab: boolean;
    activateApp: boolean;
  };
  'menu-item': { identifier: string; queryOnly: boolean };
  'invoke-function': {
    invocation: string;
    scopeKind: 'app' | 'session' | 'tab' | 'window';
    scopeId: string;
    timeout: number;
  };
  'restart-session': { sessionId: string; onlyIfExited: boolean };
  close: { kind: 'sessions' | 'tabs' | 'windows'; idsCsv: string; force: boolean };
  // windowId semantics live on the rpc.ts ArrangementOp type, the one home of that truth.
  'saved-arrangement': { op: ArrangementOp; name: string; windowId: string };
  // One domain per line, members separated by commas or whitespace; the parse lives in
  // @shared/broadcastDomains, the one home of that encoding.
  'set-broadcast-domains': { domainsText: string };
  'get-selection': { sessionId: string };
  // selectionJson: JSON-encoded iterm2.Selection proto; paste get-selection output to set it back.
  'set-selection': { sessionId: string; selectionJson: string };
  transaction: { op: TransactionOp };
  // script: AppleScript or JXA source. language maps directly to osascript's -l flag value.
  osascript: { script: string; language: OsascriptLanguage };
  'raw-protobuf': { envelopeJson: string };
  // connectionId is picked from the tmux store (or typed raw). affinity hints adjacency for the new
  // window ('' = no hint); windowId/visible address an existing tmux window's iTerm2 visibility.
  'tmux-send-command': { connectionId: string; command: string };
  'tmux-create-window': { connectionId: string; affinity: string };
  'tmux-set-window-visible': { connectionId: string; windowId: string; visible: boolean };
  // key: the raw iTerm2 preference key to read its stored JSON value.
  'get-preference': { key: string };
  // presetName is picked from the color-preset store (or typed raw); guidsCsv is the target profile
  // GUIDs, comma-separated — the bulk in "apply to many profiles at once".
  'apply-color-preset': { presetName: string; guidsCsv: string };
}

const DEFAULT_FORMS: ActionForms = {
  'send-text': { sessionId: '', text: '', suppressBroadcast: false },
  inject: { sessionId: '', bytesHex: '' },
  activate: {
    kind: 'tab',
    id: '',
    orderWindowFront: true,
    selectSession: true,
    selectTab: true,
    activateApp: false,
  },
  'menu-item': { identifier: '', queryOnly: false },
  'invoke-function': {
    invocation: '',
    scopeKind: 'session',
    scopeId: '',
    timeout: 5,
  },
  'restart-session': { sessionId: '', onlyIfExited: false },
  close: { kind: 'sessions', idsCsv: '', force: false },
  'saved-arrangement': { op: 'save', name: '', windowId: '' },
  'set-broadcast-domains': { domainsText: '' },
  'get-selection': { sessionId: '' },
  'set-selection': { sessionId: '', selectionJson: '{}' },
  transaction: { op: 'begin' as TransactionOp },
  osascript: { script: '', language: 'AppleScript' as OsascriptLanguage },
  'raw-protobuf': {
    envelopeJson: `{\n  "submessage": {\n    "listSessionsRequest": {}\n  }\n}`,
  },
  'tmux-send-command': { connectionId: '', command: '' },
  'tmux-create-window': { connectionId: '', affinity: '' },
  'tmux-set-window-visible': { connectionId: '', windowId: '', visible: true },
  'get-preference': { key: '' },
  'apply-color-preset': { presetName: '', guidsCsv: '' },
};

// [LAW:one-source-of-truth] The Console's persisted authoring state is one blob under one key: the saved
// snippets and the per-action argument forms. They are saved together because both are the user's
// in-progress console work and a single boundary reaction mirrors the whole of it.
interface ConsolePersisted {
  snippets: Snippet[];
  forms: ActionForms;
}

const ACTION_KINDS: ReadonlySet<string> = new Set(Object.keys(ACTION_METHODS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// [LAW:types-are-the-program] A persisted snippet is only trustworthy if its `action` is one the console
// can actually fire — `fireSnippet` indexes ACTION_METHODS by it — so the action membership is validated,
// not assumed. The other fields are checked for the types the snippet card and re-fire path rely on.
function isSnippet(value: unknown): value is Snippet {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.action === 'string' &&
    ACTION_KINDS.has(value.action) &&
    'args' in value &&
    typeof value.createdAt === 'number'
  );
}

// [LAW:no-silent-failure] Validation is total: snippets must all be well-formed and forms must be a record
// of records, or the whole blob is rejected (the seam warns and drops). The version guarantees the inner
// form shape within a build; merging the validated forms over the defaults guarantees every action key is
// present, so a hand-edited blob missing a key cannot strand a form at `undefined`.
function decodeConsole(data: unknown): ConsolePersisted | null {
  if (!isRecord(data)) return null;
  const { snippets, forms } = data;
  if (!Array.isArray(snippets) || !snippets.every(isSnippet)) return null;
  if (!isRecord(forms) || !Object.values(forms).every(isRecord)) return null;
  return {
    snippets,
    forms: { ...structuredClone(DEFAULT_FORMS), ...(forms as Partial<ActionForms>) },
  };
}

const CONSOLE_CELL = versionedCell<ConsolePersisted>({
  key: 'console-state',
  version: 1,
  fallback: () => ({ snippets: [], forms: structuredClone(DEFAULT_FORMS) }),
  decode: decodeConsole,
});

// The id allocator restored so a snippet saved after a reload cannot collide with a persisted id. The
// counter is an internal allocation detail, not persisted state — it is derived from the loaded ids so
// the on-disk blob stays the natural {snippets, forms} unit.
function nextIdAfter(snippets: readonly Snippet[]): number {
  return snippets.reduce((max, s) => {
    const n = Number(s.id.replace(/^snip-/, ''));
    return Number.isFinite(n) && n >= max ? n + 1 : max;
  }, 1);
}

export class ConsoleStore {
  selectedAction: ActionKind = 'send-text';
  forms: ActionForms;
  snippets: Snippet[] = [];
  private nextSnippetId = 1;
  private readonly entityFocus: EntityFocusStore;

  constructor(entityFocus: EntityFocusStore) {
    this.entityFocus = entityFocus;
    // [LAW:no-ambient-temporal-coupling] Load before makeAutoObservable wires reactions: the restore is
    // the initial state, never a change the persistence reaction observes and writes straight back.
    const persisted = CONSOLE_CELL.load();
    this.forms = persisted.forms;
    this.snippets = persisted.snippets;
    this.nextSnippetId = nextIdAfter(persisted.snippets);
    // [LAW:one-source-of-truth] A snippet is an immutable value: created whole, never mutated
    // field-by-field. Deep observation would wrap its stored args in Proxies — a second
    // representation that cannot survive structured clone when the snippet re-fires across the IPC
    // boundary. Observe the array shallowly so stored args stay plain and cloneable.
    makeAutoObservable<ConsoleStore, 'entityFocus'>(this, {
      entityFocus: false,
      snippets: observable.shallow,
    });
    // [LAW:effects-at-boundaries] The store mutates pure state; persistence is the one effect, pushed to
    // this boundary reaction rather than fired from inside saveSnippet/deleteSnippet/updateForm. Reading
    // the snippets and forms here tracks both, so the mirror is rewritten whenever either changes.
    reaction(
      () => ({ snippets: this.snippets.map((s) => ({ ...s })), forms: toJS(this.forms) }),
      (state) => CONSOLE_CELL.save(state),
    );
  }

  setAction(action: ActionKind): void {
    this.selectedAction = action;
  }

  get focusedSessionId(): string {
    return this.entityFocus.sessionId ?? '';
  }

  updateForm<K extends ActionKind>(action: K, patch: Partial<ActionForms[K]>): void {
    this.forms[action] = { ...this.forms[action], ...patch };
  }

  buildArgs(action: ActionKind): ActionArgs {
    switch (action) {
      case 'send-text': {
        const f = this.forms['send-text'];
        return {
          sessionId: f.sessionId || this.focusedSessionId,
          text: f.text,
          suppressBroadcast: f.suppressBroadcast,
        };
      }
      case 'inject': {
        const f = this.forms.inject;
        const sessionId = f.sessionId || this.focusedSessionId;
        return { sessionIds: sessionId ? [sessionId] : [], bytesHex: f.bytesHex };
      }
      case 'activate': {
        const f = this.forms.activate;
        const target = f.kind === 'app'
          ? { kind: 'app' as const }
          : {
              kind: f.kind,
              id: f.id || (f.kind === 'session' ? this.focusedSessionId : ''),
            };
        return {
          target,
          orderWindowFront: f.orderWindowFront,
          selectSession: f.selectSession,
          selectTab: f.selectTab,
          activateApp: f.activateApp,
        };
      }
      case 'menu-item': {
        const f = this.forms['menu-item'];
        return { identifier: f.identifier, queryOnly: f.queryOnly };
      }
      case 'invoke-function': {
        const f = this.forms['invoke-function'];
        const scope = f.scopeKind === 'app'
          ? { kind: 'app' as const }
          : { kind: f.scopeKind, id: f.scopeId || this.focusedSessionId };
        return { invocation: f.invocation, scope, timeout: f.timeout };
      }
      case 'restart-session': {
        const f = this.forms['restart-session'];
        return {
          sessionId: f.sessionId || this.focusedSessionId,
          onlyIfExited: f.onlyIfExited,
        };
      }
      case 'close': {
        const f = this.forms.close;
        return {
          kind: f.kind,
          ids: f.idsCsv.split(',').map((s) => s.trim()).filter(Boolean),
          force: f.force,
        };
      }
      case 'saved-arrangement': {
        const f = this.forms['saved-arrangement'];
        return {
          op: f.op,
          name: f.name,
          ...(f.windowId ? { windowId: f.windowId } : {}),
        };
      }
      case 'set-broadcast-domains':
        return { domains: parseDomainsText(this.forms['set-broadcast-domains'].domainsText) };
      case 'get-selection': {
        const f = this.forms['get-selection'];
        return { sessionId: f.sessionId || this.focusedSessionId };
      }
      case 'set-selection': {
        const f = this.forms['set-selection'];
        return {
          sessionId: f.sessionId || this.focusedSessionId,
          selectionJson: f.selectionJson,
        };
      }
      case 'transaction':
        return { op: this.forms.transaction.op };
      case 'osascript': {
        const f = this.forms.osascript;
        return { script: f.script, language: f.language };
      }
      case 'raw-protobuf':
        return { envelopeJson: this.forms['raw-protobuf'].envelopeJson };
      case 'tmux-send-command': {
        const f = this.forms['tmux-send-command'];
        return { connectionId: f.connectionId, command: f.command };
      }
      case 'tmux-create-window': {
        const f = this.forms['tmux-create-window'];
        return { connectionId: f.connectionId, affinity: f.affinity };
      }
      case 'tmux-set-window-visible': {
        const f = this.forms['tmux-set-window-visible'];
        return { connectionId: f.connectionId, windowId: f.windowId, visible: f.visible };
      }
      case 'get-preference':
        return { key: this.forms['get-preference'].key };
      case 'apply-color-preset': {
        const f = this.forms['apply-color-preset'];
        return {
          presetName: f.presetName,
          guids: f.guidsCsv.split(',').map((s) => s.trim()).filter(Boolean),
        };
      }
    }
  }

  async fire(action: ActionKind, argsOverride?: unknown): Promise<ActionResult> {
    const args = argsOverride ?? this.buildArgs(action);
    const method = ACTION_METHODS[action];
    // [LAW:dataflow-not-control-flow] The focused entity rides along as a value; the main process
    // records it on the action event. The override (if the user typed one) stays inside `args`.
    const entity = this.entityFocus.selected;
    const result = (await window.ipc.invoke(method, { ...(args as object), entity } as never)) as ActionResult;
    // The action is appended to the spine by the main process; the Activity timeline projects it.
    return result;
  }

  saveSnippet(name: string): Snippet {
    const snippet: Snippet = {
      id: `snip-${this.nextSnippetId++}`,
      name: name || `${this.selectedAction} ${new Date().toLocaleTimeString()}`,
      action: this.selectedAction,
      args: this.buildArgs(this.selectedAction),
      createdAt: Date.now(),
    };
    this.snippets.push(snippet);
    return snippet;
  }

  deleteSnippet(id: string): void {
    this.snippets = this.snippets.filter((s) => s.id !== id);
  }

  async fireSnippet(id: string): Promise<ActionResult | null> {
    const snippet = this.snippets.find((s) => s.id === id);
    if (!snippet) return null;
    return this.fire(snippet.action, snippet.args);
  }
}
