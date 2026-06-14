import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  TESTED_PROTOCOL_VERSION,
  compareProtocol,
  protocolAtLeast,
  protocolDrift,
} from './capabilities';

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

describe('compareProtocol', () => {
  it('orders by numeric segment, not lexicographically', () => {
    expect(compareProtocol('1.10', '1.2')).toBeGreaterThan(0);
    expect(compareProtocol('1.2', '1.10')).toBeLessThan(0);
  });

  it('treats equal and zero-padded-equal versions as 0', () => {
    expect(compareProtocol('1.1', '1.1')).toBe(0);
    expect(compareProtocol('1', '1.0')).toBe(0);
  });
});

describe('protocolDrift', () => {
  it('is untested before any version is reported', () => {
    expect(protocolDrift('', TESTED_PROTOCOL_VERSION)).toEqual({ kind: 'untested' });
  });

  it('is current when the server is at or below the tested version', () => {
    expect(protocolDrift(TESTED_PROTOCOL_VERSION, TESTED_PROTOCOL_VERSION)).toEqual({
      kind: 'current',
    });
    expect(protocolDrift('1.0', '1.10')).toEqual({ kind: 'current' });
  });

  it('flags server-newer with both versions when the server runs ahead', () => {
    expect(protocolDrift('1.11', '1.10')).toEqual({
      kind: 'server-newer',
      server: '1.11',
      tested: '1.10',
    });
    expect(protocolDrift('2.0', '1.99')).toEqual({
      kind: 'server-newer',
      server: '2.0',
      tested: '1.99',
    });
  });
});

// The pin must cover every capability this client claims, or the capability table would advertise
// features beyond what the tested-against protocol supports.
describe('TESTED_PROTOCOL_VERSION', () => {
  it('is at least the highest capability minimum', () => {
    for (const cap of CAPABILITIES) {
      expect(protocolAtLeast(TESTED_PROTOCOL_VERSION, cap.minProtocolVersion)).toBe(true);
    }
  });
});
