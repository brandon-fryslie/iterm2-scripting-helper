import { describe, expect, it } from 'vitest';
import { ARTIFACT_SCOPE, isEntityScoped } from './scope';
import type { WorkbenchArtifact } from '@/stores/WorkbenchStore';

const ALL_ARTIFACTS: WorkbenchArtifact[] = [
  'profile',
  'dynamic-profile',
  'escape-sequence',
  'registrations',
  'custom-escape',
  'triggers',
];

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
    expect(entityScoped.sort()).toEqual(['custom-escape', 'escape-sequence']);
  });

  it('keeps profile and connection artifacts off the focused-entity anchor', () => {
    expect(isEntityScoped('profile')).toBe(false);
    expect(isEntityScoped('triggers')).toBe(false);
    expect(isEntityScoped('registrations')).toBe(false);
    expect(isEntityScoped('dynamic-profile')).toBe(false);
  });
});
