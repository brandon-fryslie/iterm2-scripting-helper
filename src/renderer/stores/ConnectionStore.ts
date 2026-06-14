import { makeAutoObservable, runInAction } from 'mobx';
import type { ConnectionSnapshot, ListSessionsSummary } from '@shared/rpc';

// [LAW:no-silent-failure] The driver failure carried by a connection-state transition, or null if this
// transition introduces no new failure. connection-state is pushed as a LEVEL (the same lastError rides
// every snapshot while the driver stays in 'error'); recording it naively would spam the Errors pane.
// This is the pure edge: a failure is new iff we are entering 'error' for the first time or its message
// changed. Re-entering 'error' after recovery, or a different cause, fires again — the same edge the
// main-process driver crosses when it calls setError. Pure over its inputs, so it is unit-testable
// without a running app. [LAW:effects-at-boundaries]
export function driverErrorEdge(
  prev: ConnectionSnapshot | null,
  next: ConnectionSnapshot,
): string | null {
  if (next.state !== 'error' || next.lastError === null) return null;
  if (prev !== null && prev.state === 'error' && prev.lastError === next.lastError) return null;
  return next.lastError;
}

export class ConnectionStore {
  snapshot: ConnectionSnapshot | null = null;
  wireFrameCount = 0;
  lastSessions: ListSessionsSummary | null = null;
  listSessionsError: string | null = null;
  listSessionsInFlight = false;
  private readonly onDriverError: (message: string) => void;

  // [LAW:one-way-deps] The error sink is injected as a function, not an imported ErrorStore — the
  // connection layer stays unaware of how a failure is recorded, and there is no store cycle.
  constructor(onDriverError: (message: string) => void) {
    this.onDriverError = onDriverError;
    makeAutoObservable<ConnectionStore, 'onDriverError'>(this, { onDriverError: false });
  }

  // [LAW:single-enforcer] The one place a connection snapshot lands. Every path (the live push, plus
  // connect/disconnect/refresh which all funnel here) crosses the driver-error edge exactly once, so a
  // failure is recorded once no matter how the snapshot arrived.
  apply(next: ConnectionSnapshot): void {
    const driverError = driverErrorEdge(this.snapshot, next);
    this.snapshot = next;
    if (driverError !== null) this.onDriverError(driverError);
  }

  bumpFrame(): void {
    this.wireFrameCount += 1;
  }

  async refresh(): Promise<void> {
    const snap = await window.ipc.invoke('connection/snapshot', undefined as never);
    runInAction(() => this.apply(snap));
  }

  async connect(): Promise<void> {
    const snap = await window.ipc.invoke('connection/connect', undefined as never);
    runInAction(() => this.apply(snap));
  }

  async disconnect(): Promise<void> {
    const snap = await window.ipc.invoke('connection/disconnect', undefined as never);
    runInAction(() => this.apply(snap));
  }

  async listSessions(): Promise<void> {
    runInAction(() => {
      this.listSessionsInFlight = true;
      this.listSessionsError = null;
    });
    try {
      const summary = await window.ipc.invoke(
        'connection/list-sessions',
        undefined as never,
      );
      runInAction(() => {
        this.lastSessions = summary;
        this.listSessionsInFlight = false;
      });
    } catch (err) {
      runInAction(() => {
        this.listSessionsError = err instanceof Error ? err.message : String(err);
        this.listSessionsInFlight = false;
      });
    }
  }
}
