import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsoleStore } from './ConsoleStore';
import { EntityFocusStore } from './EntityFocusStore';

// A fake of the action boundary: firing an action through window.ipc records what was sent and
// returns a canonical result. The action is appended to the main-process spine (and surfaced by the
// Activity timeline, not this store) — the console no longer projects a transcript of its own.
function fakeIpc() {
  const appended: Array<{ method: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  const invoke = vi.fn(async (method: string, args: Record<string, unknown>) => {
    seq += 1;
    appended.push({ method, args });
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
});
