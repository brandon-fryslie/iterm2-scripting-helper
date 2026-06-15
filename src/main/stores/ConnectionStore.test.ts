import { describe, it, expect } from 'vitest';
import { ConnectionStore } from './ConnectionStore';

// [FRAMING:representation] A 'ready' connection must never carry a lastError — a connected connection
// showing a failure is an incoherent representation. These pin the single-enforcer behavior: every
// healthy transition, whether via setState or syncFromProtocol, clears the transient failure.
describe('ConnectionStore lastError lifecycle', () => {
  it('clears a reconnect failure once the protocol reports ready', () => {
    const store = new ConnectionStore();
    store.noteReconnectFailure('iTerm2 socket not found');

    expect(store.state).toBe('reconnecting');
    expect(store.lastError?.message).toContain('socket not found');

    store.syncFromProtocol('ready', '1.7');

    expect(store.state).toBe('ready');
    expect(store.lastError).toBeNull();
  });

  it('keeps the failure visible while still reconnecting', () => {
    const store = new ConnectionStore();
    store.noteReconnectFailure('iTerm2 socket not found');

    // A failed attempt stays in the transient state with the reason on the snapshot.
    const snap = store.snapshot();
    expect(snap.state).toBe('reconnecting');
    expect(snap.lastError?.message).toContain('socket not found');
  });

  it('clears a terminal error when the protocol reconnects', () => {
    const store = new ConnectionStore();
    store.setError('osascript failed');

    expect(store.state).toBe('error');
    expect(store.lastError).not.toBeNull();

    store.syncFromProtocol('ready', '1.7');

    expect(store.state).toBe('ready');
    expect(store.lastError).toBeNull();
  });
});
