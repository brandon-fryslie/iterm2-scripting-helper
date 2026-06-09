import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCHLIST, WatchlistStore } from './WatchlistStore';

describe('WatchlistStore', () => {
  it('seeds with the default watched paths, sorted', () => {
    const store = new WatchlistStore();
    expect(store.snapshot().names).toEqual([...DEFAULT_WATCHLIST].sort((a, b) => a.localeCompare(b)));
  });

  it('pins and unpins paths', () => {
    const store = new WatchlistStore();
    store.setWatched('session.name', true);
    expect(store.has('session.name')).toBe(true);
    expect(store.snapshot().names).toContain('session.name');

    store.setWatched('session.name', false);
    expect(store.has('session.name')).toBe(false);
    expect(store.snapshot().names).not.toContain('session.name');
  });

  it('is idempotent across repeated pins', () => {
    const store = new WatchlistStore();
    const before = store.snapshot().names.length;
    store.setWatched('hostname', true);
    store.setWatched('hostname', true);
    expect(store.snapshot().names.length).toBe(before);
  });

  it('returns IPC-cloneable snapshots', () => {
    const store = new WatchlistStore();
    expect(structuredClone(store.snapshot())).toEqual(store.snapshot());
  });
});
