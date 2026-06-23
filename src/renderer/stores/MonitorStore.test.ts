import { describe, it, expect } from 'vitest';
import { MonitorStore } from './MonitorStore';

describe('MonitorStore probe draft', () => {
  it('starts with an empty draft so a fresh probe has nothing queued', () => {
    expect(new MonitorStore().probeDraft).toBe('');
  });

  it('setProbeDraft replaces the draft whole — the user typing owns the field', () => {
    const store = new MonitorStore();
    store.setProbeDraft('\\(session.name)');
    expect(store.probeDraft).toBe('\\(session.name)');
    store.setProbeDraft('hostname');
    expect(store.probeDraft).toBe('hostname');
  });

  it('insertProbeReference wraps a variable name once into an interpolation reference', () => {
    // A bare session-local name becomes a single full-wrap, which the probe resolves as the exact path.
    const store = new MonitorStore();
    store.insertProbeReference('hostname');
    expect(store.probeDraft).toBe('\\(hostname)');
  });

  it('insertProbeReference keeps the name verbatim — a cross-scope reference is never re-prefixed', () => {
    // `name` is already iTerm2's full reference; prepending the derived scope would emit
    // \(tab.tab.title) and fail to resolve. The token is exactly \(name).
    const store = new MonitorStore();
    store.insertProbeReference('tab.title');
    expect(store.probeDraft).toBe('\\(tab.title)');
  });

  it('successive inserts concatenate into one valid interpolated template', () => {
    const store = new MonitorStore();
    store.insertProbeReference('session.name');
    store.insertProbeReference('session.username');
    expect(store.probeDraft).toBe('\\(session.name)\\(session.username)');
  });

  it('inserting appends onto whatever the user has already typed', () => {
    const store = new MonitorStore();
    store.setProbeDraft('user@');
    store.insertProbeReference('hostname');
    expect(store.probeDraft).toBe('user@\\(hostname)');
  });
});
