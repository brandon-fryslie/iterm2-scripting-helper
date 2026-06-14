import { describe, it, expect } from 'vitest';
import type { RegistrationSpec } from '@shared/rpc';
import { RegistrationStore, registrationSnapshot } from './RegistrationStore';
import { AppEventLog } from './AppEventLog';

// A status-bar RPC registration; status-bar/title/context are the connection-scoped roles the ticket
// names. The function name is derived from the id so findByName has something deterministic to match.
function rpcSpec(id: string, persistent: boolean): RegistrationSpec {
  return {
    id,
    persistent,
    role: 'status-bar',
    name: `fn_${id}`,
    arguments: [],
    defaults: [],
    timeout: 5,
    responseTemplate: '"x"',
    attrs: {
      shortDescription: '',
      detailedDescription: '',
      knobs: [],
      exemplar: '',
      updateCadence: 5,
      uniqueIdentifier: `uid.${id}`,
      format: 'PLAIN_TEXT',
    },
  };
}

function toolSpec(id: string, persistent: boolean): RegistrationSpec {
  return {
    id,
    persistent,
    role: 'toolbelt',
    attrs: {
      displayName: `tool ${id}`,
      identifier: `tool.${id}`,
      url: 'https://example.com',
      revealIfAlreadyRegistered: false,
    },
  };
}

// The store is the deterministic core of "persist and re-register connection-scoped registrations":
// the orchestrator's reconnect is just upsert (on a successful send) → onConnectionClosed (on a drop)
// → re-upsert the persistentSpecs. These tests drive that exact sequence with no live iTerm2.
describe('RegistrationStore live/dead status and reconnect persistence', () => {
  it('reports a freshly registered spec as live with no error', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('a', true));

    const statuses = store.statuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].live).toBe(true);
    expect(statuses[0].lastError).toBeNull();
  });

  it('keeps persistent specs (now dead) and forgets non-persistent ones on connection close', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('keep', true));
    store.upsert(rpcSpec('drop', false));

    store.onConnectionClosed();

    const statuses = store.statuses();
    expect(statuses.map((s) => s.spec.id)).toEqual(['keep']);
    // The desired spec survived the drop, but it is no longer live on any connection.
    expect(statuses[0].live).toBe(false);
  });

  it('exposes exactly the persistent specs as the reconnect re-register list', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('keep', true));
    store.upsert(toolSpec('tool', true));
    store.upsert(rpcSpec('drop', false));

    store.onConnectionClosed();

    expect(store.persistentSpecs().map((s) => s.id).sort()).toEqual(['keep', 'tool']);
  });

  it('marks persistent specs live again once re-registered on the new connection', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('keep', true));
    store.upsert(toolSpec('tool', true));
    store.upsert(rpcSpec('drop', false));

    store.onConnectionClosed();
    // The reconnect path re-sends each persistent spec and upserts it on success.
    for (const spec of store.persistentSpecs()) store.upsert(spec);

    const live = store.statuses().filter((s) => s.live).map((s) => s.spec.id).sort();
    expect(live).toEqual(['keep', 'tool']);
    // The forgotten non-persistent spec is not resurrected by a reconnect.
    expect(store.statuses().map((s) => s.spec.id).sort()).toEqual(['keep', 'tool']);
  });

  it('survives repeated reconnect cycles without leaking dead generations', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('keep', true));
    store.upsert(rpcSpec('drop', false));

    for (let cycle = 0; cycle < 3; cycle += 1) {
      store.onConnectionClosed();
      for (const spec of store.persistentSpecs()) store.upsert(spec);
    }

    const statuses = store.statuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].spec.id).toBe('keep');
    expect(statuses[0].live).toBe(true);
  });

  it('leaves a failed re-registration dead with its reason until a later success clears it', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('keep', true));

    store.onConnectionClosed();
    store.noteReregisterError('keep', 'iTerm2 refused');

    let status = store.statuses()[0];
    expect(status.live).toBe(false);
    expect(status.lastError).toBe('iTerm2 refused');

    // A successful re-registration on a later attempt clears the error and goes live.
    store.upsert(rpcSpec('keep', true));
    status = store.statuses()[0];
    expect(status.live).toBe(true);
    expect(status.lastError).toBeNull();
  });

  it('forgets a spec entirely on remove (unregister / toolbelt forget)', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('a', true));

    store.remove('a');

    expect(store.statuses()).toHaveLength(0);
    expect(store.get('a')).toBeNull();
  });

  it('resolves only RPC specs by function name', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('a', true));
    store.upsert(toolSpec('tool', true));

    expect(store.findByName('fn_a')?.id).toBe('a');
    expect(store.findByName('nope')).toBeNull();
  });

  it('projects statuses joined with invocations in the snapshot', () => {
    const store = new RegistrationStore();
    store.upsert(rpcSpec('a', true));

    const snap = registrationSnapshot(store, new AppEventLog());

    expect(snap.registrations).toHaveLength(1);
    expect(snap.registrations[0].live).toBe(true);
    expect(snap.totalInvocations).toBe(0);
  });
});
