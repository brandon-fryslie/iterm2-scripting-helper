import { makeAutoObservable, observable } from 'mobx';
import type {
  ActionResult,
  AppActionKind,
  ArrangementOp,
  RpcMethod,
  RpcArgs,
} from '@shared/rpc';
import { parseDomainsText } from '@shared/broadcastDomains';
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
  'raw-protobuf': 'actions/raw-protobuf',
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
  'raw-protobuf': { envelopeJson: string };
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
  'raw-protobuf': {
    envelopeJson: `{\n  "submessage": {\n    "listSessionsRequest": {}\n  }\n}`,
  },
};

export class ConsoleStore {
  selectedAction: ActionKind = 'send-text';
  forms: ActionForms;
  snippets: Snippet[] = [];
  private nextSnippetId = 1;
  private readonly entityFocus: EntityFocusStore;

  constructor(entityFocus: EntityFocusStore) {
    this.entityFocus = entityFocus;
    this.forms = structuredClone(DEFAULT_FORMS);
    // [LAW:one-source-of-truth] A snippet is an immutable value: created whole, never mutated
    // field-by-field. Deep observation would wrap its stored args in Proxies — a second
    // representation that cannot survive structured clone when the snippet re-fires across the IPC
    // boundary. Observe the array shallowly so stored args stay plain and cloneable.
    makeAutoObservable<ConsoleStore, 'entityFocus'>(this, {
      entityFocus: false,
      snippets: observable.shallow,
    });
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
      case 'raw-protobuf':
        return { envelopeJson: this.forms['raw-protobuf'].envelopeJson };
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
