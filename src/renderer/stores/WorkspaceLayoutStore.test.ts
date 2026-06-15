// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceLayoutStore, FACETS, type FacetId } from './WorkspaceLayoutStore';

const STORAGE_KEY = 'workspace-facet-hidden';

describe('WorkspaceLayoutStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows every facet by default (empty hidden set)', () => {
    const store = new WorkspaceLayoutStore();
    for (const facet of FACETS) {
      expect(store.isVisible(facet.id)).toBe(true);
    }
  });

  it('toggle hides a visible facet and shows it again', () => {
    const store = new WorkspaceLayoutStore();
    store.toggle('variables');
    expect(store.isVisible('variables')).toBe(false);
    // The other facets are untouched.
    expect(store.isVisible('screen')).toBe(true);
    store.toggle('variables');
    expect(store.isVisible('variables')).toBe(true);
  });

  it('persists hidden facets to localStorage and restores them on reload', () => {
    const store = new WorkspaceLayoutStore();
    store.toggle('act');
    store.toggle('author');

    // The persisted payload is exactly the hidden ids.
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? '[]';
    expect((JSON.parse(raw) as string[]).sort()).toEqual(['act', 'author']);

    const reloaded = new WorkspaceLayoutStore();
    expect(reloaded.isVisible('act')).toBe(false);
    expect(reloaded.isVisible('author')).toBe(false);
    expect(reloaded.isVisible('screen')).toBe(true);
  });

  it('rejects a corrupt payload to the default-all-visible state, not a throw', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json{');
    const store = new WorkspaceLayoutStore();
    for (const facet of FACETS) {
      expect(store.isVisible(facet.id)).toBe(true);
    }
  });

  it('filters unknown ids on load so a stale/removed facet cannot hide a real one', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['ghost-facet', 'activity']));
    const store = new WorkspaceLayoutStore();
    expect(store.isVisible('activity')).toBe(false);
    // The unknown id is dropped, not carried as a hidden facet.
    expect(store.isVisible('ghost-facet' as FacetId)).toBe(true);
  });
});
