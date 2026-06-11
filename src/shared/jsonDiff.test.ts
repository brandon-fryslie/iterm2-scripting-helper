import { describe, it, expect } from 'vitest';
import { diffJson } from './jsonDiff';

describe('diffJson', () => {
  it('returns nothing for deeply equal values', () => {
    const value = { a: [1, { b: 'x' }], c: null };
    expect(diffJson(value, structuredClone(value))).toEqual([]);
  });

  it('reports changed scalars with dotted paths', () => {
    expect(diffJson({ win: { Frame: '{{0,0}}' } }, { win: { Frame: '{{5,5}}' } })).toEqual([
      { kind: 'changed', path: 'win.Frame', before: '{{0,0}}', after: '{{5,5}}' },
    ]);
  });

  it('reports added and removed keys', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, c: 3 })).toEqual([
      { kind: 'removed', path: 'a', before: 1 },
      { kind: 'added', path: 'c', after: 3 },
    ]);
  });

  it('indexes into arrays and reports length differences', () => {
    expect(diffJson([1, 2], [1, 9, 5])).toEqual([
      { kind: 'changed', path: '[1]', before: 2, after: 9 },
      { kind: 'added', path: '[2]', after: 5 },
    ]);
    expect(diffJson({ tabs: ['a', 'b'] }, { tabs: ['a'] })).toEqual([
      { kind: 'removed', path: 'tabs[1]', before: 'b' },
    ]);
  });

  it('treats a type change as one changed entry, not a recursion', () => {
    expect(diffJson({ a: [1] }, { a: { x: 1 } })).toEqual([
      { kind: 'changed', path: 'a', before: [1], after: { x: 1 } },
    ]);
    expect(diffJson('s', 0)).toEqual([{ kind: 'changed', path: '', before: 's', after: 0 }]);
  });

  // `key in obj` sees Object.prototype members; membership must mean own keys only.
  it('treats keys shadowing Object.prototype members as ordinary keys', () => {
    expect(diffJson({ toString: 'a' }, {})).toEqual([
      { kind: 'removed', path: 'toString', before: 'a' },
    ]);
    expect(diffJson({}, { constructor: 'x' })).toEqual([
      { kind: 'added', path: 'constructor', after: 'x' },
    ]);
  });

  it('treats NaN as equal to NaN and 0 as equal to -0', () => {
    expect(diffJson({ a: NaN }, { a: NaN })).toEqual([]);
    expect(diffJson({ a: 0 }, { a: -0 })).toEqual([]);
    expect(diffJson({ a: NaN }, { a: 1 })).toEqual([
      { kind: 'changed', path: 'a', before: NaN, after: 1 },
    ]);
  });

  it('distinguishes null from absent', () => {
    expect(diffJson({ a: null }, {})).toEqual([{ kind: 'removed', path: 'a', before: null }]);
    expect(diffJson({ a: null }, { a: null })).toEqual([]);
  });
});
