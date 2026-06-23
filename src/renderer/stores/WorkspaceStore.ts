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

// [LAW:no-silent-failure] Whether a persistence home exists is a typed environment condition, not an
// exception to swallow: outside a renderer (node unit env, SSR) there is no window/localStorage, and
// that absence is the one legitimate no-op. A genuine localStorage failure in a real renderer is NOT
// caught here — it surfaces rather than masquerading as success. (Electron renderers always expose
// localStorage, so the absent case is exactly the test/SSR env, never a privacy-mode browser quirk.)
function hasPersistence(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

// [LAW:no-silent-failure] A corrupt or stale value (hand-edited, or written by an older lens set) is
// not a failure — it is an unknown id that falls back to the default lens by validation, so a removed
// lens's leftover entry cannot strand the workspace. The read itself is not wrapped in a swallowing
// catch: with persistence present, a getItem that throws is a real fault, surfaced not hidden.
function loadLens(): LensId {
  if (!hasPersistence()) return DEFAULT_LENS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw !== null && LENS_IDS.has(raw) ? (raw as LensId) : DEFAULT_LENS;
}

// [LAW:effects-at-boundaries] The write half of the same localStorage boundary as loadLens. The no-op
// is gated on the same typed environment condition — never on catching the write's own exception, which
// would swallow a real persist failure (quota, disabled storage) and make a lens switch look persisted
// when it was not. With a persistence home present, the write runs and any failure surfaces.
function saveLens(id: LensId): void {
  if (!hasPersistence()) return;
  window.localStorage.setItem(STORAGE_KEY, id);
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
      (id) => saveLens(id),
    );
  }

  isActive(id: LensId): boolean {
    return this.activeLens === id;
  }

  setLens(id: LensId): void {
    this.activeLens = id;
  }
}
