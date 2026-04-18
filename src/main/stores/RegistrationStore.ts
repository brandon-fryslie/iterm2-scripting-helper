import { makeAutoObservable } from 'mobx';

export type RegistrationRole = 'generic' | 'session-title' | 'status-bar' | 'context-menu';

export interface KnobSpec {
  name: string;
  type: 'Checkbox' | 'String' | 'PositiveFloatingPoint' | 'Color';
  placeholder: string;
  jsonDefaultValue: string;
  key: string;
}

export interface StatusBarAttrs {
  shortDescription: string;
  detailedDescription: string;
  knobs: KnobSpec[];
  exemplar: string;
  updateCadence: number;
  uniqueIdentifier: string;
  format: 'PLAIN_TEXT' | 'HTML';
}

export interface SessionTitleAttrs {
  displayName: string;
  uniqueIdentifier: string;
}

export interface ContextMenuAttrs {
  displayName: string;
  uniqueIdentifier: string;
}

export interface RegistrationSpec {
  id: string;
  role: RegistrationRole;
  name: string;
  arguments: string[];
  defaults: Array<{ name: string; path: string }>;
  timeout: number;
  statusBar?: StatusBarAttrs;
  sessionTitle?: SessionTitleAttrs;
  contextMenu?: ContextMenuAttrs;
  responseTemplate: string;
}

export interface Invocation {
  seq: number;
  at: number;
  registrationId: string;
  requestId: string;
  args: Record<string, unknown>;
  responded: boolean;
  responseJson: string;
  error: string | null;
}

export interface InvocationSnapshot {
  entries: Invocation[];
  totalSeen: number;
  capacity: number;
}

export interface RegistrationSnapshot {
  registrations: RegistrationSpec[];
  invocations: Invocation[];
  totalInvocations: number;
}

const INVOCATION_CAPACITY = 500;

export class RegistrationStore {
  private readonly registrations = new Map<string, RegistrationSpec>();
  private readonly invocationRing: (Invocation | undefined)[] = new Array(INVOCATION_CAPACITY);
  private head = 0;
  private length = 0;
  private nextSeq = 1;
  totalInvocations = 0;

  constructor() {
    makeAutoObservable(this);
  }

  upsert(spec: RegistrationSpec): void {
    this.registrations.set(spec.id, spec);
  }

  remove(id: string): void {
    this.registrations.delete(id);
  }

  findByName(name: string): RegistrationSpec | null {
    for (const reg of this.registrations.values()) {
      if (reg.name === name) return reg;
    }
    return null;
  }

  recordInvocation(partial: Omit<Invocation, 'seq'>): Invocation {
    const entry: Invocation = { ...partial, seq: this.nextSeq++ };
    this.invocationRing[this.head] = entry;
    this.head = (this.head + 1) % INVOCATION_CAPACITY;
    if (this.length < INVOCATION_CAPACITY) this.length += 1;
    this.totalInvocations += 1;
    return entry;
  }

  clearInvocations(): void {
    this.invocationRing.fill(undefined);
    this.head = 0;
    this.length = 0;
    this.totalInvocations = 0;
    this.nextSeq = 1;
  }

  clearAll(): void {
    this.registrations.clear();
    this.clearInvocations();
  }

  snapshot(): RegistrationSnapshot {
    const registrations = Array.from(this.registrations.values()).map((r) => ({
      id: r.id,
      role: r.role,
      name: r.name,
      arguments: [...r.arguments],
      defaults: r.defaults.map((d) => ({ name: d.name, path: d.path })),
      timeout: r.timeout,
      statusBar: r.statusBar
        ? {
            ...r.statusBar,
            knobs: r.statusBar.knobs.map((k) => ({ ...k })),
          }
        : undefined,
      sessionTitle: r.sessionTitle ? { ...r.sessionTitle } : undefined,
      contextMenu: r.contextMenu ? { ...r.contextMenu } : undefined,
      responseTemplate: r.responseTemplate,
    }));

    const invocations: Invocation[] = [];
    const start = (this.head - this.length + INVOCATION_CAPACITY) % INVOCATION_CAPACITY;
    for (let i = 0; i < this.length; i++) {
      const e = this.invocationRing[(start + i) % INVOCATION_CAPACITY];
      if (e) {
        invocations.push({
          seq: e.seq,
          at: e.at,
          registrationId: e.registrationId,
          requestId: e.requestId,
          args: { ...e.args },
          responded: e.responded,
          responseJson: e.responseJson,
          error: e.error,
        });
      }
    }
    return {
      registrations,
      invocations,
      totalInvocations: this.totalInvocations,
    };
  }
}
