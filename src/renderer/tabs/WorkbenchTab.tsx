import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';
import { ProfileEditor } from './workbench/ProfileEditor';
import { DynamicProfileEditor } from './workbench/DynamicProfileEditor';
import { EscapeSequenceEditor } from './workbench/EscapeSequenceEditor';

const RAIL: Array<{ id: WorkbenchArtifact; label: string }> = [
  { id: 'profile', label: 'Profiles' },
  { id: 'dynamic-profile', label: 'Dynamic Profiles' },
  { id: 'escape-sequence', label: 'Escape Sequences' },
];

export const WorkbenchTab = observer(function WorkbenchTab() {
  const { workbench, monitor } = useStore();

  useEffect(() => {
    if (!workbench.profilesLoaded) void workbench.refreshProfiles();
    void workbench.refreshDynamicProfiles();
    if (monitor.layout.windows.length === 0) void monitor.hydrate();
    const unsub = window.ipc.on('dynamic-profiles-snapshot', (snap) =>
      workbench.applyDynamicSnapshot(snap),
    );
    return () => unsub();
  }, [workbench, monitor]);

  return (
    <div
      className="grid gap-4 md:grid-cols-[200px_1fr]"
      data-testid="tab-workbench-placeholder"
    >
      <aside className="space-y-1" data-testid="workbench-rail">
        {RAIL.map((r) => (
          <Button
            key={r.id}
            variant={workbench.artifact === r.id ? 'default' : 'outline'}
            className="w-full justify-start"
            onClick={() => workbench.setArtifact(r.id)}
            data-testid={`workbench-rail-${r.id}`}
          >
            {r.label}
          </Button>
        ))}
      </aside>
      <section>
        {workbench.artifact === 'profile' && <ProfileEditor />}
        {workbench.artifact === 'dynamic-profile' && <DynamicProfileEditor />}
        {workbench.artifact === 'escape-sequence' && <EscapeSequenceEditor />}
      </section>
    </div>
  );
});
