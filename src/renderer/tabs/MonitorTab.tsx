import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutPane } from './monitor/LayoutPane';
import { VariablesPane } from './monitor/VariablesPane';
import { WirePane } from './monitor/WirePane';
import { NotificationsPane } from './monitor/NotificationsPane';
import { ScreenPane } from './monitor/ScreenPane';
import { KeystrokesPane } from './monitor/KeystrokesPane';
import { PromptsPane } from './monitor/PromptsPane';
import { FocusTimelinePane } from './monitor/FocusTimelinePane';
import { useStore } from '@/stores/context';
import type { ActiveEventTab } from '@/stores/MonitorStore';

const REFRESH_INTERVAL_MS = 250;

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
      unsubWatchlist();
      unsubScreen();
      clearInterval(poll);
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
        <Panel id="monitor-footer" defaultSize={28} minSize={15}>
          <div className="flex h-full flex-col overflow-hidden rounded border">
            <Tabs
              value={monitor.activeEventTab}
              onValueChange={(v) => monitor.setActiveEventTab(v as ActiveEventTab)}
              className="flex h-full flex-col overflow-hidden gap-0"
            >
              <div className="border-b px-2">
                <TabsList variant="line">
                  <TabsTrigger value="keystrokes">Keystrokes</TabsTrigger>
                  <TabsTrigger value="prompts">Prompts</TabsTrigger>
                  <TabsTrigger value="notifications">Notifications</TabsTrigger>
                  <TabsTrigger value="focus">Focus</TabsTrigger>
                  <TabsTrigger value="wire">Wire</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="keystrokes" className="overflow-hidden">
                <KeystrokesPane />
              </TabsContent>
              <TabsContent value="prompts" className="overflow-hidden">
                <PromptsPane />
              </TabsContent>
              <TabsContent value="notifications" className="overflow-hidden">
                <NotificationsPane />
              </TabsContent>
              <TabsContent value="focus" className="overflow-hidden">
                <FocusTimelinePane />
              </TabsContent>
              <TabsContent value="wire" className="overflow-hidden">
                <WirePane />
              </TabsContent>
            </Tabs>
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
