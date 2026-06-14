import { describe, it, expect } from 'vitest';
import { buildDocIndex, searchDocs } from './docs';
import { ESCAPE_TEMPLATES } from './escape-sequences';

describe('buildDocIndex', () => {
  const index = buildDocIndex();

  it('derives one OSC entry per escape template, linking to that template', () => {
    for (const t of ESCAPE_TEMPLATES) {
      const entry = index.find((e) => e.id === `osc-${t.id}`);
      expect(entry, `missing doc entry for ${t.id}`).toBeDefined();
      expect(entry!.source).toBe('osc');
      expect(entry!.link).toEqual({ kind: 'escape', templateId: t.id });
    }
  });

  it('exposes every catalog source so the cross-reference spans all four', () => {
    const sources = new Set(index.map((e) => e.source));
    expect(sources).toEqual(new Set(['osc', 'proto', 'sdef', 'python']));
  });

  it('routes the AppleScript dictionary entry to the osascript console action under the sdef source', () => {
    const sdef = index.filter((e) => e.source === 'sdef');
    expect(sdef).toHaveLength(1);
    expect(sdef[0].link).toEqual({ kind: 'console', action: 'osascript' });
  });

  it('only ever points at the two representable destinations', () => {
    for (const e of index) {
      expect(['escape', 'console']).toContain(e.link.kind);
    }
  });
});

describe('searchDocs', () => {
  const index = buildDocIndex();

  it('lands "OSC 1337 SetMark" on the matching escape template (epic acceptance)', () => {
    const results = searchDocs(index, 'OSC 1337 SetMark');
    expect(results[0]?.link).toEqual({
      kind: 'escape',
      templateId: 'osc1337-set-mark',
    });
  });

  it('finds a protobuf request message and routes it to its console action', () => {
    const results = searchDocs(index, 'SendTextRequest');
    expect(results[0]?.source).toBe('proto');
    expect(results[0]?.link).toEqual({ kind: 'console', action: 'send-text' });
  });

  it('finds a Python API symbol and routes it to the equivalent action', () => {
    const results = searchDocs(index, 'async_send_text');
    expect(results[0]?.link).toEqual({ kind: 'console', action: 'send-text' });
  });

  it('matches case-insensitively', () => {
    const lower = searchDocs(index, 'setmark');
    const upper = searchDocs(index, 'SETMARK');
    expect(upper.map((e) => e.id)).toEqual(lower.map((e) => e.id));
    expect(lower[0]?.id).toBe('osc-osc1337-set-mark');
  });

  it('requires every token to match (AND semantics)', () => {
    // A token present nowhere drops the row even though its siblings match.
    expect(searchDocs(index, 'SetMark nonexistenttoken')).toHaveLength(0);
  });

  it('returns the whole index in build order for an empty query', () => {
    expect(searchDocs(index, '   ')).toEqual(index);
  });
});
