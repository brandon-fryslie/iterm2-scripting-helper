import { describe, expect, it } from 'vitest';
import { VariableResponse_Status } from '@shared/proto/gen/api_pb';
import { normalizeProbeTarget, describeVariableStatus } from './probe';

describe('normalizeProbeTarget', () => {
  it('passes a bare variable path through unchanged', () => {
    expect(normalizeProbeTarget('session.name')).toEqual({ path: 'session.name' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeProbeTarget('  user.theme  ')).toEqual({ path: 'user.theme' });
  });

  it('unwraps a single full interpolated reference to its path', () => {
    expect(normalizeProbeTarget('\\(session.name)')).toEqual({ path: 'session.name' });
  });

  it('rejects empty input', () => {
    const result = normalizeProbeTarget('   ');
    expect(result).toHaveProperty('reject');
  });

  it('rejects multi-reference interpolated templates instead of guessing', () => {
    const result = normalizeProbeTarget('\\(session.name)/\\(session.username)');
    expect(result).toHaveProperty('reject');
    if ('reject' in result) expect(result.reject).toMatch(/multi-reference/i);
  });

  it('rejects function-call expressions', () => {
    const result = normalizeProbeTarget('\\(iterm2.add(addends: 1))');
    expect(result).toHaveProperty('reject');
    if ('reject' in result) expect(result.reject).toMatch(/function-call/i);
  });

  it('rejects a bare function call with no interpolation wrapper', () => {
    expect(normalizeProbeTarget('foo(bar)')).toHaveProperty('reject');
  });
});

describe('describeVariableStatus', () => {
  it('names each failure status specifically rather than generically', () => {
    const messages = [
      VariableResponse_Status.SESSION_NOT_FOUND,
      VariableResponse_Status.TAB_NOT_FOUND,
      VariableResponse_Status.WINDOW_NOT_FOUND,
      VariableResponse_Status.MISSING_SCOPE,
      VariableResponse_Status.INVALID_NAME,
      VariableResponse_Status.MULTI_GET_DISALLOWED,
    ].map(describeVariableStatus);
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });
});
