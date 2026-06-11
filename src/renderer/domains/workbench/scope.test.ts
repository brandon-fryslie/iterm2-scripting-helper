import { describe, expect, it } from 'vitest';
import { ARTIFACT_SCOPE, isEntityScoped } from './scope';
import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';

// [LAW:one-source-of-truth] Derived from the total Record (which the compiler already forces to
// cover the union) rather than hand-enumerated — a hand copy silently stops covering new artifacts.
const ALL_ARTIFACTS = Object.keys(ARTIFACT_SCOPE) as WorkbenchArtifact[];

describe('ARTIFACT_SCOPE', () => {
  it('classifies every artifact with a non-empty label and blurb', () => {
    for (const artifact of ALL_ARTIFACTS) {
      const scope = ARTIFACT_SCOPE[artifact];
      expect(scope, artifact).toBeDefined();
      expect(scope.label.length, artifact).toBeGreaterThan(0);
      expect(scope.blurb.length, artifact).toBeGreaterThan(0);
    }
  });

  it('marks exactly the per-session editors as entity-scoped', () => {
    const entityScoped = ALL_ARTIFACTS.filter(isEntityScoped);
    expect(entityScoped.sort()).toEqual(['escape-sequence']);
  });

  it('keeps profile and connection artifacts off the focused-entity anchor', () => {
    expect(isEntityScoped('profile')).toBe(false);
    expect(isEntityScoped('triggers')).toBe(false);
    expect(isEntityScoped('registrations')).toBe(false);
    expect(isEntityScoped('dynamic-profile')).toBe(false);
    expect(isEntityScoped('arrangement')).toBe(false);
  });
});
