import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkbenchStore } from './WorkbenchStore';
import type { DynamicProfileSnapshot } from '@shared/rpc';

// The editor↔disk state machine under test: hot reload must be an explicit, visible state
// transition — a clean buffer follows disk, a dirty buffer surfaces 'conflict' with reload/keep
// actions, and an externally deleted file reads 'deleted'. Never a silent body swap.

function snapshotWith(
  files: Array<{ basename: string; body: string }>,
): DynamicProfileSnapshot {
  return {
    folder: '/tmp/DynamicProfiles',
    folderExists: true,
    files: files.map((f, i) => ({
      path: `/tmp/DynamicProfiles/${f.basename}`,
      basename: f.basename,
      mtime: i,
      size: f.body.length,
      body: f.body,
    })),
    lastError: null,
  };
}

const VALID = '{"Profiles": [{"Guid": "g1", "Name": "A"}]}';
const VALID_V2 = '{"Profiles": [{"Guid": "g1", "Name": "A renamed"}]}';

function fakeIpc() {
  const invoke = vi.fn(async () => ({ ok: true, error: null }));
  return { invoke };
}

describe('WorkbenchStore dynamic profile sync state machine', () => {
  let store: WorkbenchStore;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { ipc: fakeIpc() };
    store = new WorkbenchStore();
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID }]));
  });

  it('is idle with no buffer and draft once a new buffer has content', () => {
    expect(store.dynamicSyncStatus).toBe('idle');
    expect(store.dynamicEditorAnalysis).toBeNull();
    store.setDynamicEditorBody('{}');
    expect(store.dynamicSyncStatus).toBe('draft');
  });

  it('a clean buffer follows external disk edits and stays synced', () => {
    store.selectDynamicProfile('a.json');
    expect(store.dynamicSyncStatus).toBe('synced');
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID_V2 }]));
    expect(store.dynamicEditorBody).toBe(VALID_V2);
    expect(store.dynamicSyncStatus).toBe('synced');
  });

  it('local edits read dirty while disk is unchanged underneath', () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody(VALID + '\n');
    expect(store.dynamicSyncStatus).toBe('dirty');
  });

  it('an external disk edit under local edits reads conflict and never overwrites the buffer', () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody('{"Profiles": []}');
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID_V2 }]));
    expect(store.dynamicSyncStatus).toBe('conflict');
    expect(store.dynamicEditorBody).toBe('{"Profiles": []}');
  });

  it('reload-from-disk resolves a conflict by adopting the disk body', () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody('{"Profiles": []}');
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID_V2 }]));
    store.reloadDynamicFromDisk();
    expect(store.dynamicEditorBody).toBe(VALID_V2);
    expect(store.dynamicSyncStatus).toBe('synced');
  });

  it('keep-my-edits resolves a conflict back to dirty without touching the buffer', () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody('{"Profiles": []}');
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID_V2 }]));
    store.keepDynamicEdits();
    expect(store.dynamicSyncStatus).toBe('dirty');
    expect(store.dynamicEditorBody).toBe('{"Profiles": []}');
  });

  it('an externally deleted selected file reads deleted', () => {
    store.selectDynamicProfile('a.json');
    store.applyDynamicSnapshot(snapshotWith([]));
    expect(store.dynamicSyncStatus).toBe('deleted');
  });

  it('saving is blocked, loudly, while the buffer is invalid JSON', async () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody('{nope');
    expect(store.dynamicSaveBlocked).toMatch(/invalid JSON/);
    await store.saveDynamicProfile('a.json');
    expect(store.dynamicLastError).toMatch(/invalid JSON/);
    const ipc = (window as unknown as { ipc: ReturnType<typeof fakeIpc> }).ipc;
    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it('a successful save rebases the disk baseline so the buffer reads synced', async () => {
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody(VALID_V2);
    await store.saveDynamicProfile('a.json');
    // The watcher will broadcast the new disk body; the editor is already coherent before it does.
    store.applyDynamicSnapshot(snapshotWith([{ basename: 'a.json', body: VALID_V2 }]));
    expect(store.dynamicSyncStatus).toBe('synced');
  });

  it('derives parent candidates from iTerm2 profiles, other files, and the buffer itself', () => {
    store.profiles = [{ guid: 'ig', name: 'Default', properties: {} }];
    store.applyDynamicSnapshot(
      snapshotWith([
        { basename: 'a.json', body: VALID },
        { basename: 'b.json', body: '{"Profiles": [{"Guid": "bg", "Name": "B"}]}' },
      ]),
    );
    store.selectDynamicProfile('a.json');
    store.setDynamicEditorBody(
      '{"Profiles": [{"Guid": "buf", "Name": "Buffered"}]}',
    );
    const sources = store.dynamicParentCandidates.map((c) => c.source);
    expect(sources).toContain('iTerm2');
    expect(sources).toContain('b.json');
    // The buffer stands in for the selected file: its disk version is not a candidate.
    expect(store.dynamicParentCandidates.find((c) => c.guid === 'g1')).toBeUndefined();
    expect(store.dynamicParentCandidates.find((c) => c.guid === 'buf')?.source).toBe('a.json');
  });

  it('reports the files poisoning the folder for iTerm2', () => {
    store.applyDynamicSnapshot(
      snapshotWith([
        { basename: 'ok.json', body: VALID },
        { basename: 'broken.json', body: '{nope' },
      ]),
    );
    expect(store.dynamicFolderBlockers).toEqual(['broken.json']);
  });
});

describe('WorkbenchStore broadcast domain draft', () => {
  let store: WorkbenchStore;
  let live: { ok: true; domains: string[][] } | { ok: false; error: string };

  beforeEach(() => {
    live = { ok: true, domains: [['s1', 's2']] };
    const invoke = vi.fn(async (method: string) => {
      if (method !== 'workbench/broadcast-domains') throw new Error(`unexpected ${method}`);
      return live;
    });
    (globalThis as unknown as { window: unknown }).window = { ipc: { invoke } };
    store = new WorkbenchStore();
  });

  it('the first read seeds the draft from the engine table and reads clean', async () => {
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s1', 's2']]);
    expect(store.broadcastDraftDirty).toBe(false);
  });

  it('edits dirty the draft; reset returns to the live table', async () => {
    await store.refreshBroadcastDomains();
    store.moveBroadcastSession('s2', null);
    expect(store.broadcastDraft).toEqual([['s1']]);
    expect(store.broadcastDraftDirty).toBe(true);
    store.resetBroadcastDraft();
    expect(store.broadcastDraft).toEqual([['s1', 's2']]);
    expect(store.broadcastDraftDirty).toBe(false);
  });

  it('a clean draft follows an external engine change on refresh', async () => {
    await store.refreshBroadcastDomains();
    live = { ok: true, domains: [['s3', 's4']] };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s3', 's4']]);
  });

  it('a dirty draft survives refresh — pending intent is never silently swapped', async () => {
    await store.refreshBroadcastDomains();
    store.moveBroadcastSession('s2', null);
    live = { ok: true, domains: [['s3', 's4']] };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s1']]);
    expect(store.broadcastDraftDirty).toBe(true);
  });

  it('reordering members or domains does not read dirty — membership is the fact', async () => {
    live = { ok: true, domains: [['s1', 's2'], ['s3']] };
    await store.refreshBroadcastDomains();
    store.moveBroadcastSession('s1', 0); // re-append into its own domain
    expect(store.broadcastDraft).toEqual([['s2', 's1'], ['s3']]);
    expect(store.broadcastDraftDirty).toBe(false);
  });

  it('moving disarms the click-to-move selection', async () => {
    await store.refreshBroadcastDomains();
    store.armBroadcastSession('s2');
    store.moveBroadcastSession('s2', null);
    expect(store.armedBroadcastSessionId).toBeNull();
  });

  it('edits survive a failed refresh followed by a successful one — the error read cannot poison dirtiness', async () => {
    await store.refreshBroadcastDomains();
    store.moveBroadcastSession('s2', null);
    live = { ok: false, error: 'IPC blip' };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s1']]);
    live = { ok: true, domains: [['s1', 's2']] };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s1']]);
    expect(store.broadcastDraftDirty).toBe(true);
  });

  it('a refresh whose table matches the pending draft rebases it to clean — the apply landed', async () => {
    await store.refreshBroadcastDomains();
    store.moveBroadcastSession('s2', null);
    expect(store.broadcastDraftDirty).toBe(true);
    live = { ok: true, domains: [['s1']] };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDraft).toEqual([['s1']]);
    expect(store.broadcastDraftDirty).toBe(false);
  });

  it('a failed engine read never fabricates a draft', async () => {
    live = { ok: false, error: 'not connected' };
    await store.refreshBroadcastDomains();
    expect(store.broadcastDomains).toEqual({ ok: false, error: 'not connected' });
    expect(store.broadcastDraft).toBeNull();
    expect(store.broadcastDraftDirty).toBe(false);
  });
});
