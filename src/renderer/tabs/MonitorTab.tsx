import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { LayoutPane } from './monitor/LayoutPane';
import { VariablesPane } from './monitor/VariablesPane';
import { WirePane } from './monitor/WirePane';
import { NotificationsPane } from './monitor/NotificationsPane';
import { useStore } from '@/stores/context';

export const MonitorTab = observer(function MonitorTab() {
  const { monitor } = useStore();

  useEffect(() => {
    void monitor.hydrate();
    const unsubLayout = window.ipc.on('layout-snapshot', (s) => monitor.applyLayout(s));
    const unsubVars = window.ipc.on('variables-snapshot', (s) =>
      monitor.applyVariables(s),
    );
    const unsubWire = window.ipc.on('wire-snapshot', (s) => monitor.applyWire(s));
    const unsubNotifications = window.ipc.on('notifications-snapshot', (s) =>
      monitor.applyNotifications(s),
    );
    return () => {
      unsubLayout();
      unsubVars();
      unsubWire();
      unsubNotifications();
    };
  }, [monitor]);

  return (
    <div className="h-[calc(100vh-6rem)]" data-testid="tab-monitor-placeholder">
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize={25} minSize={15}>
          <PaneFrame title="Layout">
            <LayoutPane />
          </PaneFrame>
        </Panel>
        <DividerV />
        <Panel defaultSize={25} minSize={15}>
          <PaneFrame title="Variables">
            <VariablesPane />
          </PaneFrame>
        </Panel>
        <DividerV />
        <Panel defaultSize={25} minSize={15}>
          <PaneFrame title="Notifications">
            <NotificationsPane />
          </PaneFrame>
        </Panel>
        <DividerV />
        <Panel defaultSize={25} minSize={15}>
          <PaneFrame title="Wire">
            <WirePane />
          </PaneFrame>
        </Panel>
      </Group>
    </div>
  );
});

function PaneFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded border">
      <div className="border-b bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
        {title}
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function DividerV() {
  return (
    <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
  );
}
