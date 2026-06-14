import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TmuxStore } from './TmuxStore';
import type { TmuxConnectionsResult } from '@shared/rpc';

// A fake of the tmux-connections read: each invoke returns whatever result the test queued, and the
// store is expected to project it into its discriminated lifecycle state.
function fakeIpc(result: TmuxConnectionsResult | (() => Promise<TmuxConnectionsResult>)) {
  const invoke = vi.fn(async (method: string) => {
    expect(method).toBe('workbench/tmux-connections');
    return typeof result === 'function' ? result() : result;
  });
  return { invoke };
}

function installIpc(ipc: { invoke: ReturnType<typeof vi.fn> }) {
  (globalThis as unknown as { window: unknown }).window = { ipc };
}

describe('TmuxStore', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = undefined;
  });

  it('projects a successful read into the ok state with the connection list', async () => {
    installIpc(
      fakeIpc({
        ok: true,
        connections: [{ connectionId: 'c1', owningSessionId: 's1' }],
      }),
    );
    const store = new TmuxStore();

    await store.load();

    expect(store.state).toEqual({
      status: 'ok',
      connections: [{ connectionId: 'c1', owningSessionId: 's1' }],
    });
  });

  it('surfaces the read failure cause instead of a silent empty list', async () => {
    installIpc(fakeIpc({ ok: false, error: 'not connected' }));
    const store = new TmuxStore();

    await store.load();

    expect(store.state).toEqual({ status: 'error', message: 'not connected' });
  });

  it('is idempotent once loaded — a second load does not re-read', async () => {
    const ipc = fakeIpc({ ok: true, connections: [] });
    installIpc(ipc);
    const store = new TmuxStore();

    await store.load();
    await store.load();

    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('refresh forces a fresh read after a prior load', async () => {
    const ipc = fakeIpc({ ok: true, connections: [] });
    installIpc(ipc);
    const store = new TmuxStore();

    await store.load();
    store.refresh();
    // refresh kicks an async load; await a microtask turn for it to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(ipc.invoke).toHaveBeenCalledTimes(2);
  });
});
