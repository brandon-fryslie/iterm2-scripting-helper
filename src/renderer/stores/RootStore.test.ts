import { describe, it, expect, beforeEach } from 'vitest';
import { RootStore } from './RootStore';

// The navigator is the single seam from a docs DocLink to store state. These exercise both arms of
// the exhaustive match so a destination cannot regress to opening the wrong place.
describe('RootStore.navigateToDoc', () => {
  let store: RootStore;

  beforeEach(() => {
    store = new RootStore();
  });

  it('escape link opens the escape editor on the named template', () => {
    store.navigateToDoc({ kind: 'escape', templateId: 'osc1337-current-dir' });
    expect(store.workbench.artifact).toBe('escape-sequence');
    expect(store.workbench.escapeTemplateId).toBe('osc1337-current-dir');
  });

  it('console link selects the named action', () => {
    store.navigateToDoc({ kind: 'console', action: 'invoke-function' });
    expect(store.console.selectedAction).toBe('invoke-function');
  });

  it('lens link focuses the named home lens of a read capability', () => {
    store.navigateToDoc({ kind: 'lens', lens: 'fleet' });
    expect(store.workspace.activeLens).toBe('fleet');
  });

  // This suite runs in the node env (no window). Focusing a destination lens changes activeLens, which
  // fires the persistence reaction; the write boundary must no-op rather than throw an uncaught reaction
  // exception when there is no localStorage to persist into.
  it('focuses a destination lens without a window present, persistence a silent no-op', () => {
    expect(() => store.navigateToDoc({ kind: 'console', action: 'invoke-function' })).not.toThrow();
    expect(store.workspace.activeLens).toBe('console');
  });
});

// The escalation seam from the Console inline result to the full Events lens: the just-fired event's
// seq is the single spine identity, so "open this in Events" is purely setLens + select.
describe('RootStore.inspectEventInEvents', () => {
  let store: RootStore;

  beforeEach(() => {
    store = new RootStore();
  });

  it('focuses the Events lens and selects the given spine seq', () => {
    store.workspace.setLens('console');
    store.inspectEventInEvents(42);
    expect(store.workspace.activeLens).toBe('events');
    expect(store.activity.selectedSeq).toBe(42);
  });
});
