// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { versionedCell } from './persistence';

const KEY = 'persistence-test-cell';

interface Cell {
  n: number;
}

function makeCell(version: number) {
  return versionedCell<Cell>({
    key: KEY,
    version,
    fallback: () => ({ n: 0 }),
    decode: (data) =>
      typeof data === 'object' && data !== null && typeof (data as { n: unknown }).n === 'number'
        ? { n: (data as { n: number }).n }
        : null,
  });
}

describe('versionedCell', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('round-trips a value through save and load', () => {
    const cell = makeCell(1);
    cell.save({ n: 5 });
    expect(cell.load()).toEqual({ n: 5 });
    // A clean round-trip never warns — there is nothing to degrade.
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the fallback for an absent key without warning — first run is not corruption', () => {
    const cell = makeCell(1);
    expect(cell.load()).toEqual({ n: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops and warns on a non-JSON payload rather than throwing', () => {
    window.localStorage.setItem(KEY, 'this is not json {');
    const cell = makeCell(1);
    expect(cell.load()).toEqual({ n: 0 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('drops and warns when the stored value is not a versioned envelope', () => {
    // A bare value written by something that did not wrap it — no version tag to trust.
    window.localStorage.setItem(KEY, JSON.stringify({ n: 9 }));
    const cell = makeCell(1);
    expect(cell.load()).toEqual({ n: 0 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('drops and warns LOUDLY on a schema-version mismatch — the explicit degrade path', () => {
    // Written by version 1, read by version 2: the shape contract changed, so the old blob is dropped.
    makeCell(1).save({ n: 7 });
    expect(window.localStorage.getItem(KEY)).toContain('"version":1');

    const upgraded = makeCell(2);
    expect(upgraded.load()).toEqual({ n: 0 });
    expect(warn).toHaveBeenCalledOnce();
    // The warning names both versions so the drop is diagnosable, never silent.
    expect(warn.mock.calls[0]?.[0]).toContain('schema version 1');
    expect(warn.mock.calls[0]?.[0]).toContain('expects 2');
  });

  it('drops and warns when the payload fails domain validation at the matching version', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, data: { n: 'not a number' } }));
    const cell = makeCell(1);
    expect(cell.load()).toEqual({ n: 0 });
    expect(warn).toHaveBeenCalledOnce();
  });
});
