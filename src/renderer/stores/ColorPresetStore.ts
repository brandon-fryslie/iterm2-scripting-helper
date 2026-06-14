import { makeAutoObservable, runInAction } from 'mobx';

// [LAW:types-are-the-program] Every lifecycle state of the lazy preset-name load is explicit and
// illegal combinations (a loaded list co-existing with an error, a retry path with no error) are
// unrepresentable. Mirrors the TmuxConnectionsState union the tmux console established.
export type ColorPresetsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; presets: string[] }
  | { status: 'error'; message: string };

// The color-preset store: the renderer's single, explicitly-refreshable cache of which color presets
// exist. [LAW:one-source-of-truth] iTerm2 is the authority (workbench/color-presets fires the wire
// read); this store derives from it and is the one place the apply-color-preset form reads names from.
export class ColorPresetStore {
  state: ColorPresetsState = { status: 'idle' };
  // [LAW:no-ambient-temporal-coupling] The explicit owner of "which load is current". load() stamps
  // each attempt with the next generation; a response only writes if its stamp still matches. Without
  // it, a refresh started while an earlier load is in flight would let the older response land last
  // and silently overwrite fresher data. Same staleness guard TmuxStore / RootStore.focusRequestSeq use.
  private generation = 0;

  constructor() {
    makeAutoObservable(this);
  }

  // Triggered by explicit intent (the apply form mounting or a Refresh click), never an ambient effect.
  // Re-entry while loading or already-loaded is a no-op so concurrent mounts share one read; `refresh`
  // is the way to force a re-read.
  async load(): Promise<void> {
    if (this.state.status === 'loading' || this.state.status === 'ok') return;
    const gen = ++this.generation;
    this.state = { status: 'loading' };
    try {
      const res = await window.ipc.invoke('workbench/color-presets', undefined);
      runInAction(() => {
        if (gen !== this.generation) return;
        this.state = res.ok
          ? { status: 'ok', presets: res.presets }
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
