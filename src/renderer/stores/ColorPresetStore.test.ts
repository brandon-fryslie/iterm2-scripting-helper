import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ColorPresetStore } from './ColorPresetStore';
import type { ColorPresetsResult } from '@shared/rpc';

function fakeIpc(result: ColorPresetsResult | (() => Promise<ColorPresetsResult>)) {
  const invoke = vi.fn(async (method: string) => {
    expect(method).toBe('workbench/color-presets');
    return typeof result === 'function' ? result() : result;
  });
  return { invoke };
}

function installIpc(ipc: { invoke: ReturnType<typeof vi.fn> }) {
  (globalThis as unknown as { window: unknown }).window = { ipc };
}

describe('ColorPresetStore', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = undefined;
  });

  it('projects a successful read into the ok state with the preset names', async () => {
    installIpc(fakeIpc({ ok: true, presets: ['Solarized', 'Tango'] }));
    const store = new ColorPresetStore();

    await store.load();

    expect(store.state).toEqual({ status: 'ok', presets: ['Solarized', 'Tango'] });
  });

  it('surfaces the read failure cause instead of a silent empty list', async () => {
    installIpc(fakeIpc({ ok: false, error: 'not connected' }));
    const store = new ColorPresetStore();

    await store.load();

    expect(store.state).toEqual({ status: 'error', message: 'not connected' });
  });

  it('is idempotent once loaded — a second load does not re-read', async () => {
    const ipc = fakeIpc({ ok: true, presets: [] });
    installIpc(ipc);
    const store = new ColorPresetStore();

    await store.load();
    await store.load();

    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('refresh forces a fresh read after a prior load', async () => {
    const ipc = fakeIpc({ ok: true, presets: [] });
    installIpc(ipc);
    const store = new ColorPresetStore();

    await store.load();
    store.refresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(ipc.invoke).toHaveBeenCalledTimes(2);
  });

  it('discards a superseded in-flight load even when its response arrives last', async () => {
    // The race the generation counter exists to kill: a refresh starts a second read while the first
    // is still in flight; the post-refresh read resolves first, then the stale pre-refresh read
    // resolves last and must NOT overwrite the fresher result. [LAW:no-ambient-temporal-coupling]
    const deferreds: Array<{ resolve: (v: ColorPresetsResult) => void }> = [];
    let call = 0;
    const ipc = {
      invoke: vi.fn((method: string) => {
        expect(method).toBe('workbench/color-presets');
        call += 1;
        return new Promise<ColorPresetsResult>((resolve) => {
          deferreds.push({ resolve });
        });
      }),
    };
    installIpc(ipc);
    const store = new ColorPresetStore();

    void store.load();
    store.refresh();
    await Promise.resolve();
    expect(call).toBe(2);

    deferreds[1].resolve({ ok: true, presets: ['fresh'] });
    await Promise.resolve();
    deferreds[0].resolve({ ok: true, presets: ['stale'] });
    await Promise.resolve();

    expect(store.state).toEqual({ status: 'ok', presets: ['fresh'] });
  });
});
