import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';
import { ARTIFACT_SCOPE } from './scope';

// [FRAMING:representation] One banner renders an artifact's scope so connection-wide vs
// entity-scoped authoring is visually unambiguous. Entity-scoped artifacts additionally
// report whether the current focus can actually be acted on (a live session) — the surface
// never pretends a non-session focus is a valid target ([LAW:no-silent-failure]).
export const ArtifactScopeBanner = observer(function ArtifactScopeBanner({
  artifact,
}: {
  artifact: WorkbenchArtifact;
}) {
  const { entityFocus } = useStore();
  const scope = ARTIFACT_SCOPE[artifact];
  const entityScoped = scope.kind === 'entity';
  const sessionId = entityFocus.sessionId;
  const focusReady = entityScoped && sessionId !== null;
  const focusMismatch = entityScoped && sessionId === null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs',
        focusMismatch ? 'border-warning/50 bg-warning/10' : 'bg-muted',
      )}
      data-testid="artifact-scope-banner"
      data-scope={scope.kind}
      data-focus-ready={entityScoped ? String(focusReady) : undefined}
    >
      <Badge variant={entityScoped ? 'default' : 'outline'}>{scope.label}</Badge>
      <span className="text-muted-foreground">{scope.blurb}</span>
      {focusReady ? (
        <span className="ml-auto flex items-center gap-1">
          <span className="text-muted-foreground">focused session</span>
          <code className="font-mono">{sessionId.slice(0, 12)}…</code>
        </span>
      ) : null}
      {focusMismatch ? (
        <span className="ml-auto text-warning">
          Focus a session (or override the target below) to act.
        </span>
      ) : null}
    </div>
  );
});
