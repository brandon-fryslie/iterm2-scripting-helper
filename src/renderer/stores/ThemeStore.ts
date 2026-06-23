import { makeAutoObservable, reaction } from 'mobx';

// [LAW:one-source-of-truth] The canonical enumeration of themes. A theme is one value, never a pair of
// booleans or a free string; the switcher and the class-deriving effect both read this list so neither
// hard-codes a second notion of "what themes exist" that could drift.
export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));
const STORAGE_KEY = 'workspace-theme';

// [LAW:types-are-the-program] Dark is the default register. The legal space is exactly {dark, light} —
// "no theme" / "both" / "auto-but-unresolved" are unrepresentable, so every surface can assume one of two.
const DEFAULT_THEME: ThemeId = 'dark';

// [LAW:no-silent-failure] Whether a persistence home exists is a typed environment condition, not an
// exception to swallow: outside a renderer (node unit env, SSR) there is no window/localStorage. A real
// localStorage failure in a real renderer is NOT caught — it surfaces rather than masquerading as success.
function hasPersistence(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

// [LAW:no-shared-mutable-globals] The document's theme class is shared mutable global state; its single
// owner is this store's effect. Whether a document exists is the same kind of typed environment condition
// as persistence — absent in the node unit env, present in every renderer — so the class write no-ops
// there without swallowing a genuine fault.
function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// [LAW:no-silent-failure] A corrupt or stale value (hand-edited, or written by an older theme set) is not
// a failure — it is an unknown id that falls back to the default by validation. The read itself is not
// wrapped in a swallowing catch: with persistence present, a getItem that throws is a real fault, surfaced.
function loadTheme(): ThemeId {
  if (!hasPersistence()) return DEFAULT_THEME;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw !== null && THEME_IDS.has(raw) ? (raw as ThemeId) : DEFAULT_THEME;
}

// [LAW:effects-at-boundaries] The write half of the same localStorage boundary as loadTheme. The no-op is
// gated on the typed environment condition, never on catching the write's own exception.
function saveTheme(theme: ThemeId): void {
  if (!hasPersistence()) return;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

// [LAW:no-shared-mutable-globals] The single owner of which register the app is painted in. The theme is
// one observable value; the `dark` class on <html> is DERIVED from it, never an independent source — which
// is why index.html no longer asserts the class. [LAW:effects-at-boundaries] the store mutates pure state;
// both the class application and persistence are pushed to one boundary reaction. fireImmediately makes
// that reaction the single owner of the INITIAL application too, so there is no second place (a hardcoded
// html class, a mount effect) that decides the opening register. [LAW:no-ambient-temporal-coupling]
// because RootStore is constructed before React renders, that initial application lands before first paint.
export class ThemeStore {
  theme: ThemeId = loadTheme();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // The class is DERIVED state and must match `theme` from the very first paint, so its reaction fires
    // immediately — this reaction is the single owner of the opening register.
    reaction(
      () => this.theme,
      (theme) => applyTheme(theme),
      { fireImmediately: true },
    );
    // Persistence records only what the user CHOSE, so it does not fire immediately — re-writing the
    // loaded value on construction would be a write nothing asked for.
    reaction(
      () => this.theme,
      (theme) => saveTheme(theme),
    );
  }

  isActive(id: ThemeId): boolean {
    return this.theme === id;
  }

  setTheme(id: ThemeId): void {
    this.theme = id;
  }

  toggle(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
  }
}
