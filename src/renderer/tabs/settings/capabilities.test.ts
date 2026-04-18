import { describe, it, expect } from 'vitest';
import { protocolAtLeast } from './capabilities';

describe('protocolAtLeast', () => {
  it('returns false when the current version is empty', () => {
    expect(protocolAtLeast('', '1.0')).toBe(false);
  });

  it('treats identical versions as satisfied', () => {
    expect(protocolAtLeast('1.11', '1.11')).toBe(true);
  });

  it('compares by numeric segments, not lexicographically', () => {
    expect(protocolAtLeast('1.10', '1.2')).toBe(true);
    expect(protocolAtLeast('1.2', '1.10')).toBe(false);
  });

  it('accepts higher major, any minor', () => {
    expect(protocolAtLeast('2.0', '1.99')).toBe(true);
  });

  it('rejects lower current', () => {
    expect(protocolAtLeast('0.9', '1.0')).toBe(false);
  });

  it('treats missing segments as zero', () => {
    expect(protocolAtLeast('1', '1.0')).toBe(true);
    expect(protocolAtLeast('1.0', '1.0.1')).toBe(false);
  });
});
