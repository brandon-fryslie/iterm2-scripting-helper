import { describe, it, expect } from 'vitest';
import { ConnectionStore, driverErrorEdge } from './ConnectionStore';
import type { ConnectionSnapshot } from '@shared/rpc';

function snap(over: Partial<ConnectionSnapshot>): ConnectionSnapshot {
  return {
    state: 'idle',
    socketPath: '/tmp/sock',
    socketExists: true,
    protocolVersion: '',
    advisoryName: '',
    cookieRequestedAt: null,
    lastError: null,
    wireFramesSeen: 0,
    lastLatencyMs: null,
    ...over,
  };
}

// connection-state is a LEVEL, pushed repeatedly with the same lastError while the driver stays down.
// driverErrorEdge is the pure transition: a failure is new on first entry to 'error', on a changed
// message, or on re-entry after recovery — never on a repeat of the same error snapshot.
describe('driverErrorEdge', () => {
  it('fires on first entry into error', () => {
    expect(driverErrorEdge(null, snap({ state: 'error', lastError: 'no socket' }))).toBe('no socket');
    expect(
      driverErrorEdge(snap({ state: 'connecting' }), snap({ state: 'error', lastError: 'refused' })),
    ).toBe('refused');
  });

  it('does not fire on a non-error transition or an error with no message', () => {
    expect(driverErrorEdge(snap({ state: 'error', lastError: 'x' }), snap({ state: 'ready' }))).toBeNull();
    expect(driverErrorEdge(null, snap({ state: 'error', lastError: null }))).toBeNull();
  });

  it('dedups a repeated identical error level', () => {
    const a = snap({ state: 'error', lastError: 'refused' });
    const b = snap({ state: 'error', lastError: 'refused', wireFramesSeen: 9 });
    expect(driverErrorEdge(a, b)).toBeNull();
  });

  it('re-fires when the cause changes or error is re-entered after recovery', () => {
    expect(
      driverErrorEdge(snap({ state: 'error', lastError: 'a' }), snap({ state: 'error', lastError: 'b' })),
    ).toBe('b');
    expect(
      driverErrorEdge(snap({ state: 'ready' }), snap({ state: 'error', lastError: 'a' })),
    ).toBe('a');
  });
});

// apply is the one place a snapshot lands; it crosses the edge once and records via the injected sink.
describe('ConnectionStore.apply records driver failures once', () => {
  it('records a new failure once and not on a repeat', () => {
    const recorded: string[] = [];
    const store = new ConnectionStore((m) => recorded.push(m));

    store.apply(snap({ state: 'connecting' }));
    store.apply(snap({ state: 'error', lastError: 'refused' }));
    store.apply(snap({ state: 'error', lastError: 'refused', wireFramesSeen: 1 }));
    expect(recorded).toEqual(['refused']);

    store.apply(snap({ state: 'ready' }));
    store.apply(snap({ state: 'error', lastError: 'refused' }));
    expect(recorded).toEqual(['refused', 'refused']);
  });
});
