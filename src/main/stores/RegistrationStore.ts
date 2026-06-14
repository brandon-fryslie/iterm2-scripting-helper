import { makeAutoObservable, toJS } from 'mobx';
import { invocationProjection, type AppEventLog } from './AppEventLog';
// [LAW:one-source-of-truth] The registration shapes are defined once in shared/rpc.ts — the same
// type the renderer authors, IPC carries, and this store holds. This file used to keep a second
// structurally-identical copy; that copy is gone.
import type {
  RegistrationSpec,
  RpcRegistrationSpec,
  RegistrationSnapshot,
  RegistrationStatus,
} from '@shared/rpc';

export type { RegistrationSpec } from '@shared/rpc';

// The store entry: the durable desired spec plus the connection era it was last successfully
// registered on. `lastError` records why a re-registration failed so a dead row can state its reason.
interface RegistrationEntry {
  spec: RegistrationSpec;
  liveGeneration: number;
  lastError: string | null;
}

// [LAW:decomposition] This store owns the set of DESIRED registration specs — the user's durable
// intent — and projects each one's live/dead status. Invocations (the server's calls into those
// registrations) live on the unified event spine as 'invocation' events, not in a private ring here.
//
// [LAW:one-source-of-truth] A registration's spec is durable; its live-ness is not stored as a
// flippable flag (which could drift from the real connection state) but derived from a single
// `generation` counter — the one owner of "which connection era are we in". A close bumps the
// generation, so every registration becomes dead by derivation with no per-entry mutation; a
// successful (re-)registration stamps the entry with the current generation, making it live.
// [LAW:no-ambient-temporal-coupling]
export class RegistrationStore {
  private readonly entries = new Map<string, RegistrationEntry>();
  // The current connection era. Incremented on every connection close so all prior stamps fall
  // behind and read as dead until re-registered on the new connection.
  private generation = 0;

  constructor() {
    makeAutoObservable(this);
  }

  // Called only after a successful wire registration, so stamping the current generation (→ live)
  // and clearing any prior failure is the truthful record of "this spec is registered right now".
  upsert(spec: RegistrationSpec): void {
    this.entries.set(spec.id, {
      spec,
      liveGeneration: this.generation,
      lastError: null,
    });
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  get(id: string): RegistrationSpec | null {
    const entry = this.entries.get(id);
    return entry ? toJS(entry.spec) : null;
  }

  // Only RPC-backed registrations are addressable by function name — that is what the server
  // names in a server-originated RPC notification. Toolbelt tools have no function name.
  findByName(name: string): RpcRegistrationSpec | null {
    for (const entry of this.entries.values()) {
      const spec = entry.spec;
      if (spec.role !== 'toolbelt' && spec.name === name) return toJS(spec);
    }
    return null;
  }

  // [LAW:one-source-of-truth] A connection close ends the current era (so every registration reads
  // dead) and forgets the connection-scoped (non-persistent) specs. Persistent specs are kept so the
  // reconnect path can re-send them — that is what makes them survive a reconnect. This replaces the
  // old blanket clearAll(), which destroyed the user's intent along with the dead wire state.
  onConnectionClosed(): void {
    this.generation += 1;
    for (const [id, entry] of this.entries) {
      if (!entry.spec.persistent) this.entries.delete(id);
    }
  }

  // The specs the reconnect path must re-register: the durable intent that outlives a connection.
  persistentSpecs(): RegistrationSpec[] {
    const out: RegistrationSpec[] = [];
    for (const entry of this.entries.values()) {
      if (entry.spec.persistent) out.push(toJS(entry.spec));
    }
    return out;
  }

  // Record that a persistent registration failed to come back on reconnect. The entry stays dead
  // (its liveGeneration is not advanced) and now carries the reason, so the failure is represented
  // in the snapshot rather than swallowed. [LAW:no-silent-failure]
  noteReregisterError(id: string, message: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.lastError = message;
  }

  statuses(): RegistrationStatus[] {
    return Array.from(this.entries.values()).map((entry) => ({
      spec: toJS(entry.spec),
      live: entry.liveGeneration === this.generation,
      lastError: entry.lastError,
    }));
  }
}

// [LAW:one-source-of-truth] The single builder of the registrations snapshot shape: active specs with
// their live/dead status from the store, invocations projected from the spine. Both the IPC handler
// and the broadcast call this, so the shape is defined once and the two sources are joined in exactly
// one place.
export function registrationSnapshot(
  registrations: RegistrationStore,
  appEvents: AppEventLog,
): RegistrationSnapshot {
  return {
    registrations: registrations.statuses(),
    ...invocationProjection(appEvents),
  };
}
