import { describe, expect, it } from 'vitest';
import type { AppEntitySessionRef, AppProbeResult } from './domain';
import {
  TEMPLATE_TARGETS,
  applyAvailability,
  extractSimpleReferences,
  findTemplateTarget,
  previewFromProbe,
  unresolvedReferences,
} from './templateDesigner';

const ESC = '\x1b';
const ST = '\x1b\\';
const BEL = '\x07';

const SESSION: AppEntitySessionRef = {
  kind: 'session',
  windowId: 'w1',
  tabId: 't1',
  sessionId: 's1',
};

function value(v: string): AppProbeResult {
  return { outcome: 'value', entity: SESSION, expression: '\\(path)', value: v };
}
function error(message: string): AppProbeResult {
  return { outcome: 'error', entity: SESSION, expression: '\\(nope)', message };
}

describe('template targets', () => {
  it('exposes exactly the three escape-injectable targets', () => {
    expect(TEMPLATE_TARGETS.map((t) => t.id)).toEqual(['badge', 'window-title', 'tab-title']);
  });

  it('resolves every id, and only the badge re-interpolates live', () => {
    expect(findTemplateTarget('badge').applyMode).toBe('live');
    expect(findTemplateTarget('window-title').applyMode).toBe('snapshot');
    expect(findTemplateTarget('tab-title').applyMode).toBe('snapshot');
  });

  it('throws loudly on an id minted nowhere in the union', () => {
    // @ts-expect-error — exercising the runtime guard against an impossible id
    expect(() => findTemplateTarget('status-bar')).toThrow(/unknown template target/);
  });
});

describe('buildSequence — exact apply bytes', () => {
  it('badge wraps the FORMAT verbatim in SetBadgeFormat (base64), ignoring the rendered value', () => {
    const badge = findTemplateTarget('badge');
    // base64 of the bytes of `\(path)` is `XChwYXRoKQ==` — the format, not the rendered pwd, is sent,
    // because iTerm2 re-interpolates it continuously.
    expect(badge.buildSequence({ format: '\\(path)', rendered: '/tmp/IGNORED' })).toBe(
      `${ESC}]1337;SetBadgeFormat=XChwYXRoKQ==${ST}`,
    );
  });

  it('window title wraps the RENDERED text in OSC 2, ignoring the format', () => {
    const title = findTemplateTarget('window-title');
    expect(title.buildSequence({ format: '\\(path)', rendered: '/private/var/x' })).toBe(
      `${ESC}]2;/private/var/x${BEL}`,
    );
  });

  it('tab title wraps the RENDERED text in OSC 1', () => {
    const title = findTemplateTarget('tab-title');
    expect(title.buildSequence({ format: '\\(path)', rendered: 'build' })).toBe(
      `${ESC}]1;build${BEL}`,
    );
  });
});

describe('previewFromProbe — the one evaluator mapped onto the display model', () => {
  it('passes a resolved value through verbatim', () => {
    expect(previewFromProbe(value('/Users/me/code'))).toEqual({
      state: 'rendered',
      value: '/Users/me/code',
    });
  });

  it('keeps an empty render as a distinct resolved state, never a blank/idle collapse', () => {
    expect(previewFromProbe(value(''))).toEqual({ state: 'rendered', value: '' });
  });

  it('surfaces an unresolved-reference probe failure as a visible error, never a silent blank', () => {
    expect(previewFromProbe(error('No such variable: nope'))).toEqual({
      state: 'error',
      message: 'No such variable: nope',
    });
  });
});

describe('unresolvedReferences — static pre-flight against the live variable set', () => {
  it('flags nothing when every simple reference names a live variable', () => {
    expect(unresolvedReferences('\\(path) on \\(hostname)', ['path', 'hostname'])).toEqual([]);
  });

  it('names the reference that exists nowhere in the live set', () => {
    expect(unresolvedReferences('\\(path) \\(nope)', ['path', 'hostname'])).toEqual(['nope']);
  });

  it('accepts dotted cross-scope references that iTerm2 surfaces', () => {
    expect(unresolvedReferences('\\(user.gitBranch)', ['user.gitBranch'])).toEqual([]);
  });

  it('collapses duplicate unresolved references to a single first-appearance entry', () => {
    expect(unresolvedReferences('\\(nope) \\(nope)', ['path'])).toEqual(['nope']);
  });

  it('leaves function-call references to the probe — a nested call is not a membership check', () => {
    // `\(f(x: 1))` contains a call; it is not a simple variable path, so it is never flagged here.
    expect(extractSimpleReferences('\\(f(x: 1))')).toEqual([]);
    expect(unresolvedReferences('\\(f(x: 1))', [])).toEqual([]);
  });

  it('ignores literal text outside any interpolation', () => {
    expect(unresolvedReferences('just text', ['path'])).toEqual([]);
  });
});

describe('applyAvailability — derived actionability', () => {
  it('blocks an empty (or whitespace-only) draft', () => {
    expect(applyAvailability('', true)).toEqual({ ok: false, reason: 'Author a template first.' });
    expect(applyAvailability('   ', true)).toEqual({
      ok: false,
      reason: 'Author a template first.',
    });
  });

  it('blocks when no session is focused to inject into', () => {
    expect(applyAvailability('\\(path)', false)).toEqual({
      ok: false,
      reason: 'Focus a session to apply.',
    });
  });

  it('is actionable with a draft and a focused session', () => {
    expect(applyAvailability('\\(path)', true)).toEqual({ ok: true });
  });
});
