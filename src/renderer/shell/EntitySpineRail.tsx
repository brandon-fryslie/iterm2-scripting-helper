import { Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LayoutPane } from '@/domains/monitor/LayoutPane';
import { useStore } from '@/stores/context';

// The entity-spine rail replaces the tab bar as top-level navigation. It is always visible and is the
// single selector for entityFocus ([LAW:one-source-of-truth]) — every facet observes/acts/authors
// against whatever this rail focuses. The gear demotes Settings to a utility affordance, not a peer.
export const EntitySpineRail = observer(function EntitySpineRail({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { entityFocus } = useStore();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border" data-testid="entity-spine-rail">
      <header className="flex items-center justify-between gap-2 border-b bg-muted px-3 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide">Entity</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Open settings"
          data-testid="settings-gear"
          onClick={onOpenSettings}
        >
          <Settings className="text-muted-foreground" />
        </Button>
      </header>
      <div
        className="flex items-center gap-2 border-b px-3 py-2 text-xs"
        data-testid="workspace-focus"
        data-focus-kind={entityFocus.kind}
      >
        <span className="text-muted-foreground">focus</span>
        <Badge variant="outline">{entityFocus.kind}</Badge>
        <code className="min-w-0 truncate">{entityFocus.key}</code>
      </div>
      <div className="flex-1 overflow-auto">
        <LayoutPane />
      </div>
    </div>
  );
});
