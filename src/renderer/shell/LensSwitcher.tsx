import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import { LENSES } from '@/stores/WorkspaceStore';

// [LAW:dataflow-not-control-flow] One segment per lens, rendered by mapping the canonical LENSES list —
// the switcher carries no per-lens branches. Each segment's pressed state is a function of the store's
// active lens, so adding a lens to LENSES adds its segment here for free.
export const LensSwitcher = observer(function LensSwitcher() {
  const { workspace } = useStore();
  return (
    <div
      className="flex items-center gap-1 border-b px-2 py-1"
      data-testid="lens-switcher"
    >
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Lens
      </span>
      {LENSES.map((lens) => {
        const active = workspace.isActive(lens.id);
        return (
          <Button
            key={lens.id}
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            aria-pressed={active}
            data-testid={`lens-${lens.id}`}
            onClick={() => workspace.setLens(lens.id)}
          >
            {lens.label}
          </Button>
        );
      })}
    </div>
  );
});
