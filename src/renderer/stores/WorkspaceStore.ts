import { makeAutoObservable, reaction } from 'mobx';
import { LENSES } from '@shared/lenses';
import type { LensId } from '@shared/lenses';

// [LAW:one-source-of-truth] The lens enumeration is owned by @shared/lenses (so a capability's typed
// lens deep-link can name a real LensId without shared importing the renderer). Re-exported here
// because the shell and switcher already source the list and the type from this store.
export { LENSES };
export type { LensId };

const LENS_IDS: ReadonlySet<string> = new Set(LENSES.map((l) => l.id));
const STORAGE_KEY = 'workspace-active-lens';
const STORAGE_KEY_SCREEN = 'workspace-screen-visible';

// [LAW:types-are-the-program] The default is a single lens, not "every panel". Co-presence of all
// subjects — the old flat-facet failure mode — is no longer representable: the workspace is in exactly
// one lens, always. A calm, coherent launch is the only thing a fresh profile can be.
const DEFAULT_LENS: LensId = 'inspect';

// The screen companion is the observe half of the experiment→observe loop, so a fresh workspace shows it
// — it is shell furniture beside every lens, not Inspect-only content, and visible is the calm default.
const DEFAULT_SCREEN_VISIBLE = true;

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

// [LAW:no-silent-failure] Same validation discipline as loadLens: only the two legal serializations map
// to a boolean; anything else (corrupt, hand-edited, written by an older build) falls back to the default
// rather than being silently coerced to false.
function loadScreenVisible(): boolean {
  if (!hasPersistence()) return DEFAULT_SCREEN_VISIBLE;
  const raw = window.localStorage.getItem(STORAGE_KEY_SCREEN);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_SCREEN_VISIBLE;
}

// [LAW:effects-at-boundaries] The write half of the same localStorage boundary as loadLens. The no-op
// is gated on the same typed environment condition — never on catching the write's own exception, which
// would swallow a real persist failure (quota, disabled storage) and make a lens switch look persisted
// when it was not. With a persistence home present, the write runs and any failure surfaces.
function saveLens(id: LensId): void {
  if (!hasPersistence()) return;
  window.localStorage.setItem(STORAGE_KEY, id);
}

function saveScreenVisible(visible: boolean): void {
  if (!hasPersistence()) return;
  window.localStorage.setItem(STORAGE_KEY_SCREEN, String(visible));
}

// [LAW:no-shared-mutable-globals] The single owner of the workspace's persisted view layout: which lens
// is focal, and whether the screen companion is shown beside it. Both are discrete view-state values
// (not continuous region sizes, which react-resizable-panels persists), so they share one owner and one
// persistence boundary. The screen toggle lives here rather than in a per-lens flag because the screen is
// shell furniture beside every lens ([LAW:one-source-of-truth]) — one visibility value, not one per lens.
export class WorkspaceStore {
  activeLens: LensId = loadLens();
  screenVisible: boolean = loadScreenVisible();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // [LAW:effects-at-boundaries] The store mutates pure state; persistence is the one effect, pushed
    // to these boundary reactions rather than fired from inside the setters.
    reaction(
      () => this.activeLens,
      (id) => saveLens(id),
    );
    reaction(
      () => this.screenVisible,
      (visible) => saveScreenVisible(visible),
    );
  }

  isActive(id: LensId): boolean {
    return this.activeLens === id;
  }

  setLens(id: LensId): void {
    this.activeLens = id;
  }

  setScreenVisible(visible: boolean): void {
    this.screenVisible = visible;
  }

  toggleScreen(): void {
    this.screenVisible = !this.screenVisible;
  }
}
