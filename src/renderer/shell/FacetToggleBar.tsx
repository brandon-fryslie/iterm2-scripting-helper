import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import { FACETS } from '@/stores/WorkspaceLayoutStore';

// [LAW:dataflow-not-control-flow] One button per facet, rendered by mapping the canonical FACETS list
// — the bar carries no per-facet branches. Each button's pressed state and variant are a function of
// the store's visibility for that id, so adding a facet to FACETS adds its toggle here for free.
export const FacetToggleBar = observer(function FacetToggleBar() {
  const { workspaceLayout } = useStore();
  return (
    <div
      className="flex items-center gap-1 border-b px-2 py-1"
      data-testid="facet-toggle-bar"
    >
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Panels
      </span>
      {FACETS.map((facet) => {
        const visible = workspaceLayout.isVisible(facet.id);
        return (
          <Button
            key={facet.id}
            size="xs"
            variant={visible ? 'secondary' : 'ghost'}
            aria-pressed={visible}
            data-testid={`facet-toggle-${facet.id}`}
            onClick={() => workspaceLayout.toggle(facet.id)}
          >
            {facet.label}
          </Button>
        );
      })}
    </div>
  );
});
