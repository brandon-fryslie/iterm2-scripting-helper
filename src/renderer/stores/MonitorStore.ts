import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type {
  AppEntityRef,
  AppProbeResult,
  LayoutSnapshot,
  VariableSnapshot,
  WatchlistSnapshot,
  ScreenSnapshot,
  PromptSnapshot,
} from '@shared/rpc';
import { APP_ENTITY } from '@shared/domain';
import { versionedCell } from './persistence';

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
  baseLine: 0,
  lastUpdatedAt: 0,
  requestsInflight: 0,
  updatesReceived: 0,
  lastError: null,
};
const EMPTY_PROMPTS: PromptSnapshot = { sessionId: null, prompts: [] };

// [LAW:one-source-of-truth] The probe draft is a single last-draft, not a per-entity map: a `\(…)`
// template is interpolation text iTerm2 resolves against whatever entity is focused at eval time, so the
// draft is valid against any entity (the ticket's "reloads against a different entity must still be valid
// text"). Keying it by entity kind would add a dimension with no payload-specific meaning.
const PROBE_DRAFT_CELL = versionedCell<string>({
  key: 'monitor-probe-draft',
  version: 1,
  fallback: () => '',
  decode: (data) => (typeof data === 'string' ? data : null),
});

export class MonitorStore {
  layout: LayoutSnapshot = EMPTY_LAYOUT;
  variables: VariableSnapshot = EMPTY_VARIABLES;
  watchlist: WatchlistSnapshot = EMPTY_WATCHLIST;
  screen: ScreenSnapshot = EMPTY_SCREEN;
  prompts: PromptSnapshot = EMPTY_PROMPTS;
  // [LAW:dataflow-not-control-flow] The semantic overlay is a value the rail reads, not a fork in the
  // render path: enabled or not, the rail maps over the same marks list — disabled simply yields no rail.
  screenOverlayEnabled = true;
  // [LAW:one-source-of-truth] The probe's whole state lives here — the in-progress draft alongside the
  // result and pending flag — so the input field and a variable row that inserts into it write one
  // authority instead of a private copy each. Stranding the draft in component state was the split
  // that made "a row feeds the probe" unrepresentable; unified, it is just another value.
  probeDraft = PROBE_DRAFT_CELL.load();
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
    // [LAW:effects-at-boundaries] The probe draft is mirrored to localStorage from this one boundary
    // reaction, not from setProbeDraft/insertProbeReference. The probe RESULT and pending flag stay
    // ephemeral — only the authored draft is the experiment worth remembering across a restart.
    reaction(
      () => this.probeDraft,
      (draft) => PROBE_DRAFT_CELL.save(draft),
    );
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

  applyPrompts(snap: PromptSnapshot): void {
    this.prompts = snap;
  }

  toggleScreenOverlay(): void {
    this.screenOverlayEnabled = !this.screenOverlayEnabled;
  }

  async hydrate(): Promise<void> {
    const [layout, variables, watchlist, screen, prompts] = await Promise.all([
      window.ipc.invoke('monitor/layout', undefined as never),
      window.ipc.invoke('monitor/variables', undefined as never),
      window.ipc.invoke('monitor/watchlist', undefined as never),
      window.ipc.invoke('monitor/screen', undefined as never),
      window.ipc.invoke('monitor/prompts', undefined as never),
    ]);
    runInAction(() => {
      this.layout = layout;
      this.variables = variables;
      this.watchlist = watchlist;
      this.screen = screen;
      this.prompts = prompts;
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

  setProbeDraft(value: string): void {
    this.probeDraft = value;
  }

  // [LAW:dataflow-not-control-flow] Appends the variable's interpolation reference to the draft as a
  // value; the probe input always renders probeDraft, so a row inserting is the same operation as the
  // user typing. `name` is already iTerm2's full reference — bare for session-local variables
  // (`hostname`) and prefixed for cross-scope frames it surfaces (`tab.title`, `user.foo`) — so it is
  // wrapped exactly once into `\(…)`. Prepending `scope` would emit `\(tab.tab.title)` and fail to
  // resolve; a single full-wrap resolves to the exact path, and successive inserts concatenate into a
  // valid interpolated template the probe evaluates whole.
  insertProbeReference(name: string): void {
    this.probeDraft = `${this.probeDraft}\\(${name})`;
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
