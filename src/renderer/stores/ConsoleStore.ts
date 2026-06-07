import { makeAutoObservable, runInAction } from 'mobx';
import type { ActionResult, RpcMethod, RpcArgs } from '@shared/rpc';
import type { EntityFocusStore } from './EntityFocusStore';

export type ActionKind =
  | 'send-text'
  | 'inject'
  | 'activate'
  | 'menu-item'
  | 'invoke-function'
  | 'restart-session'
  | 'close'
  | 'raw-protobuf';

const ACTION_METHODS: Record<ActionKind, Extract<RpcMethod, `actions/${string}`>> = {
  'send-text': 'actions/send-text',
  inject: 'actions/inject',
  activate: 'actions/activate',
  'menu-item': 'actions/menu-item',
  'invoke-function': 'actions/invoke-function',
  'restart-session': 'actions/restart-session',
  close: 'actions/close',
  'raw-protobuf': 'actions/raw-protobuf',
};

export interface TranscriptEntry {
  id: number;
  at: number;
  action: ActionKind;
  args: unknown;
  result: ActionResult;
}

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
  'raw-protobuf': {
    envelopeJson: `{\n  "submessage": {\n    "listSessionsRequest": {}\n  }\n}`,
  },
};

export class ConsoleStore {
  selectedAction: ActionKind = 'send-text';
  forms: ActionForms;
  transcript: TranscriptEntry[] = [];
  snippets: Snippet[] = [];
  private nextEntryId = 1;
  private nextSnippetId = 1;
  private readonly entityFocus: EntityFocusStore;

  constructor(entityFocus: EntityFocusStore) {
    this.entityFocus = entityFocus;
    this.forms = structuredClone(DEFAULT_FORMS);
    makeAutoObservable<ConsoleStore, 'entityFocus'>(this, { entityFocus: false });
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

  buildArgs(action: ActionKind): RpcArgs<Extract<RpcMethod, `actions/${string}`>> {
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
      case 'raw-protobuf':
        return { envelopeJson: this.forms['raw-protobuf'].envelopeJson };
    }
  }

  async fire(action: ActionKind, argsOverride?: unknown): Promise<ActionResult> {
    const args = argsOverride ?? this.buildArgs(action);
    const method = ACTION_METHODS[action];
    const result = (await window.ipc.invoke(method, args as never)) as ActionResult;
    const entry: TranscriptEntry = {
      id: this.nextEntryId++,
      at: Date.now(),
      action,
      args,
      result,
    };
    runInAction(() => {
      this.transcript.push(entry);
      if (this.transcript.length > 200) {
        this.transcript.splice(0, this.transcript.length - 200);
      }
    });
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

  clearTranscript(): void {
    this.transcript = [];
  }
}
