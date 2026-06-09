import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsoleStore } from './ConsoleStore';
import { EntityFocusStore } from './EntityFocusStore';
import type { ActionLogSnapshot } from '@shared/rpc';

// A fake of the main-process spine: actions invoked through window.ipc are appended here and read
// back through the 'monitor/actions' projection, exactly as the real boundary behaves.
function fakeIpc() {
  const appended: Array<{ method: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  const invoke = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method === 'monitor/actions') {
      const snap: ActionLogSnapshot = {
        entries: appended.map((a, i) => ({
          seq: i + 1,
          at: 1000 + i,
          entity: a.args.entity as never,
          action: 'send-text',
          args: a.args,
          result: {
            ok: true,
            error: null,
            latencyMs: 1,
            responseCase: 'sendTextResponse',
            payload: null,
            requestId: String(i + 1),
          },
        })),
        totalSeen: appended.length,
        capacity: 5000,
      };
      return snap;
    }
    // An action method.
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

  it('reads the transcript back as a projection of the spine after firing', async () => {
    focus.select({ kind: 'session', windowId: 'w1', tabId: 't1', sessionId: 's1' });
    expect(store.transcript).toEqual([]);

    await store.fire('send-text');
    expect(store.transcript).toHaveLength(1);
    expect(store.transcript[0].action).toBe('send-text');

    await store.fire('send-text');
    expect(store.transcript).toHaveLength(2);
  });

  it('clear is a view-only watermark — it hides prior entries without mutating the spine', async () => {
    focus.select({ kind: 'session', windowId: 'w1', tabId: 't1', sessionId: 's1' });
    await store.fire('send-text');
    await store.fire('send-text');
    expect(store.transcript).toHaveLength(2);

    store.clearTranscript();
    expect(store.transcript).toHaveLength(0);

    // The spine still holds both; a later action surfaces only entries past the watermark.
    await store.fire('send-text');
    expect(store.transcript).toHaveLength(1);
  });
});
