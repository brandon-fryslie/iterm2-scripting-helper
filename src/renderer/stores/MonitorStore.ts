import { makeAutoObservable, runInAction } from 'mobx';
import type {
  AppEntityRef,
  AppProbeResult,
  LayoutSnapshot,
  VariableSnapshot,
  WatchlistSnapshot,
  ScreenSnapshot,
} from '@shared/rpc';
import { APP_ENTITY } from '@shared/domain';

const EMPTY_LAYOUT: LayoutSnapshot = {
  windows: [],
  buriedSessions: [],
  lastUpdatedAt: 0,
};
const EMPTY_VARIABLES: VariableSnapshot = { entity: APP_ENTITY, variables: [] };
const EMPTY_WATCHLIST: WatchlistSnapshot = { names: [] };
const EMPTY_SCREEN: ScreenSnapshot = {
  sessionId: null,
  lines: [],
  cursor: null,
  lastUpdatedAt: 0,
  requestsInflight: 0,
  updatesReceived: 0,
  lastError: null,
};

export class MonitorStore {
  layout: LayoutSnapshot = EMPTY_LAYOUT;
  variables: VariableSnapshot = EMPTY_VARIABLES;
  watchlist: WatchlistSnapshot = EMPTY_WATCHLIST;
  screen: ScreenSnapshot = EMPTY_SCREEN;
  // [LAW:one-source-of-truth] The result is self-describing (carries the entity + expression it was
  // evaluated against), so it stays accurate even after focus moves; no parallel "what was probed".
  probeResult: AppProbeResult | null = null;
  probePending = false;
  mirrorsHydrated = false;
  private readonly onLayoutApplied: () => void;

  constructor(onLayoutApplied: () => void = () => undefined) {
    this.onLayoutApplied = onLayoutApplied;
    makeAutoObservable<MonitorStore, 'onLayoutApplied'>(this, {
      onLayoutApplied: false,
    });
  }

  applyLayout(snap: LayoutSnapshot): void {
    this.layout = snap;
    this.onLayoutApplied();
  }

  applyVariables(snap: VariableSnapshot): void {
    this.variables = snap;
  }

  applyWatchlist(snap: WatchlistSnapshot): void {
    this.watchlist = snap;
  }

  isWatched(name: string): boolean {
    return this.watchlist.names.includes(name);
  }

  async toggleWatched(name: string): Promise<void> {
    const snap = await window.ipc.invoke('monitor/set-watched', {
      name,
      watched: !this.isWatched(name),
    });
    runInAction(() => this.applyWatchlist(snap));
  }

  applyScreen(snap: ScreenSnapshot): void {
    this.screen = snap;
  }

  async hydrate(): Promise<void> {
    const [layout, variables, watchlist, screen] = await Promise.all([
      window.ipc.invoke('monitor/layout', undefined as never),
      window.ipc.invoke('monitor/variables', undefined as never),
      window.ipc.invoke('monitor/watchlist', undefined as never),
      window.ipc.invoke('monitor/screen', undefined as never),
    ]);
    runInAction(() => {
      this.layout = layout;
      this.variables = variables;
      this.watchlist = watchlist;
      this.screen = screen;
      this.mirrorsHydrated = true;
    });
    this.onLayoutApplied();
  }

  async loadSessionFocus(sessionId: string | null): Promise<string | null> {
    const { focusedSessionId } = await window.ipc.invoke('monitor/focus-session', {
      sessionId,
    });
    return focusedSessionId;
  }

  async loadVariableFocus(entity: AppEntityRef): Promise<void> {
    const snap = await window.ipc.invoke('monitor/focus-variables', { entity });
    runInAction(() => this.applyVariables(snap));
  }

  async runProbe(entity: AppEntityRef, expression: string): Promise<void> {
    this.probePending = true;
    try {
      const result = await window.ipc.invoke('monitor/probe-variable', { entity, expression });
      runInAction(() => {
        this.probeResult = result;
      });
    } finally {
      runInAction(() => {
        this.probePending = false;
      });
    }
  }

  clearProbe(): void {
    this.probeResult = null;
  }
}
