import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TEMPLATES,
  effectiveValues,
  renderTemplate,
  type EscapeTemplate,
} from './escape-sequences';

const ESC = '\x1b';
const ST = '\x1b\\';
const BEL = '\x07';

function template(id: string): EscapeTemplate {
  const t = ESCAPE_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template: ${id}`);
  return t;
}

function build(id: string, values: Record<string, string> = {}): string {
  const result = renderTemplate(template(id), values);
  if (!result.ok) throw new Error(`expected ok for ${id}: ${result.error}`);
  return result.sequence;
}

interface Case {
  id: string;
  values?: Record<string, string>;
  expected: string;
}

// Byte-exact construction table. Syntax verified against iterm2.com/documentation-escape-codes.html
// and documentation-images.html.
const CASES: Case[] = [
  { id: 'osc1337-set-mark', expected: `${ESC}]1337;SetMark${ST}` },
  {
    id: 'osc1337-current-dir',
    values: { path: '/Users/me/code' },
    expected: `${ESC}]1337;CurrentDir=/Users/me/code${ST}`,
  },
  {
    id: 'osc1337-set-profile',
    values: { name: 'Hotkey Window' },
    expected: `${ESC}]1337;SetProfile=Hotkey Window${ST}`,
  },
  {
    id: 'osc1337-request-attention',
    values: { mode: 'fireworks' },
    expected: `${ESC}]1337;RequestAttention=fireworks${ST}`,
  },
  {
    id: 'osc1337-add-annotation',
    values: { message: 'deploy started here' },
    expected: `${ESC}]1337;AddAnnotation=deploy started here${ST}`,
  },
  {
    id: 'osc1337-add-hidden-annotation',
    values: { message: 'psst' },
    expected: `${ESC}]1337;AddHiddenAnnotation=psst${ST}`,
  },
  {
    id: 'osc1337-file-inline',
    values: { name: 'logo.png', data_base64: 'AAAA' },
    expected: `${ESC}]1337;File=inline=1;name=bG9nby5wbmc=;width=auto;height=auto;preserveAspectRatio=1:AAAA${BEL}`,
  },
  {
    id: 'osc1337-file-download',
    values: { name: 'notes.txt', size: '5', data_base64: 'aGVsbG8=' },
    expected: `${ESC}]1337;File=name=bm90ZXMudHh0;size=5:aGVsbG8=${BEL}`,
  },
  {
    id: 'osc1337-set-background-image',
    values: { path: '/tmp/bg.png' },
    expected: `${ESC}]1337;SetBackgroundImageFile=L3RtcC9iZy5wbmc=${ST}`,
  },
  {
    id: 'osc1337-set-user-var',
    values: { key: 'deployTarget', value: 'hello world' },
    expected: `${ESC}]1337;SetUserVar=deployTarget=aGVsbG8gd29ybGQ=${ST}`,
  },
  {
    id: 'osc1337-custom',
    values: { identity: 'shared-secret', payload: 'ping' },
    expected: `${ESC}]1337;Custom=id=shared-secret:ping${ST}`,
  },
  {
    id: 'osc1337-copy-to-clipboard',
    values: { text: 'copied text' },
    expected: `${ESC}]1337;CopyToClipboard=${ST}copied text${ESC}]1337;EndCopy${ST}`,
  },
  {
    id: 'osc1337-block',
    values: { identifier: 'build-log' },
    expected: `${ESC}]1337;Block=id=build-log;attr=start${ST}`,
  },
  {
    id: 'osc1337-update-block',
    values: { identifier: 'build-log', action: 'unfold' },
    expected: `${ESC}]1337;UpdateBlock=id=build-log;action=unfold${ST}`,
  },
  {
    id: 'osc1337-button-copy',
    values: { block: 'build-log' },
    expected: `${ESC}]1337;Button=type=copy;block=build-log${ST}`,
  },
  {
    id: 'osc1337-button-custom',
    values: { code: 'make deploy', icon: 'play.circle' },
    expected: `${ESC}]1337;Button=type=custom;code=make deploy;icon=play.circle${ST}`,
  },
  {
    id: 'osc1337-set-colors',
    values: { key: 'bg', value: 'f0f0f0' },
    expected: `${ESC}]1337;SetColors=bg=f0f0f0${ST}`,
  },
  {
    id: 'osc1337-highlight-cursor-line',
    values: { enabled: 'no' },
    expected: `${ESC}]1337;HighlightCursorLine=no${ST}`,
  },
  { id: 'osc1337-report-cell-size', expected: `${ESC}]1337;ReportCellSize${ST}` },
  { id: 'osc1337-steal-focus', expected: `${ESC}]1337;StealFocus${ST}` },
  { id: 'osc1337-clear-scrollback', expected: `${ESC}]1337;ClearScrollback${ST}` },
  { id: 'osc133-a', expected: `${ESC}]133;A${ST}` },
  { id: 'osc133-b', expected: `${ESC}]133;B${ST}` },
  { id: 'osc133-c', expected: `${ESC}]133;C${ST}` },
  { id: 'osc133-d', values: { status: '7' }, expected: `${ESC}]133;D;7${ST}` },
  {
    id: 'osc8-hyperlink',
    values: { url: 'https://example.com', text: 'click here' },
    expected: `${ESC}]8;;https://example.com${ST}click here${ESC}]8;;${ST}`,
  },
  { id: 'csi-underline-style', values: { style: 'dotted' }, expected: `${ESC}[4:4m` },
  {
    id: 'csi-underline-color',
    values: { red: '32', green: '64', blue: '128' },
    expected: `${ESC}[58:2::32:64:128m`,
  },
  { id: 'csi-underline-color-reset', expected: `${ESC}[59m` },
  { id: 'csi-sgr-reset', expected: `${ESC}[0m` },
  { id: 'csi-reset-cursor', expected: `${ESC}[0 q` },
];

describe('escape template construction', () => {
  it('covers every catalog template with a byte-exact case', () => {
    const tableIds = new Set(CASES.map((c) => c.id));
    const catalogIds = new Set(ESCAPE_TEMPLATES.map((t) => t.id));
    expect([...tableIds].sort()).toEqual([...catalogIds].sort());
  });

  for (const c of CASES) {
    it(`builds ${c.id}`, () => {
      expect(build(c.id, c.values)).toBe(c.expected);
    });
  }
});

describe('defaults', () => {
  it('applies field defaults when no value is entered', () => {
    expect(build('osc1337-request-attention')).toBe(`${ESC}]1337;RequestAttention=yes${ST}`);
    expect(build('osc133-d')).toBe(`${ESC}]133;D;0${ST}`);
    expect(build('csi-underline-style')).toBe(`${ESC}[4:3m`);
    expect(build('csi-underline-color')).toBe(`${ESC}[58:2::255:0:0m`);
    expect(build('osc1337-block', { identifier: 'b' })).toBe(
      `${ESC}]1337;Block=id=b;attr=start${ST}`,
    );
    expect(build('osc1337-update-block', { identifier: 'b' })).toBe(
      `${ESC}]1337;UpdateBlock=id=b;action=fold${ST}`,
    );
    expect(build('osc1337-highlight-cursor-line')).toBe(
      `${ESC}]1337;HighlightCursorLine=yes${ST}`,
    );
    expect(build('osc1337-set-colors', { value: 'fff' })).toBe(
      `${ESC}]1337;SetColors=fg=fff${ST}`,
    );
  });

  it('entered values override defaults; missing fields become empty string', () => {
    const t = template('osc1337-request-attention');
    expect(effectiveValues(t, { mode: 'once' })).toEqual({ mode: 'once' });
    expect(effectiveValues(template('osc1337-current-dir'), {})).toEqual({ path: '' });
  });
});

describe('encoding details', () => {
  it('base64-encodes SetUserVar values as UTF-8', () => {
    expect(build('osc1337-set-user-var', { key: 'k', value: 'héllo' })).toBe(
      `${ESC}]1337;SetUserVar=k=aMOpbGxv${ST}`,
    );
  });

  it('base64-encodes an empty SetUserVar value to the empty string', () => {
    expect(build('osc1337-set-user-var', { key: 'k' })).toBe(`${ESC}]1337;SetUserVar=k=${ST}`);
  });

  it('an empty SetBackgroundImageFile path clears the image', () => {
    expect(build('osc1337-set-background-image')).toBe(
      `${ESC}]1337;SetBackgroundImageFile=${ST}`,
    );
  });

  it('strips whitespace from pasted base64 file data', () => {
    expect(build('osc1337-file-inline', { data_base64: 'AA\nAA ==' })).toBe(
      `${ESC}]1337;File=inline=1;width=auto;height=auto;preserveAspectRatio=1:AAAA==${BEL}`,
    );
  });

  it('omits the File name argument when no name is given', () => {
    expect(build('osc1337-file-download', { data_base64: 'AAAA' })).toBe(
      `${ESC}]1337;File=:AAAA${BEL}`,
    );
  });

  it('maps the general clipboard to an empty wire name and named pasteboards verbatim', () => {
    expect(build('osc1337-copy-to-clipboard', { clipboard: 'find', text: 't' })).toBe(
      `${ESC}]1337;CopyToClipboard=find${ST}t${ESC}]1337;EndCopy${ST}`,
    );
  });

  it('a custom Button with no code emits the removal form', () => {
    expect(build('osc1337-button-custom')).toBe(`${ESC}]1337;Button=type=custom${ST}`);
  });

  it('a hyperlink with a link id carries it as the params field', () => {
    expect(build('osc8-hyperlink', { url: 'https://x.dev', text: 'x', link_id: 'k1' })).toBe(
      `${ESC}]8;id=k1;https://x.dev${ST}x${ESC}]8;;${ST}`,
    );
  });
});

describe('incomplete input', () => {
  const required: Array<[string, string]> = [
    ['osc1337-current-dir', 'path'],
    ['osc1337-set-profile', 'name'],
    ['osc1337-add-annotation', 'message'],
    ['osc1337-add-hidden-annotation', 'message'],
    ['osc1337-file-inline', 'data_base64'],
    ['osc1337-file-download', 'data_base64'],
    ['osc1337-set-user-var', 'key'],
    ['osc1337-custom', 'identity'],
    ['osc1337-copy-to-clipboard', 'text'],
    ['osc1337-block', 'identifier'],
    ['osc1337-update-block', 'identifier'],
    ['osc1337-button-copy', 'block'],
    ['osc1337-set-colors', 'value'],
    ['osc8-hyperlink', 'url'],
  ];

  for (const [id, field] of required) {
    it(`${id} reports missing ${field} as a value, not a throw`, () => {
      const result = renderTemplate(template(id), {});
      expect(result).toEqual({ ok: false, error: `missing required field: ${field}` });
    });
  }

  it('never throws for any template on empty input', () => {
    for (const t of ESCAPE_TEMPLATES) {
      expect(() => renderTemplate(t, {})).not.toThrow();
    }
  });
});

describe('catalog invariants', () => {
  it('template ids are unique', () => {
    const ids = ESCAPE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every select default is one of its options', () => {
    for (const t of ESCAPE_TEMPLATES) {
      for (const f of t.fields) {
        if (f.type !== 'select') continue;
        expect(f.options.length, `${t.id}.${f.name}`).toBeGreaterThan(1);
        expect(f.options, `${t.id}.${f.name}`).toContain(f.default);
      }
    }
  });

  it('includes every subcommand named by the proposal catalog', () => {
    const ids = new Set(ESCAPE_TEMPLATES.map((t) => t.id));
    for (const id of [
      'osc1337-set-mark',
      'osc1337-current-dir',
      'osc1337-file-inline',
      'osc1337-custom',
      'osc1337-block',
      'osc1337-button-copy',
      'osc1337-button-custom',
      'osc1337-set-colors',
      'osc1337-set-user-var',
      'osc1337-copy-to-clipboard',
      'osc1337-request-attention',
      'osc8-hyperlink',
      'osc133-a',
      'osc133-b',
      'osc133-c',
      'osc133-d',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
