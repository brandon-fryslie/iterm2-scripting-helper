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

// [LAW:decomposition] This store owns ONLY the set of active registration specs. Invocations (the
// server's calls into those registrations) live on the unified event spine as 'invocation' events,
// not in a private ring here — one source of truth for the timeline, projected back via
// invocationProjection(appEvents).
export class RegistrationStore {
  private readonly registrations = new Map<string, RegistrationSpec>();

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

  clearAll(): void {
    this.registrations.clear();
  }

  list(): RegistrationSpec[] {
    return Array.from(this.registrations.values()).map((r) => ({
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
  }
}
