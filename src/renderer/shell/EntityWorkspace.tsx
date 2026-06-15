import { useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useStore } from '@/stores/context';
import { ActivityTimeline } from '@/domains/activity/ActivityTimeline';
import { ActPane } from '@/domains/console/ActPane';
import { AuthorPane } from '@/domains/workbench/AuthorPane';
import { ScreenPane } from '@/domains/monitor/ScreenPane';
import { VariablesPane } from '@/domains/monitor/VariablesPane';
import { EntitySpineRail } from './EntitySpineRail';
import { SettingsOverlay } from './SettingsOverlay';
import { ToastLayer } from './ToastLayer';
import { FacetFrame } from './FacetFrame';
import { FacetToggleBar } from './FacetToggleBar';
import { usePersistedLayout } from './usePersistedLayout';

const SEP_V = 'h-[2px] bg-border transition-colors hover:bg-primary';
const SEP_H = 'w-[2px] bg-border transition-colors hover:bg-primary';

type StackItem = {
  id: string;
  defaultSize: string;
  minSize?: string;
  maxSize?: string;
  node: ReactNode;
};

// Drop the `false` entries (hidden facets / empty containers) and narrow to real items, so the layout
// below reads as a list of what IS shown rather than a thicket of conditionals. [LAW:dataflow-not-control-flow]
function stack(...items: Array<StackItem | false>): StackItem[] {
  return items.filter((item): item is StackItem => item !== false);
}

// [LAW:decomposition] One resizable region from a list of currently-visible panels: separators are
// placed strictly between adjacent panels (never a leading/trailing one), so hiding any facet can
// never leave a dangling divider. Empty is the caller's concern — a region with no visible panels is
// never asked to render (it is dropped from its parent's stack()).
function ResizableStack({
  groupId,
  orientation,
  className,
  items,
}: {
  groupId: string;
  orientation: 'horizontal' | 'vertical';
  className: string;
  items: StackItem[];
}) {
  const sep = orientation === 'horizontal' ? SEP_H : SEP_V;
  const children: ReactNode[] = [];
  items.forEach((item, i) => {
    if (i > 0) children.push(<Separator key={`sep-${item.id}`} className={sep} />);
    children.push(
      <Panel
        key={item.id}
        id={item.id}
        defaultSize={item.defaultSize}
        minSize={item.minSize}
        maxSize={item.maxSize}
      >
        {item.node}
      </Panel>,
    );
  });
  return (
    <Group orientation={orientation} className={className} {...usePersistedLayout(groupId)}>
      {children}
    </Group>
  );
}

// The single Entity Workspace shell. There is no tab bar: the app is one panel anchored to the focused
// entity, with observe (Screen + Variables + Activity), act (Act), and author (Author) facets — none a
// destination you switch to. The facet toggle bar shows/hides each facet on demand so the workspace is
// not forced to co-present everything at once.
//
// [LAW:no-ambient-temporal-coupling] This shell is the single lifecycle owner: it hydrates and wires
// every IPC subscription once, here, instead of each facet doing it on mount. Hydration runs
// unconditionally ([LAW:dataflow-not-control-flow]) regardless of which facets are currently shown — a
// hidden facet is not unmounted state, it is simply not rendered, so its store stays live and showing
// it again is instant.
//
// [LAW:one-source-of-truth] Which facets are visible is owned by WorkspaceLayoutStore; region sizes by
// react-resizable-panels' persisted-layout groups. The layout below is a pure function of those two.
export const EntityWorkspace = observer(function EntityWorkspace() {
  const { monitor, connection, workbench, workspaceLayout } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void monitor.hydrate();
    void connection.refresh();
    void workbench.refreshProfiles();
    void workbench.refreshDynamicProfiles();
    const unsubs = [
      window.ipc.on('layout-snapshot', (s) => monitor.applyLayout(s)),
      window.ipc.on('variables-snapshot', (s) => monitor.applyVariables(s)),
      window.ipc.on('watchlist-snapshot', (s) => monitor.applyWatchlist(s)),
      window.ipc.on('screen-snapshot', (s) => monitor.applyScreen(s)),
      window.ipc.on('dynamic-profiles-snapshot', (s) =>
        workbench.applyDynamicSnapshot(s),
      ),
      window.ipc.on('connection-state', (s) => connection.apply(s)),
      window.ipc.on('wire-frame', () => connection.bumpFrame()),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [monitor, connection, workbench]);

  const visible = (id: Parameters<typeof workspaceLayout.isVisible>[0]) =>
    workspaceLayout.isVisible(id);

  const liveItems = stack(
    visible('screen') && {
      id: 'live-screen',
      defaultSize: '62%',
      minSize: '30%',
      node: (
        <FacetFrame title="Screen" testId="facet-screen">
          <ScreenPane />
        </FacetFrame>
      ),
    },
    visible('variables') && {
      id: 'live-variables',
      defaultSize: '38%',
      minSize: '20%',
      node: (
        <FacetFrame title="Variables" testId="facet-variables">
          <VariablesPane />
        </FacetFrame>
      ),
    },
  );

  const observeItems = stack(
    liveItems.length > 0 && {
      id: 'live',
      defaultSize: '60%',
      minSize: '25%',
      node: (
        <ResizableStack
          groupId="workspace-live"
          orientation="horizontal"
          className="h-full"
          items={liveItems}
        />
      ),
    },
    visible('activity') && {
      id: 'activity',
      defaultSize: '40%',
      minSize: '20%',
      node: (
        <FacetFrame title="Activity" testId="facet-activity">
          <ActivityTimeline />
        </FacetFrame>
      ),
    },
  );

  const actAuthorItems = stack(
    visible('act') && {
      id: 'act',
      defaultSize: '45%',
      minSize: '20%',
      node: (
        <FacetFrame title="Act" testId="facet-act">
          <ActPane />
        </FacetFrame>
      ),
    },
    visible('author') && {
      id: 'author',
      defaultSize: '55%',
      minSize: '25%',
      node: (
        <FacetFrame title="Author" testId="facet-author">
          <AuthorPane />
        </FacetFrame>
      ),
    },
  );

  const rootItems = stack(
    visible('rail') && {
      id: 'rail',
      defaultSize: '18%',
      minSize: '14%',
      maxSize: '28%',
      node: <EntitySpineRail onOpenSettings={() => setSettingsOpen(true)} />,
    },
    observeItems.length > 0 && {
      id: 'observe',
      defaultSize: '52%',
      minSize: '30%',
      node: (
        <ResizableStack
          groupId="workspace-observe"
          orientation="vertical"
          className="h-full"
          items={observeItems}
        />
      ),
    },
    actAuthorItems.length > 0 && {
      id: 'act-author',
      defaultSize: '30%',
      minSize: '20%',
      node: (
        <ResizableStack
          groupId="workspace-act-author"
          orientation="vertical"
          className="h-full"
          items={actAuthorItems}
        />
      ),
    },
  );

  return (
    <div className="flex h-screen flex-col" data-testid="entity-workspace">
      <FacetToggleBar />
      {rootItems.length > 0 ? (
        <ResizableStack
          groupId="workspace-root"
          orientation="horizontal"
          className="flex-1 p-2"
          items={rootItems}
        />
      ) : (
        // [LAW:no-silent-failure] All facets hidden is a state, not a blank void — say so and point
        // at the way back, so the toggle bar never strands the user on an empty screen.
        <div
          className="flex flex-1 items-center justify-center p-2 text-sm text-muted-foreground"
          data-testid="workspace-empty"
        >
          All panels are hidden — use the Panels bar above to show one.
        </div>
      )}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      <ToastLayer />
    </div>
  );
});
