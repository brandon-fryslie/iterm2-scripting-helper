import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { LayoutPane } from './monitor/LayoutPane';
import { VariablesPane } from './monitor/VariablesPane';
import { WirePane } from './monitor/WirePane';
import { NotificationsPane } from './monitor/NotificationsPane';
import { ScreenPane } from './monitor/ScreenPane';
import { KeystrokesPane } from './monitor/KeystrokesPane';
import { PromptsPane } from './monitor/PromptsPane';
import { FocusTimelinePane } from './monitor/FocusTimelinePane';
import { useStore } from '@/stores/context';

const REFRESH_INTERVAL_MS = 250;

export const MonitorTab = observer(function MonitorTab() {
  const { monitor } = useStore();

  useEffect(() => {
    void monitor.hydrate();
    const unsubLayout = window.ipc.on('layout-snapshot', (s) => monitor.applyLayout(s));
    const unsubVars = window.ipc.on('variables-snapshot', (s) =>
      monitor.applyVariables(s),
    );
    const unsubScreen = window.ipc.on('screen-snapshot', (s) => monitor.applyScreen(s));

    const poll = setInterval(() => {
      void monitor.refreshKeystrokes();
      void monitor.refreshPrompts();
      void monitor.refreshFocus();
      void monitor.refreshWire();
      void monitor.refreshNotifications();
    }, REFRESH_INTERVAL_MS);

    return () => {
      unsubLayout();
      unsubVars();
      unsubScreen();
      clearInterval(poll);
    };
  }, [monitor]);

  return (
    <div className="h-[calc(100vh-6rem)]" data-testid="tab-monitor-placeholder">
      <Group orientation="vertical" className="h-full">
        <Panel defaultSize={50} minSize={20}>
          <Group orientation="horizontal" className="h-full">
            <PaneCell title="Layout">
              <LayoutPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Variables">
              <VariablesPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Screen">
              <ScreenPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Wire">
              <WirePane />
            </PaneCell>
          </Group>
        </Panel>
        <Separator className="h-[2px] bg-border transition-colors hover:bg-primary" />
        <Panel defaultSize={50} minSize={20}>
          <Group orientation="horizontal" className="h-full">
            <PaneCell title="Keystrokes">
              <KeystrokesPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Prompts">
              <PromptsPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Notifications">
              <NotificationsPane />
            </PaneCell>
            <Separator className="w-[2px] bg-border transition-colors hover:bg-primary" />
            <PaneCell title="Focus">
              <FocusTimelinePane />
            </PaneCell>
          </Group>
        </Panel>
      </Group>
    </div>
  );
});

function PaneCell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel defaultSize={25} minSize={10}>
      <div className="flex h-full flex-col rounded border">
        <div className="border-b bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          {title}
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Panel>
  );
}
