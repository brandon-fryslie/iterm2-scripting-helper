import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useStore } from '@/stores/context';
import { ActivityTimeline } from '@/domains/activity/ActivityTimeline';
import { ActPane } from '@/domains/console/ActPane';
import { AuthorPane } from '@/domains/workbench/AuthorPane';
import { EntitySpineRail } from './EntitySpineRail';
import { LiveStateFacet } from './facets/LiveStateFacet';
import { SettingsOverlay } from './SettingsOverlay';
import { ToastLayer } from './ToastLayer';
import { FacetFrame } from './FacetFrame';
import { usePersistedLayout } from './usePersistedLayout';

const SEP_V = 'h-[2px] bg-border transition-colors hover:bg-primary';
const SEP_H = 'w-[2px] bg-border transition-colors hover:bg-primary';

// The single Entity Workspace shell. There is no tab bar: the app is one panel anchored to the
// focused entity, with observe (Live state + Activity), act (Act), and author (Author) co-present as
// facets — none a destination you switch to.
//
// [LAW:no-ambient-temporal-coupling] This shell is the single lifecycle owner: it hydrates and wires
// every IPC subscription once, here, instead of each facet doing it on mount. Co-presence means there
// is no "did the other tab already load" question, so the old per-tab defensive hydrate guards are
// gone — hydration runs unconditionally ([LAW:dataflow-not-control-flow]).
//
// [LAW:one-source-of-truth] Region sizing/persistence is owned by react-resizable-panels' autoSaveId
// groups — one mechanism, no bespoke "active region" state.
export const EntityWorkspace = observer(function EntityWorkspace() {
  const { monitor, connection, workbench } = useStore();
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
      <Group
        orientation="horizontal"
        className="flex-1 p-2"
        {...usePersistedLayout('workspace-root')}
      >
        <Panel id="rail" defaultSize="18%" minSize="14%" maxSize="28%">
          <EntitySpineRail onOpenSettings={() => setSettingsOpen(true)} />
        </Panel>
        <Separator className={SEP_H} />
        <Panel id="observe" defaultSize="52%" minSize="30%">
          <Group
            orientation="vertical"
            className="h-full"
            {...usePersistedLayout('workspace-observe')}
          >
            <Panel id="live" defaultSize="60%" minSize="25%">
              <FacetFrame title="Live state" testId="facet-live">
                <LiveStateFacet />
              </FacetFrame>
            </Panel>
            <Separator className={SEP_V} />
            <Panel id="activity" defaultSize="40%" minSize="20%">
              <FacetFrame title="Activity" testId="facet-activity">
                <ActivityTimeline />
              </FacetFrame>
            </Panel>
          </Group>
        </Panel>
        <Separator className={SEP_H} />
        <Panel id="act-author" defaultSize="30%" minSize="20%">
          <Group
            orientation="vertical"
            className="h-full"
            {...usePersistedLayout('workspace-act-author')}
          >
            <Panel id="act" defaultSize="45%" minSize="20%">
              <FacetFrame title="Act" testId="facet-act">
                <ActPane />
              </FacetFrame>
            </Panel>
            <Separator className={SEP_V} />
            <Panel id="author" defaultSize="55%" minSize="25%">
              <FacetFrame title="Author" testId="facet-author">
                <AuthorPane />
              </FacetFrame>
            </Panel>
          </Group>
        </Panel>
      </Group>
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      <ToastLayer />
    </div>
  );
});
