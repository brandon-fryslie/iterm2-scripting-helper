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

  it('discards a superseded in-flight load even when its response arrives last', async () => {
    // The race the generation counter exists to kill: a refresh starts a second read while the first
    // is still in flight; the post-refresh read resolves first, then the stale pre-refresh read
    // resolves last and must NOT overwrite the fresher result. [LAW:no-ambient-temporal-coupling]
    const deferreds: Array<{ resolve: (v: TmuxConnectionsResult) => void }> = [];
    let call = 0;
    const ipc = {
      invoke: vi.fn((method: string) => {
        expect(method).toBe('workbench/tmux-connections');
        call += 1;
        return new Promise<TmuxConnectionsResult>((resolve) => {
          deferreds.push({ resolve });
        });
      }),
    };
    installIpc(ipc);
    const store = new TmuxStore();

    // (A) first load starts — request A in flight, unresolved.
    void store.load();
    // refresh supersedes it — (B) request B in flight, unresolved.
    store.refresh();
    await Promise.resolve();
    expect(call).toBe(2);

    // B (the post-refresh read) resolves first with the fresh list.
    deferreds[1].resolve({ ok: true, connections: [{ connectionId: 'fresh', owningSessionId: 's2' }] });
    await Promise.resolve();
    // A (the superseded read) resolves last with the stale list — it must discard itself.
    deferreds[0].resolve({ ok: true, connections: [{ connectionId: 'stale', owningSessionId: 's1' }] });
    await Promise.resolve();

    expect(store.state).toEqual({
      status: 'ok',
      connections: [{ connectionId: 'fresh', owningSessionId: 's2' }],
    });
  });
});
