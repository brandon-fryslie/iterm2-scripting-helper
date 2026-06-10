import { Group, Panel, Separator } from 'react-resizable-panels';
import { ScreenPane } from '@/domains/monitor/ScreenPane';
import { VariablesPane } from '@/domains/monitor/VariablesPane';
import { usePersistedLayout } from '@/shell/usePersistedLayout';

// Live state: a fold over the focused entity — what it looks like (screen) and what it holds
// (variables) right now. Both panes read entityFocus from context, so this facet asks for nothing
// ([LAW:composability]) and the shell drops it into a region with no wiring.
export function LiveStateFacet() {
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      {...usePersistedLayout('workspace-live')}
    >
      <Panel id="live-screen" defaultSize="62%" minSize="30%">
        <div className="flex h-full flex-col overflow-hidden rounded border">
          <ScreenPane />
        </div>
      </Panel>
      <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
      <Panel id="live-variables" defaultSize="38%" minSize="20%">
        <div className="flex h-full flex-col overflow-hidden rounded border">
          <VariablesPane />
        </div>
      </Panel>
    </Group>
  );
}
