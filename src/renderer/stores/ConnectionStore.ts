import { makeAutoObservable, runInAction } from 'mobx';
import type { ConnectionSnapshot, ListSessionsSummary } from '@shared/rpc';

export class ConnectionStore {
  snapshot: ConnectionSnapshot | null = null;
  wireFrameCount = 0;
  lastSessions: ListSessionsSummary | null = null;
  listSessionsError: string | null = null;
  listSessionsInFlight = false;

  constructor() {
    makeAutoObservable(this);
  }

  apply(next: ConnectionSnapshot): void {
    this.snapshot = next;
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
