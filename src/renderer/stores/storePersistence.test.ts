// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsoleStore } from './ConsoleStore';
import { MonitorStore } from './MonitorStore';
import { TemplateDesignerStore } from './TemplateDesignerStore';
import { EntityFocusStore } from './EntityFocusStore';

// Each store is the runtime authority; localStorage is the derived mirror. A "reload" is a fresh store
// instance reading the mirror the previous instance wrote — the same boundary the live app crosses on
// restart. No IPC is touched: construction and the mutations under test never call window.ipc.

describe('ConsoleStore persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists snippets and per-action forms across a reload', () => {
    const store = new ConsoleStore(new EntityFocusStore());
    store.setAction('activate');
    store.updateForm('activate', { id: 't1' });
    store.saveSnippet('my activate');

    const reloaded = new ConsoleStore(new EntityFocusStore());
    expect(reloaded.snippets).toHaveLength(1);
    expect(reloaded.snippets[0]?.name).toBe('my activate');
    expect(reloaded.snippets[0]?.action).toBe('activate');
    // The per-form arg the user typed survives too — the half-built experiment is remembered.
    expect(reloaded.forms.activate.id).toBe('t1');
  });

  it('restores the id allocator so a snippet saved after a reload cannot collide with a persisted id', () => {
    const store = new ConsoleStore(new EntityFocusStore());
    const first = store.saveSnippet('one');

    const reloaded = new ConsoleStore(new EntityFocusStore());
    const second = reloaded.saveSnippet('two');
    expect(second.id).not.toBe(first.id);
    expect(reloaded.snippets.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it('drops a version-mismatched blob loudly and starts empty rather than deserializing garbage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(
      'console-state',
      JSON.stringify({ version: 999, data: { snippets: [{ id: 'x' }], forms: {} } }),
    );
    const store = new ConsoleStore(new EntityFocusStore());
    expect(store.snippets).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('drops a blob with an unfireable snippet action rather than restoring an uninvokable snippet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(
      'console-state',
      JSON.stringify({
        version: 1,
        data: {
          snippets: [{ id: 'snip-1', name: 'bad', action: 'no-such-action', args: {}, createdAt: 1 }],
          forms: {},
        },
      }),
    );
    const store = new ConsoleStore(new EntityFocusStore());
    expect(store.snippets).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('MonitorStore probe-draft persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists the probe draft across a reload', () => {
    const store = new MonitorStore();
    store.setProbeDraft('\\(hostname) on \\(tab.title)');

    const reloaded = new MonitorStore();
    expect(reloaded.probeDraft).toBe('\\(hostname) on \\(tab.title)');
  });

  it('starts from an empty draft when nothing is persisted', () => {
    expect(new MonitorStore().probeDraft).toBe('');
  });

  it('drops a non-string draft loudly rather than restoring a value that cannot be probed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem('monitor-probe-draft', JSON.stringify({ version: 1, data: 42 }));
    expect(new MonitorStore().probeDraft).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('TemplateDesignerStore draft persistence', () => {
  let focus: EntityFocusStore;
  beforeEach(() => {
    window.localStorage.clear();
    focus = new EntityFocusStore();
  });

  it('persists the target and draft across a reload', () => {
    const store = new TemplateDesignerStore(focus);
    store.setTarget('tab-title');
    store.setDraft('\\(tab.title)');

    const reloaded = new TemplateDesignerStore(new EntityFocusStore());
    expect(reloaded.targetId).toBe('tab-title');
    expect(reloaded.draft).toBe('\\(tab.title)');
  });

  it('falls back to the badge target on an unknown persisted target id, warning loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(
      'template-designer-draft',
      JSON.stringify({ version: 1, data: { targetId: 'status-bar', draft: 'x' } }),
    );
    const store = new TemplateDesignerStore(focus);
    expect(store.targetId).toBe('badge');
    expect(store.draft).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
