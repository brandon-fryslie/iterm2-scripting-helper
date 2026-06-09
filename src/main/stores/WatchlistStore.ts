import { makeAutoObservable, observable } from 'mobx';

export interface WatchlistSnapshot {
  names: string[];
}

// [LAW:no-shared-mutable-globals] The set of live-watched variable paths is owned state with an
// explicit API, not a module-level constant the orchestrator reaches into. Seeded with the paths
// iTerm2 exposes for a typical session so default behavior matches the pre-watchlist build.
export const DEFAULT_WATCHLIST = [
  'hostname',
  'username',
  'path',
  'jobName',
  'jobPid',
  'lastCommand',
  'bellCount',
  'rows',
  'columns',
  'tty',
] as const;

export class WatchlistStore {
  private readonly watched = new Set<string>(DEFAULT_WATCHLIST);

  constructor() {
    makeAutoObservable<WatchlistStore, 'watched'>(this, { watched: observable });
  }

  names(): string[] {
    return Array.from(this.watched).sort((a, b) => a.localeCompare(b));
  }

  has(name: string): boolean {
    return this.watched.has(name);
  }

  setWatched(name: string, watched: boolean): void {
    if (watched) this.watched.add(name);
    else this.watched.delete(name);
  }

  snapshot(): WatchlistSnapshot {
    return { names: this.names() };
  }
}
