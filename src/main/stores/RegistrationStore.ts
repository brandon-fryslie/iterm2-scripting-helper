import { makeAutoObservable, toJS } from 'mobx';
import { invocationProjection, type AppEventLog } from './AppEventLog';
// [LAW:one-source-of-truth] The registration shapes are defined once in shared/rpc.ts — the same
// type the renderer authors, IPC carries, and this store holds. This file used to keep a second
// structurally-identical copy; that copy is gone.
import type {
  RegistrationSpec,
  RpcRegistrationSpec,
  RegistrationSnapshot,
} from '@shared/rpc';

export type { RegistrationSpec } from '@shared/rpc';

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

  get(id: string): RegistrationSpec | null {
    const spec = this.registrations.get(id);
    return spec ? toJS(spec) : null;
  }

  // Only RPC-backed registrations are addressable by function name — that is what the server
  // names in a server-originated RPC notification. Toolbelt tools have no function name.
  findByName(name: string): RpcRegistrationSpec | null {
    for (const reg of this.registrations.values()) {
      if (reg.role !== 'toolbelt' && reg.name === name) return reg;
    }
    return null;
  }

  clearAll(): void {
    this.registrations.clear();
  }

  list(): RegistrationSpec[] {
    return Array.from(this.registrations.values()).map((r) => toJS(r));
  }
}

// [LAW:one-source-of-truth] The single builder of the registrations snapshot shape: active specs from
// the store, invocations projected from the spine. Both the IPC handler and the broadcast call this,
// so the shape is defined once and the two sources are joined in exactly one place.
export function registrationSnapshot(
  registrations: RegistrationStore,
  appEvents: AppEventLog,
): RegistrationSnapshot {
  return {
    registrations: registrations.list(),
    ...invocationProjection(appEvents),
  };
}
