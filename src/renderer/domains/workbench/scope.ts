import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';

// [FRAMING:representation] An artifact's scope — what it actually acts on — is a fixed
// domain fact, not a per-editor decision. The surface must tell the truth about scope, so
// the truth lives in exactly one typed place ([LAW:one-source-of-truth]) and every editor
// renders from it instead of each re-deciding (and drifting).
export type ArtifactScopeKind = 'connection' | 'profile' | 'entity';

export interface ArtifactScope {
  kind: ArtifactScopeKind;
  // Short noun shown on the scope badge.
  label: string;
  // One-line truth about what the artifact applies to.
  blurb: string;
}

// [LAW:types-are-the-program] A total Record over the artifact union: a new artifact cannot
// compile until its scope is declared, so the "did we forget to classify it?" bug is
// unrepresentable rather than caught in review.
export const ARTIFACT_SCOPE: Record<WorkbenchArtifact, ArtifactScope> = {
  profile: {
    kind: 'profile',
    label: 'Profile',
    blurb: 'Edits a connection profile; applies wherever that profile is active.',
  },
  'dynamic-profile': {
    kind: 'connection',
    label: 'Connection-wide',
    blurb: 'Writes profile files shared by the whole iTerm2 connection.',
  },
  'escape-sequence': {
    kind: 'entity',
    label: 'Focused entity',
    blurb: 'Emits to (and subscribes on) one live session — the focused entity, unless you override the target.',
  },
  registrations: {
    kind: 'connection',
    label: 'Connection-wide',
    blurb: 'Registers an RPC for the whole iTerm2 connection, not a single session.',
  },
  triggers: {
    kind: 'profile',
    label: 'Profile',
    blurb: "Edits a profile's Triggers array; applies wherever that profile is active.",
  },
  arrangement: {
    kind: 'connection',
    label: 'Connection-wide',
    blurb: 'Saves and restores named window arrangements for the whole iTerm2 app.',
  },
};

// [LAW:single-enforcer] The one predicate that answers "does this artifact act on the focused
// live entity?" — the binary the workspace anchors entity-scoped authoring to.
export function isEntityScoped(artifact: WorkbenchArtifact): boolean {
  return ARTIFACT_SCOPE[artifact].kind === 'entity';
}
