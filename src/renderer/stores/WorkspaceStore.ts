import { makeAutoObservable, reaction } from 'mobx';

// [LAW:one-source-of-truth] The canonical enumeration of workspace lenses and their switcher labels.
// A lens is a SUBJECT (observe + act + author fused), not a verb. The switcher maps over this list and
// the shell renders the active lens against it; neither hard-codes a second list that could drift.
export const LENSES = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'events', label: 'Events' },
  { id: 'console', label: 'Console' },
  { id: 'build', label: 'Build' },
] as const;

export type LensId = (typeof LENSES)[number]['id'];

const LENS_IDS: ReadonlySet<string> = new Set(LENSES.map((l) => l.id));
const STORAGE_KEY = 'workspace-active-lens';

// [LAW:types-are-the-program] The default is a single lens, not "every panel". Co-presence of all
// subjects — the old flat-facet failure mode — is no longer representable: the workspace is in exactly
// one lens, always. A calm, coherent launch is the only thing a fresh profile can be.
const DEFAULT_LENS: LensId = 'inspect';

// [LAW:no-silent-failure] localStorage is a trust boundary: a corrupt or stale value (hand-edited, or
// written by an older lens set) falls back to the default lens, never trusted into the live shell. An
// unknown id is not honored, so a removed lens's leftover entry cannot strand the workspace.
function loadLens(): LensId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && LENS_IDS.has(raw) ? (raw as LensId) : DEFAULT_LENS;
  } catch {
    return DEFAULT_LENS;
  }
}

// [LAW:no-shared-mutable-globals] The single owner of which lens is focal. Visibility is one observable
// value (the active lens id), persisted to localStorage the same way region sizes are.
export class WorkspaceStore {
  activeLens: LensId = loadLens();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // [LAW:effects-at-boundaries] The store mutates pure state; persistence is the one effect, pushed
    // to this boundary reaction rather than fired from inside setLens().
    reaction(
      () => this.activeLens,
      (id) => window.localStorage.setItem(STORAGE_KEY, id),
    );
  }

  isActive(id: LensId): boolean {
    return this.activeLens === id;
  }

  setLens(id: LensId): void {
    this.activeLens = id;
  }
}
