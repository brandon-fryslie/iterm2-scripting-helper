import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorStore } from './ErrorStore';
import type { FileExportResult } from '@shared/rpc';

// The single notice authority under test: id is minted once and monotonic, the toast stack is the
// undismissed tail, the Errors pane is the durable error subset, and the cancellable-file convention
// (ok / fail / cancel) is enforced in exactly one place.
describe('ErrorStore', () => {
  let store: ErrorStore;

  beforeEach(() => {
    store = new ErrorStore();
  });

  it('mints a monotonic id per notice and keeps insertion order in the durable list', () => {
    store.record({ tone: 'error', source: 'driver', message: 'first' });
    store.record({ tone: 'error', source: 'fixture', message: 'second' });
    expect(store.notices.map((n) => n.id)).toEqual([1, 2]);
    expect(store.notices.map((n) => n.message)).toEqual(['first', 'second']);
  });

  it('projects the durable Errors pane as the tone==error subset, newest-first', () => {
    store.record({ tone: 'error', source: 'driver', message: 'boom' });
    store.record({ tone: 'success', source: 'fixture', message: 'Saved 3 events' });
    store.record({ tone: 'error', source: 'export', message: 'disk full' });
    expect(store.errors.map((n) => n.message)).toEqual(['disk full', 'boom']);
    expect(store.errorCount).toBe(2);
  });

  it('toasts are the undismissed notices newest-first; dismissal removes from the stack but not the pane', () => {
    store.record({ tone: 'error', source: 'driver', message: 'one' });
    store.record({ tone: 'success', source: 'fixture', message: 'two' });
    expect(store.activeToasts.map((n) => n.message)).toEqual(['two', 'one']);

    store.dismissToast(2);
    expect(store.activeToasts.map((n) => n.message)).toEqual(['one']);
    // The error survives in the durable pane after its toast is dismissed.
    expect(store.errors.map((n) => n.message)).toEqual(['one']);
  });

  it('caps the on-screen toast stack to the most recent notices without dropping history', () => {
    for (let i = 1; i <= 8; i += 1) {
      store.record({ tone: 'error', source: 'driver', message: `e${i}` });
    }
    // Only the newest 5 stack on screen…
    expect(store.activeToasts.map((n) => n.message)).toEqual(['e8', 'e7', 'e6', 'e5', 'e4']);
    // …but all 8 remain in the durable record.
    expect(store.errorCount).toBe(8);
  });

  it('recordFileOutcome enforces the ok/fail/cancel convention in one place', () => {
    const ok: FileExportResult = { ok: true, path: '/tmp/x.py' };
    const failed: FileExportResult = { ok: false, error: 'permission denied' };
    const cancelled: FileExportResult = { ok: false, error: null };

    store.recordFileOutcome('export', ok, 'Exported /tmp/x.py');
    store.recordFileOutcome('export', failed, 'unused');
    store.recordFileOutcome('export', cancelled, 'unused');

    // The cancel is a deliberate no-op: two notices, never three.
    expect(store.notices.map((n) => [n.tone, n.message])).toEqual([
      ['success', 'Exported /tmp/x.py'],
      ['error', 'permission denied'],
    ]);
  });

  it('clear empties the durable record and the toast stack', () => {
    store.record({ tone: 'error', source: 'driver', message: 'boom' });
    store.clear();
    expect(store.errors).toEqual([]);
    expect(store.activeToasts).toEqual([]);
    expect(store.errorCount).toBe(0);
  });
});
