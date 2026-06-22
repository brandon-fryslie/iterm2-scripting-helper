// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceStore, LENSES, type LensId } from './WorkspaceStore';

const STORAGE_KEY = 'workspace-active-lens';

describe('WorkspaceStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('launches on the Inspect lens by default — co-presence of every subject is unrepresentable', () => {
    const store = new WorkspaceStore();
    expect(store.activeLens).toBe('inspect');
    // Exactly one lens is active; the rest are not.
    expect(store.isActive('inspect')).toBe(true);
    for (const lens of LENSES.filter((l) => l.id !== 'inspect')) {
      expect(store.isActive(lens.id)).toBe(false);
    }
  });

  it('setLens swaps the focal lens whole', () => {
    const store = new WorkspaceStore();
    store.setLens('build');
    expect(store.activeLens).toBe('build');
    expect(store.isActive('build')).toBe(true);
    expect(store.isActive('inspect')).toBe(false);
  });

  it('persists the active lens to localStorage and restores it on reload', () => {
    const store = new WorkspaceStore();
    store.setLens('console');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('console');

    const reloaded = new WorkspaceStore();
    expect(reloaded.activeLens).toBe('console');
  });

  it('falls back to the default lens on a corrupt payload, not a throw', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-lens');
    const store = new WorkspaceStore();
    expect(store.activeLens).toBe('inspect');
  });

  it('falls back to the default lens for an unknown id so a removed lens cannot strand the workspace', () => {
    window.localStorage.setItem(STORAGE_KEY, 'ghost-lens' as LensId);
    const store = new WorkspaceStore();
    expect(store.activeLens).toBe('inspect');
  });
});
