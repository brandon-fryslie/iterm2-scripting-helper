import { describe, expect, it } from 'vitest';
import { VariableResponse_Status } from '@shared/proto/gen/api_pb';
import {
  normalizeProbeTarget,
  describeVariableStatus,
  buildProbeEvalInvocation,
  PROBE_EVAL_FUNCTION,
} from './probe';

describe('normalizeProbeTarget', () => {
  it('routes a bare variable path to the exact path resolver', () => {
    expect(normalizeProbeTarget('session.name')).toEqual({ kind: 'path', path: 'session.name' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeProbeTarget('  user.theme  ')).toEqual({ kind: 'path', path: 'user.theme' });
  });

  it('unwraps a single full interpolated reference to its path', () => {
    expect(normalizeProbeTarget('\\(session.name)')).toEqual({
      kind: 'path',
      path: 'session.name',
    });
  });

  it('rejects empty input', () => {
    const result = normalizeProbeTarget('   ');
    expect(result.kind).toBe('reject');
  });

  it('routes a multi-reference interpolated template to the template evaluator as-is', () => {
    expect(normalizeProbeTarget('\\(session.name)/\\(session.username)')).toEqual({
      kind: 'template',
      template: '\\(session.name)/\\(session.username)',
    });
  });

  it('routes an interpolated function call to the template evaluator as-is', () => {
    expect(normalizeProbeTarget('\\(iterm2.add(addends: 1))')).toEqual({
      kind: 'template',
      template: '\\(iterm2.add(addends: 1))',
    });
  });

  it('wraps a bare expression so iTerm2 evaluates it rather than echoing literal text', () => {
    expect(normalizeProbeTarget('foo(bar)')).toEqual({
      kind: 'template',
      template: '\\(foo(bar))',
    });
  });

  it('routes a template that mixes literal text and a reference', () => {
    expect(normalizeProbeTarget('user: \\(session.username)')).toEqual({
      kind: 'template',
      template: 'user: \\(session.username)',
    });
  });
});

describe('buildProbeEvalInvocation', () => {
  it('embeds the template as a double-quoted argument to the probe function', () => {
    expect(buildProbeEvalInvocation('\\(session.name)/\\(session.tty)')).toBe(
      `${PROBE_EVAL_FUNCTION}(value: "\\(session.name)/\\(session.tty)")`,
    );
  });

  it('escapes literal double quotes so they do not close the wrapper', () => {
    expect(buildProbeEvalInvocation('\\(session.name) said "hi"')).toBe(
      `${PROBE_EVAL_FUNCTION}(value: "\\(session.name) said \\"hi\\"")`,
    );
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
