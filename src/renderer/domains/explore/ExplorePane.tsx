import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { buildCapabilityCatalog, searchCapabilities } from '@shared/capabilities';
import type { Capability, CapabilityKindFilter, DocLink } from '@shared/capabilities';
import { LENSES } from '@shared/lenses';
import type { LensId } from '@shared/lenses';

// Built once: the catalog is pure and version-stable for a given build, so there is nothing to recompute
// per render or per keystroke.
const CATALOG = buildCapabilityCatalog();

// [LAW:one-source-of-truth] Lens labels for the "Open in …" verb come from the one LENSES list, not a
// second hand-kept map — a renamed lens relabels its deep-link buttons for free.
const LENS_LABEL = Object.fromEntries(LENSES.map((l) => [l.id, l.label])) as Record<LensId, string>;

const KIND_FILTERS: readonly { id: CapabilityKindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read' },
  { id: 'mutate', label: 'Mutate' },
];

// [LAW:dataflow-not-control-flow] The deep-link's kind chooses the row's verb — an exhaustive match over
// the three DocLink shapes, mirroring RootStore.navigateToDoc. A capability with no link renders no button
// (the honest "reference-only" state), so this is never called with null.
function tryLabel(link: DocLink): string {
  switch (link.kind) {
    case 'console':
      return 'Try in Console';
    case 'escape':
      return 'Open in Build';
    case 'lens':
      return `Open in ${LENS_LABEL[link.lens]}`;
  }
}

// The Explore lens: a searchable index of every iTerm2 capability the app can drive — all 55 RPC methods
// plus the escape and template catalogs — each tagged read/mutate and deep-linking to where you can try
// it. The pane owns only the query and kind filter; selecting a row hands its link to the single
// navigator (RootStore.navigateToDoc) and is otherwise stateless. [LAW:single-enforcer]
export function ExplorePane() {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CapabilityKindFilter>('all');
  const results = useMemo<Capability[]>(
    () => searchCapabilities(CATALOG, query, kind),
    [query, kind],
  );

  return (
    <div className="flex h-full flex-col gap-2 p-2" data-testid="explore-pane">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the API surface — name, wire message, OSC code…"
        data-testid="explorer-search-input"
      />
      <div className="flex items-center gap-1" data-testid="explorer-kind-filter">
        {KIND_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={kind === f.id ? 'secondary' : 'ghost'}
            aria-pressed={kind === f.id}
            data-testid={`explorer-kind-${f.id}`}
            onClick={() => setKind(f.id)}
          >
            {f.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground" data-testid="explorer-count">
          {results.length} / {CATALOG.length}
        </span>
      </div>
      {results.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
          data-testid="explorer-no-match"
        >
          No capabilities match “{query}”.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto" data-testid="explorer-results">
          {results.map((cap) => {
            const link = cap.link;
            return (
              <li
                key={cap.id}
                className="rounded border px-2 py-2"
                data-testid={`explorer-result-${cap.id}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {cap.group}
                  </Badge>
                  <Badge
                    variant={cap.kind === 'read' ? 'secondary' : 'default'}
                    className="shrink-0"
                    data-testid={`explorer-kind-badge-${cap.id}`}
                  >
                    {cap.kind}
                  </Badge>
                  <span className="font-medium">{cap.title}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {cap.reference}
                  </span>
                  {link && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto shrink-0"
                      data-testid={`explorer-try-${cap.id}`}
                      onClick={() => store.navigateToDoc(link)}
                    >
                      {tryLabel(link)}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{cap.summary}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
