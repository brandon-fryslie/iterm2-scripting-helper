import { makeAutoObservable, reaction } from 'mobx';

// [LAW:one-source-of-truth] The canonical enumeration of toggleable workspace facets and their
// toolbar labels. The toggle bar maps over this list and the shell reads visibility against these
// ids; neither hard-codes a second list that could drift out of sync. A facet absent here is not
// toggleable, by construction.
export const FACETS = [
  { id: 'rail', label: 'Entity' },
  { id: 'screen', label: 'Screen' },
  { id: 'variables', label: 'Variables' },
  { id: 'activity', label: 'Activity' },
  { id: 'act', label: 'Act' },
  { id: 'author', label: 'Author' },
] as const;

export type FacetId = (typeof FACETS)[number]['id'];

const FACET_IDS: ReadonlySet<string> = new Set(FACETS.map((f) => f.id));
const STORAGE_KEY = 'workspace-facet-hidden';

// [LAW:no-silent-failure] localStorage is a trust boundary: a corrupt or stale payload (hand-edited,
// or written by an older facet set) is rejected to the default-all-visible state, never trusted into
// the live layout. Unknown ids are filtered, so a removed facet's leftover entry cannot hide a real
// one and a new facet defaults visible (absent from the hidden set).
function loadHidden(): Set<FacetId> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is FacetId => typeof x === 'string' && FACET_IDS.has(x)));
  } catch {
    return new Set();
  }
}

// [LAW:no-shared-mutable-globals] The single owner of which facets are shown. Visibility is one
// observable set (the hidden ids), persisted to localStorage the same way region sizes are. Default
// is all-visible (empty hidden set), so a fresh profile sees the full workspace.
export class WorkspaceLayoutStore {
  hidden: Set<FacetId> = loadHidden();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // [LAW:effects-at-boundaries] The store mutates pure state; persistence is the one effect, pushed
    // to this boundary reaction rather than fired from inside toggle().
    reaction(
      () => Array.from(this.hidden).sort(),
      (ids) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)),
    );
  }

  isVisible(id: FacetId): boolean {
    return !this.hidden.has(id);
  }

  toggle(id: FacetId): void {
    // A new Set per change so MobX observers re-run on a reference change, never an in-place mutation.
    const next = new Set(this.hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hidden = next;
  }
}
