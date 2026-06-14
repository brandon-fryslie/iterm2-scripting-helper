import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsoleStore } from './ConsoleStore';
import { EntityFocusStore } from './EntityFocusStore';

// A fake of the action boundary: firing an action through window.ipc records what was sent and
// returns a canonical result. The action is appended to the main-process spine (and surfaced by the
// Activity timeline, not this store) — the console no longer projects a transcript of its own.
// The args are run through structuredClone exactly as Electron's IPC does: an observable Proxy
// smuggled into the payload must fail here, not only against the live app.
function fakeIpc() {
  const appended: Array<{ method: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  const invoke = vi.fn(async (method: string, args: Record<string, unknown>) => {
    seq += 1;
    appended.push({ method, args: structuredClone(args) });
    return {
      ok: true,
      error: null,
      latencyMs: 1,
      responseCase: 'sendTextResponse',
      payload: null,
      requestId: String(seq),
    };
  });
  return { invoke, appended };
}

describe('ConsoleStore act-in-context', () => {
  let focus: EntityFocusStore;
  let store: ConsoleStore;
  let ipc: ReturnType<typeof fakeIpc>;

  beforeEach(() => {
    ipc = fakeIpc();
    (globalThis as unknown as { window: unknown }).window = { ipc };
    focus = new EntityFocusStore();
    store = new ConsoleStore(focus);
  });

  it('attaches the focused entity to the action as a value (no per-action target branching)', async () => {
    const session = {
      kind: 'session' as const,
      windowId: 'w1',
      tabId: 't1',
      sessionId: 's1',
    };
    focus.select(session);
    store.updateForm('send-text', { text: 'hello' });

    await store.fire('send-text');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/send-text');
    expect(fired.args.entity).toEqual(session);
    // The session id defaults from focus, with no explicit override typed.
    expect(fired.args.sessionId).toBe('s1');
  });

  it('re-fires a saved snippet with args that survive the IPC structured clone', async () => {
    // Regression for iterm2-e2e-fly: snippets live in an observable array, and deep observation
    // wrapped their stored args in Proxies that Electron's structured clone rejects — the re-fire
    // died before reaching the main process, so no action event ever joined the spine.
    store.setAction('activate');
    store.updateForm('activate', { kind: 'tab', id: 't1' });
    const snippet = store.saveSnippet('activate t1');

    const result = await store.fireSnippet(snippet.id);

    expect(result).not.toBeNull();
    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/activate');
    expect(fired.args.target).toEqual({ kind: 'tab', id: 't1' });
  });

  it('fires saved-arrangement with op as a value and omits an empty windowId', async () => {
    store.setAction('saved-arrangement');
    store.updateForm('saved-arrangement', { op: 'restore', name: 'dev layout' });

    await store.fire('saved-arrangement');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/saved-arrangement');
    expect(fired.args.op).toBe('restore');
    expect(fired.args.name).toBe('dev layout');
    // Empty windowId means "restore as new windows" — the wire field is absent, not ''.
    expect('windowId' in fired.args).toBe(false);
  });

  it('saved-arrangement snippets survive the IPC structured clone like every other action', async () => {
    store.setAction('saved-arrangement');
    store.updateForm('saved-arrangement', { op: 'save', name: 'snap', windowId: 'w9' });
    const snippet = store.saveSnippet('save snap');

    const result = await store.fireSnippet(snippet.id);

    expect(result).not.toBeNull();
    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/saved-arrangement');
    expect(fired.args).toMatchObject({ op: 'save', name: 'snap', windowId: 'w9' });
  });
});

describe('ConsoleStore tmux forms', () => {
  let focus: EntityFocusStore;
  let store: ConsoleStore;
  let ipc: ReturnType<typeof fakeIpc>;

  beforeEach(() => {
    ipc = fakeIpc();
    (globalThis as unknown as { window: unknown }).window = { ipc };
    focus = new EntityFocusStore();
    store = new ConsoleStore(focus);
  });

  it('fires tmux-send-command with the picked connection id and command', async () => {
    store.setAction('tmux-send-command');
    store.updateForm('tmux-send-command', { connectionId: 'c1', command: 'list-windows' });

    await store.fire('tmux-send-command');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/tmux-send-command');
    expect(fired.args.connectionId).toBe('c1');
    expect(fired.args.command).toBe('list-windows');
  });

  it('fires tmux-create-window carrying the affinity hint', async () => {
    store.setAction('tmux-create-window');
    store.updateForm('tmux-create-window', { connectionId: 'c1', affinity: 'w7' });

    await store.fire('tmux-create-window');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/tmux-create-window');
    expect(fired.args).toMatchObject({ connectionId: 'c1', affinity: 'w7' });
  });

  it('fires tmux-set-window-visible with visible as a boolean value, not a mode', async () => {
    store.setAction('tmux-set-window-visible');
    store.updateForm('tmux-set-window-visible', {
      connectionId: 'c1',
      windowId: 'w3',
      visible: false,
    });

    await store.fire('tmux-set-window-visible');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/tmux-set-window-visible');
    expect(fired.args).toMatchObject({ connectionId: 'c1', windowId: 'w3', visible: false });
  });

  it('re-fires a tmux snippet with args that survive the IPC structured clone', async () => {
    store.setAction('tmux-send-command');
    store.updateForm('tmux-send-command', { connectionId: 'c1', command: 'kill-window' });
    const snippet = store.saveSnippet('kill the window');

    const result = await store.fireSnippet(snippet.id);

    expect(result).not.toBeNull();
    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/tmux-send-command');
    expect(fired.args).toMatchObject({ connectionId: 'c1', command: 'kill-window' });
  });
});

describe('ConsoleStore set-broadcast-domains form', () => {
  let store: ConsoleStore;
  let ipc: ReturnType<typeof fakeIpc>;

  beforeEach(() => {
    ipc = fakeIpc();
    (globalThis as unknown as { window: unknown }).window = { ipc };
    store = new ConsoleStore(new EntityFocusStore());
  });

  it('parses the line-per-domain text into the wire table and attaches the entity', async () => {
    store.updateForm('set-broadcast-domains', { domainsText: 's1, s2\ns3 s4' });
    await store.fire('set-broadcast-domains');
    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/set-broadcast-domains');
    expect(fired.args.domains).toEqual([
      ['s1', 's2'],
      ['s3', 's4'],
    ]);
    expect(fired.args.entity).toEqual({ kind: 'app' });
  });

  it('empty text fires the empty table — the wire encoding of "clear all broadcasting"', async () => {
    await store.fire('set-broadcast-domains');
    expect(ipc.appended[0].args.domains).toEqual([]);
  });
});

describe('ConsoleStore preferences and color preset forms', () => {
  let store: ConsoleStore;
  let ipc: ReturnType<typeof fakeIpc>;

  beforeEach(() => {
    ipc = fakeIpc();
    (globalThis as unknown as { window: unknown }).window = { ipc };
    store = new ConsoleStore(new EntityFocusStore());
  });

  it('fires get-preference with the raw key and attaches the entity', async () => {
    store.setAction('get-preference');
    store.updateForm('get-preference', { key: 'PromptOnQuit' });

    await store.fire('get-preference');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/get-preference');
    expect(fired.args.key).toBe('PromptOnQuit');
    expect(fired.args.entity).toEqual({ kind: 'app' });
  });

  it('parses the comma-separated guids into the wire array for apply-color-preset', async () => {
    store.setAction('apply-color-preset');
    store.updateForm('apply-color-preset', { presetName: 'Solarized', guidsCsv: 'g1, g2 ,, g3' });

    await store.fire('apply-color-preset');

    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/apply-color-preset');
    expect(fired.args.presetName).toBe('Solarized');
    // Whitespace trimmed and empty entries dropped — the bulk target list, never blank guids.
    expect(fired.args.guids).toEqual(['g1', 'g2', 'g3']);
  });

  it('re-fires a color-preset snippet with args that survive the IPC structured clone', async () => {
    store.setAction('apply-color-preset');
    store.updateForm('apply-color-preset', { presetName: 'Tango', guidsCsv: 'g1,g2' });
    const snippet = store.saveSnippet('tango to two');

    const result = await store.fireSnippet(snippet.id);

    expect(result).not.toBeNull();
    const fired = ipc.appended[0];
    expect(fired.method).toBe('actions/apply-color-preset');
    expect(fired.args).toMatchObject({ presetName: 'Tango', guids: ['g1', 'g2'] });
  });
});
