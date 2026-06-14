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
  // [LAW:no-ambient-temporal-coupling] The explicit owner of "which load is current". load() stamps
  // each attempt with the next generation; a response only writes if its stamp still matches. Without
  // it, a refresh started while an earlier load is in flight would let the older response land last
  // and silently overwrite fresher data with the pre-refresh list. Same staleness guard RootStore's
  // focusRequestSeq uses for superseded focus reads ([LAW:one-type-per-behavior]).
  private generation = 0;

  constructor() {
    makeAutoObservable(this);
  }

  // The load is triggered by explicit intent (a tmux form mounting or a Refresh click), never an
  // ambient effect. Re-entry while loading or already-loaded is a no-op so concurrent form mounts
  // share one read; `refresh` is the way to force a re-read.
  async load(): Promise<void> {
    if (this.state.status === 'loading' || this.state.status === 'ok') return;
    const gen = ++this.generation;
    this.state = { status: 'loading' };
    try {
      const res = await window.ipc.invoke('workbench/tmux-connections', undefined);
      runInAction(() => {
        if (gen !== this.generation) return;
        this.state = res.ok
          ? { status: 'ok', connections: res.connections }
          : { status: 'error', message: res.error };
      });
    } catch (err) {
      runInAction(() => {
        if (gen !== this.generation) return;
        this.state = {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      });
    }
  }

  // Resetting to idle lets load() past its own re-entry guard; load() then stamps a new generation,
  // which is what supersedes any read still in flight — refresh owns no counter of its own.
  refresh(): void {
    this.state = { status: 'idle' };
    void this.load();
  }
}
