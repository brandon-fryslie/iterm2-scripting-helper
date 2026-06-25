import { describe, it, expect } from 'vitest';
import { buildCapabilityCatalog, searchCapabilities } from './capabilities';
import type { DocLink } from './capabilities';
import { ESCAPE_TEMPLATES } from './escape-sequences';
import { LENSES } from './lenses';
import type { AppActionKind } from './domain';

const CATALOG = buildCapabilityCatalog();
const byId = (id: string) => CATALOG.find((c) => c.id === id);

describe('buildCapabilityCatalog', () => {
  it('gives every capability a unique id', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies every capability as read or mutate', () => {
    for (const c of CATALOG) expect(['read', 'mutate']).toContain(c.kind);
  });

  // The catalog's own Record<RpcMethod, …> is the compile-time exhaustiveness guarantee — a method added
  // to RpcSchema cannot compile without an entry. This pins the surface size so an accidental removal is
  // caught too: every one of the 55 wire methods becomes exactly one rpc-prefixed capability.
  it('covers all 55 RPC methods exactly once', () => {
    const rpc = CATALOG.filter((c) => c.id.startsWith('rpc-'));
    expect(rpc).toHaveLength(55);
    expect(new Set(rpc.map((c) => c.ref)).size).toBe(55);
  });

  // [LAW:types-are-the-program] A compile-time exhaustiveness pin over AppActionKind: this total Record
  // fails to compile if an action kind is added to the closed set without being listed here, and the
  // assertion proves each one has its Console deep-link in the catalog — every action, exactly once.
  it('deep-links every AppActionKind to its Console action exactly once', () => {
    const ALL_ACTIONS: Record<AppActionKind, true> = {
      'send-text': true,
      inject: true,
      activate: true,
      'menu-item': true,
      'invoke-function': true,
      'restart-session': true,
      close: true,
      'saved-arrangement': true,
      'set-broadcast-domains': true,
      'get-selection': true,
      'set-selection': true,
      transaction: true,
      osascript: true,
      'raw-protobuf': true,
      'tmux-send-command': true,
      'tmux-create-window': true,
      'tmux-set-window-visible': true,
      'get-preference': true,
      'apply-color-preset': true,
    };
    const consoleActions = CATALOG.map((c) => c.link)
      .filter((l): l is Extract<DocLink, { kind: 'console' }> => l?.kind === 'console')
      .map((l) => l.action);
    expect(consoleActions.slice().sort()).toEqual(Object.keys(ALL_ACTIONS).sort());
    expect(new Set(consoleActions).size).toBe(consoleActions.length);
  });

  // [LAW:one-source-of-truth] The escape arm is derived from ESCAPE_TEMPLATES — one capability per
  // template, each deep-linking to its own template, never a hand re-listing that could drift.
  it('derives one escape capability per template, linking to that template', () => {
    for (const t of ESCAPE_TEMPLATES) {
      const cap = byId(`escape-${t.id}`);
      expect(cap, `missing capability for ${t.id}`).toBeDefined();
      expect(cap?.link).toEqual({ kind: 'escape', templateId: t.id });
    }
  });

  // [LAW:no-silent-failure] Every deep-link resolves to a real destination; a dangling link would land
  // the user nowhere. console arms are validated by the AppActionKind pin above.
  it('every link resolves to a real destination', () => {
    const lensIds = new Set<string>(LENSES.map((l) => l.id));
    const templateIds = new Set(ESCAPE_TEMPLATES.map((t) => t.id));
    for (const c of CATALOG) {
      const link = c.link;
      if (!link) continue;
      if (link.kind === 'escape') expect(templateIds.has(link.templateId)).toBe(true);
      if (link.kind === 'lens') expect(lensIds.has(link.lens)).toBe(true);
    }
  });
});

describe('searchCapabilities', () => {
  it('finds a protobuf request message and routes it to its console action', () => {
    const r = searchCapabilities(CATALOG, 'SendTextRequest');
    expect(r[0]?.link).toEqual({ kind: 'console', action: 'send-text' });
  });

  it('lands "OSC 1337 SetMark" on the matching escape template (epic acceptance)', () => {
    const r = searchCapabilities(CATALOG, 'OSC 1337 SetMark');
    expect(r[0]?.link).toEqual({ kind: 'escape', templateId: 'osc1337-set-mark' });
  });

  it('finds a Python API symbol and routes it to the equivalent action', () => {
    const r = searchCapabilities(CATALOG, 'async_send_text');
    expect(r[0]?.link).toEqual({ kind: 'console', action: 'send-text' });
  });

  it('finds a read-only monitor method and links it to its home lens', () => {
    const r = searchCapabilities(CATALOG, 'LayoutSnapshot');
    expect(r[0]?.ref).toBe('monitor/layout');
    expect(r[0]?.link).toEqual({ kind: 'lens', lens: 'inspect' });
  });

  it('matches case-insensitively', () => {
    const lower = searchCapabilities(CATALOG, 'setmark');
    const upper = searchCapabilities(CATALOG, 'SETMARK');
    expect(upper.map((c) => c.id)).toEqual(lower.map((c) => c.id));
  });

  it('requires every token to match (AND semantics)', () => {
    expect(searchCapabilities(CATALOG, 'SetMark nonexistenttoken')).toHaveLength(0);
  });

  it('filters by kind across the whole surface', () => {
    const reads = searchCapabilities(CATALOG, '', 'read');
    const mutates = searchCapabilities(CATALOG, '', 'mutate');
    expect(reads.every((c) => c.kind === 'read')).toBe(true);
    expect(mutates.every((c) => c.kind === 'mutate')).toBe(true);
    expect(reads.length + mutates.length).toBe(CATALOG.length);
  });

  it('returns the whole catalog for an empty query and "all" filter', () => {
    expect(searchCapabilities(CATALOG, '   ', 'all')).toHaveLength(CATALOG.length);
  });
});
