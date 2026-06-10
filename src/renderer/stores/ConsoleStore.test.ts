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
});
