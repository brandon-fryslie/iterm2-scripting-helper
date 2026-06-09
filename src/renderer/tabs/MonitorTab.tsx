import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { LayoutPane } from './monitor/LayoutPane';
import { VariablesPane } from './monitor/VariablesPane';
import { ScreenPane } from './monitor/ScreenPane';
import { ActivityTimeline } from './activity/ActivityTimeline';
import { useStore } from '@/stores/context';

export const MonitorTab = observer(function MonitorTab() {
  const { monitor } = useStore();

  useEffect(() => {
    void monitor.hydrate();
    const unsubLayout = window.ipc.on('layout-snapshot', (s) => monitor.applyLayout(s));
    const unsubVars = window.ipc.on('variables-snapshot', (s) =>
      monitor.applyVariables(s),
    );
    const unsubWatchlist = window.ipc.on('watchlist-snapshot', (s) =>
      monitor.applyWatchlist(s),
    );
    const unsubScreen = window.ipc.on('screen-snapshot', (s) => monitor.applyScreen(s));

    return () => {
      unsubLayout();
      unsubVars();
      unsubWatchlist();
      unsubScreen();
    };
  }, [monitor]);

  return (
    <div className="h-[calc(100vh-6rem)]" data-testid="tab-monitor-placeholder">
      <Group orientation="vertical" className="h-full">
        <Panel id="monitor-body" defaultSize={72} minSize={40}>
          <Group orientation="horizontal" className="h-full">
            <PaneCell id="monitor-layout" title="Layout" defaultSize={18} minSize={12}>
              <LayoutPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <Panel id="monitor-screen" defaultSize={57} minSize={30}>
              <div className="flex h-full flex-col overflow-hidden rounded border">
                <ScreenPane />
              </div>
            </Panel>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell id="monitor-variables" title="Variables" defaultSize={25} minSize={15}>
              <VariablesPane />
            </PaneCell>
          </Group>
        </Panel>
        <Separator className="h-[2px] bg-border transition-colors hover:bg-primary" />
        <Panel id="monitor-activity" defaultSize={28} minSize={15}>
          <div className="flex h-full flex-col overflow-hidden rounded border">
            <ActivityTimeline />
          </div>
        </Panel>
      </Group>
    </div>
  );
});

function PaneCell({
  id,
  title,
  children,
  defaultSize,
  minSize,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultSize: number;
  minSize: number;
}) {
  return (
    <Panel id={id} defaultSize={defaultSize} minSize={minSize}>
      <div className="flex h-full flex-col rounded border">
        <div className="border-b bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          {title}
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Panel>
  );
}
