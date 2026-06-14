import { makeAutoObservable, runInAction } from 'mobx';
import type { TmuxConnection } from '@shared/rpc';

// [LAW:types-are-the-program] Every lifecycle state of the lazy connection load is explicit and
// illegal combinations (a loaded list co-existing with an error, a retry path with no error) are
// unrepresentable. Mirrors the sdef SdefState union the AppleScript console established.
export type TmuxConnectionsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; connections: TmuxConnection[] }
  | { status: 'error'; message: string };

// The tmux store: the renderer's single, explicitly-refreshable cache of which tmux connections exist.
// [LAW:one-source-of-truth] iTerm2 is the authority (workbench/tmux-connections fires the wire read);
// this store derives from it and is the one place the three tmux console forms read connections from.
export class TmuxStore {
  state: TmuxConnectionsState = { status: 'idle' };

  constructor() {
    makeAutoObservable(this);
  }

  // [LAW:no-ambient-temporal-coupling] The load is triggered by explicit intent (a tmux form mounting
  // or a Refresh click), never an ambient effect. Re-entry while loading or already-loaded is a no-op
  // so concurrent form mounts share one read; `refresh` is the way to force a re-read.
  async load(): Promise<void> {
    if (this.state.status === 'loading' || this.state.status === 'ok') return;
    this.state = { status: 'loading' };
    try {
      const res = await window.ipc.invoke('workbench/tmux-connections', undefined);
      runInAction(() => {
        this.state = res.ok
          ? { status: 'ok', connections: res.connections }
          : { status: 'error', message: res.error };
      });
    } catch (err) {
      runInAction(() => {
        this.state = {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      });
    }
  }

  refresh(): void {
    this.state = { status: 'idle' };
    void this.load();
  }
}
