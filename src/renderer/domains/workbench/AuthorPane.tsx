import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';
import { ProfileEditor } from './ProfileEditor';
import { DynamicProfileEditor } from './DynamicProfileEditor';
import { EscapeSequenceEditor } from './EscapeSequenceEditor';
import { RegistrationEditor } from './RegistrationEditor';
import { TriggersViewer } from './TriggersViewer';
import { ArtifactScopeBanner } from './ArtifactScopeBanner';

const RAIL: Array<{ id: WorkbenchArtifact; label: string }> = [
  { id: 'profile', label: 'Profiles' },
  { id: 'dynamic-profile', label: 'Dynamic Profiles' },
  { id: 'escape-sequence', label: 'Escape Sequences' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'triggers', label: 'Triggers' },
];

// Authored behavior: artifacts that preview and act against the focused entity. The entity-scoped
// editors default their target to entityFocus; their invocations feed the Activity facet.
export const AuthorPane = observer(function AuthorPane() {
  const { workbench } = useStore();

  return (
    <div
      className="grid gap-4 p-3 md:grid-cols-[200px_1fr]"
      data-testid="author-pane"
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
      <section className="space-y-4">
        <ArtifactScopeBanner artifact={workbench.artifact} />
        {workbench.artifact === 'profile' && <ProfileEditor />}
        {workbench.artifact === 'dynamic-profile' && <DynamicProfileEditor />}
        {workbench.artifact === 'escape-sequence' && <EscapeSequenceEditor />}
        {workbench.artifact === 'registrations' && <RegistrationEditor />}
        {workbench.artifact === 'triggers' && <TriggersViewer />}
      </section>
    </div>
  );
});
