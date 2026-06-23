import { useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useStore } from '@/stores/context';
import { ActivityTimeline } from '@/domains/activity/ActivityTimeline';
import { ActPane } from '@/domains/console/ActPane';
import { AuthorPane } from '@/domains/workbench/AuthorPane';
import { ScreenPane } from '@/domains/monitor/ScreenPane';
import { VariablesPane } from '@/domains/monitor/VariablesPane';
import type { LensId } from '@/stores/WorkspaceStore';
import { EntitySpineRail } from './EntitySpineRail';
import { SettingsOverlay } from './SettingsOverlay';
import { ToastLayer } from './ToastLayer';
import { FacetFrame } from './FacetFrame';
import { LensSwitcher } from './LensSwitcher';
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

// [LAW:decomposition] One resizable region from a list of panels: separators are placed strictly
// between adjacent panels (never leading/trailing), so a region can never render a dangling divider.
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

// [LAW:dataflow-not-control-flow] Each lens is a pure factory from id to focal content. The shell looks
// up the active lens here rather than branching on which facets are shown — there is no "is this panel
// visible" question to ask, because exactly one lens is focal at all times. A lens is a SUBJECT
// (observe + act + author fused), not a verb: Inspect = the focused entity's live state; Events = what
// iTerm2 emits over time; Console = experiment; Build = durable artifacts and static config.
const LENS_CONTENT: Record<LensId, () => ReactNode> = {
  inspect: () => (
    <ResizableStack
      groupId="lens-inspect"
      orientation="horizontal"
      className="h-full"
      items={[
        {
          // Variables + probe are the focal material of the Inspect lens; the screen is its companion,
          // so the default split seats the focus here and gives the companion the smaller share.
          id: 'inspect-variables',
          defaultSize: '62%',
          minSize: '35%',
          node: (
            <FacetFrame title="Variables" testId="facet-variables">
              <VariablesPane />
            </FacetFrame>
          ),
        },
        {
          id: 'inspect-screen',
          defaultSize: '38%',
          minSize: '22%',
          node: (
            <FacetFrame title="Screen" testId="facet-screen">
              <ScreenPane />
            </FacetFrame>
          ),
        },
      ]}
    />
  ),
  events: () => (
    <FacetFrame title="Events" testId="facet-events">
      <ActivityTimeline />
    </FacetFrame>
  ),
  console: () => (
    <FacetFrame title="Console" testId="facet-console">
      <ActPane />
    </FacetFrame>
  ),
  build: () => (
    <FacetFrame title="Build" testId="facet-build">
      <AuthorPane />
    </FacetFrame>
  ),
};

// The single Entity Workspace shell. Two orthogonal axes: the always-present entity rail (the
// app→window→tab→session spine that selects WHOSE state every lens observes/acts/authors against), and
// one focal LENS at a time. There is no facet co-presence and no tab bar — the lens switcher swaps the
// focal subject; the entity rail and Settings utility persist across all lenses.
//
// [LAW:no-ambient-temporal-coupling] This shell is the single lifecycle owner: it hydrates and wires
// every IPC subscription once, here, instead of each lens doing it on mount. Hydration runs
// unconditionally ([LAW:dataflow-not-control-flow]) regardless of which lens is focal — a non-focal
// lens is not unmounted state, it is simply not rendered, so its store stays live and switching to it
// is instant.
//
// [LAW:one-source-of-truth] Which lens is focal is owned by WorkspaceStore; region sizes by
// react-resizable-panels' persisted-layout groups. The layout below is a pure function of those two.
export const EntityWorkspace = observer(function EntityWorkspace() {
  const { monitor, connection, workbench, workspace } = useStore();
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

  return (
    <div className="flex h-screen flex-col" data-testid="entity-workspace">
      <ResizableStack
        groupId="workspace-root"
        orientation="horizontal"
        className="flex-1 p-2"
        items={[
          {
            id: 'rail',
            defaultSize: '18%',
            minSize: '14%',
            maxSize: '28%',
            node: <EntitySpineRail onOpenSettings={() => setSettingsOpen(true)} />,
          },
          {
            id: 'lens',
            defaultSize: '82%',
            minSize: '50%',
            node: (
              <div className="flex h-full flex-col overflow-hidden rounded border">
                <LensSwitcher />
                <div className="min-h-0 flex-1 p-2" data-testid="lens-content">
                  {LENS_CONTENT[workspace.activeLens]()}
                </div>
              </div>
            ),
          },
        ]}
      />
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      <ToastLayer />
    </div>
  );
});
