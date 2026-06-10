export const ESC = '\x1b';
export const ST = '\x1b\\';
export const BEL = '\x07';

function base64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === 'function') return btoa(binary);
  // Node fallback
  const BufferRef = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (BufferRef) return BufferRef.from(input, 'utf8').toString('base64');
  throw new Error('no base64 encoder available');
}

// [LAW:types-are-the-program] A select field carries its legal values; free-form fields carry
// none. The discriminant makes "select without options" unrepresentable.
interface TemplateFieldBase {
  name: string;
  placeholder?: string;
  default?: string;
  help?: string;
}

export type TemplateField =
  | (TemplateFieldBase & { type: 'string' | 'number' | 'multiline' | 'file-base64' })
  | (TemplateFieldBase & { type: 'select'; options: readonly string[] });

export type FieldType = TemplateField['type'];

export interface EscapeTemplate {
  id: string;
  label: string;
  group: 'osc-1337' | 'osc-133' | 'osc-8' | 'csi';
  description: string;
  fields: TemplateField[];
  // Expects values already merged by effectiveValues(); call through renderTemplate(), which
  // owns defaulting and lifts missing-required-field throws into a BuildResult.
  build: (values: Record<string, string>) => string;
}

// [LAW:one-source-of-truth] Field defaults are applied here, once, for both the form display and
// sequence construction. Builders never re-default with `||` fallbacks.
export function effectiveValues(
  template: EscapeTemplate,
  values: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const f of template.fields) {
    const entered = values[f.name];
    merged[f.name] = entered ?? f.default ?? '';
  }
  return merged;
}

export type BuildResult =
  | { ok: true; sequence: string }
  | { ok: false; error: string };

// [LAW:no-silent-failure] build() throws on incomplete values — that is its contract. The preview
// seam lifts that failure into a value so callers render the error instead of crashing; the error
// text is carried forward, never swallowed.
export function renderTemplate(
  template: EscapeTemplate,
  values: Record<string, string>,
): BuildResult {
  try {
    return { ok: true, sequence: template.build(effectiveValues(template, values)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function osc1337(body: string): string {
  return `${ESC}]1337;${body}${ST}`;
}

function osc133(letter: string): string {
  return `${ESC}]133;${letter}${ST}`;
}

function csi(body: string): string {
  return `${ESC}[${body}`;
}

function requireField(values: Record<string, string>, name: string): string {
  const v = values[name];
  if (v == null || v === '') throw new Error(`missing required field: ${name}`);
  return v;
}

// The general pasteboard is the empty string on the wire; the form shows a real word for it.
const CLIPBOARD_WIRE: Record<string, string> = {
  general: '',
  rule: 'rule',
  find: 'find',
  font: 'font',
};

export const UNDERLINE_STYLES: readonly string[] = ['none', 'straight', 'double', 'curly', 'dotted', 'dashed'];

const SET_COLORS_KEYS = [
  'fg', 'bg', 'bold', 'link', 'selbg', 'selfg', 'curbg', 'curfg', 'underline', 'tab',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'br_black', 'br_red', 'br_green', 'br_yellow', 'br_blue', 'br_magenta', 'br_cyan', 'br_white',
  'preset',
] as const;

export const ESCAPE_TEMPLATES: EscapeTemplate[] = [
  {
    id: 'osc1337-set-mark',
    label: 'SetMark',
    group: 'osc-1337',
    description: 'Records a navigable mark at the cursor.',
    fields: [],
    build: () => osc1337('SetMark'),
  },
  {
    id: 'osc1337-current-dir',
    label: 'CurrentDir',
    group: 'osc-1337',
    description: 'Report the current working directory (for Semantic History).',
    fields: [{ name: 'path', type: 'string', placeholder: '/Users/me/code' }],
    build: (v) => osc1337(`CurrentDir=${requireField(v, 'path')}`),
  },
  {
    id: 'osc1337-set-profile',
    label: 'SetProfile',
    group: 'osc-1337',
    description: 'Switch the session to a named profile.',
    fields: [{ name: 'name', type: 'string', placeholder: 'Default' }],
    build: (v) => osc1337(`SetProfile=${requireField(v, 'name')}`),
  },
  {
    id: 'osc1337-request-attention',
    label: 'RequestAttention',
    group: 'osc-1337',
    description: 'Bounce the Dock icon (yes = until cancelled, once = single bounce, no = cancel, fireworks = explode at cursor).',
    fields: [
      {
        name: 'mode',
        type: 'select',
        options: ['yes', 'once', 'no', 'fireworks'],
        default: 'yes',
      },
    ],
    build: (v) => osc1337(`RequestAttention=${v.mode}`),
  },
  {
    id: 'osc1337-add-annotation',
    label: 'AddAnnotation',
    group: 'osc-1337',
    description: 'Add a visible annotation at the cursor.',
    fields: [{ name: 'message', type: 'string', placeholder: 'annotation text' }],
    build: (v) => osc1337(`AddAnnotation=${requireField(v, 'message')}`),
  },
  {
    id: 'osc1337-add-hidden-annotation',
    label: 'AddHiddenAnnotation',
    group: 'osc-1337',
    description: 'Add an annotation at the cursor without revealing it.',
    fields: [{ name: 'message', type: 'string', placeholder: 'annotation text' }],
    build: (v) => osc1337(`AddHiddenAnnotation=${requireField(v, 'message')}`),
  },
  {
    id: 'osc1337-file-inline',
    label: 'Inline Image (File)',
    group: 'osc-1337',
    description: 'Embed an image in the terminal output.',
    fields: [
      {
        name: 'name',
        type: 'string',
        placeholder: 'logo.png',
        help: 'Filename shown by iTerm2; base64-encoded automatically.',
      },
      {
        name: 'width',
        type: 'string',
        default: 'auto',
        help: 'auto | <n>px | <n>% | <n> (cells)',
      },
      {
        name: 'height',
        type: 'string',
        default: 'auto',
        help: 'auto | <n>px | <n>% | <n> (cells)',
      },
      {
        name: 'preserve_aspect_ratio',
        type: 'select',
        options: ['1', '0'],
        default: '1',
        help: '0 stretches to fill width/height exactly.',
      },
      { name: 'data_base64', type: 'file-base64', placeholder: 'base64 image bytes' },
    ],
    build: (v) => {
      const body = requireField(v, 'data_base64').replace(/\s+/g, '');
      const args = [
        'inline=1',
        v.name ? `name=${base64Utf8(v.name)}` : '',
        `width=${v.width}`,
        `height=${v.height}`,
        `preserveAspectRatio=${v.preserve_aspect_ratio}`,
      ].filter(Boolean);
      return `${ESC}]1337;File=${args.join(';')}:${body}${BEL}`;
    },
  },
  {
    id: 'osc1337-file-download',
    label: 'File Download',
    group: 'osc-1337',
    description: 'Transfer a file to the local machine (no inline display; iTerm2 offers to save it).',
    fields: [
      {
        name: 'name',
        type: 'string',
        placeholder: 'notes.txt',
        help: 'Filename for the download; base64-encoded automatically.',
      },
      {
        name: 'size',
        type: 'number',
        placeholder: '1024',
        help: 'File size in bytes, used for the progress indicator.',
      },
      { name: 'data_base64', type: 'file-base64', placeholder: 'base64 file bytes' },
    ],
    build: (v) => {
      const body = requireField(v, 'data_base64').replace(/\s+/g, '');
      const args = [
        v.name ? `name=${base64Utf8(v.name)}` : '',
        v.size ? `size=${v.size}` : '',
      ].filter(Boolean);
      return `${ESC}]1337;File=${args.join(';')}:${body}${BEL}`;
    },
  },
  {
    id: 'osc1337-set-background-image',
    label: 'SetBackgroundImageFile',
    group: 'osc-1337',
    description: 'Set the session background image to a file path (iTerm2 asks for confirmation). Empty path clears it.',
    fields: [
      {
        name: 'path',
        type: 'string',
        placeholder: '/Users/me/Pictures/bg.png',
        help: 'Absolute path on the machine running iTerm2; base64-encoded automatically.',
      },
    ],
    build: (v) => osc1337(`SetBackgroundImageFile=${base64Utf8(v.path ?? '')}`),
  },
  {
    id: 'osc1337-set-user-var',
    label: 'SetUserVar',
    group: 'osc-1337',
    description: 'Set a user.* variable (value is base64-encoded).',
    fields: [
      { name: 'key', type: 'string', placeholder: 'myVar' },
      {
        name: 'value',
        type: 'string',
        placeholder: 'hello world',
        help: 'This plain value is base64-encoded automatically.',
      },
    ],
    build: (v) => {
      const key = requireField(v, 'key');
      return osc1337(`SetUserVar=${key}=${base64Utf8(v.value ?? '')}`);
    },
  },
  {
    id: 'osc1337-custom',
    label: 'Custom',
    group: 'osc-1337',
    description: 'Application-defined payload, paired with CustomControlSequenceMonitor.',
    fields: [
      { name: 'identity', type: 'string', placeholder: 'shared-secret' },
      { name: 'payload', type: 'string', placeholder: 'any text' },
    ],
    build: (v) =>
      osc1337(`Custom=id=${requireField(v, 'identity')}:${v.payload ?? ''}`),
  },
  {
    id: 'osc1337-copy-to-clipboard',
    label: 'CopyToClipboard',
    group: 'osc-1337',
    description: 'Place text on a pasteboard: opens copy mode, emits the text, then EndCopy closes it.',
    fields: [
      {
        name: 'clipboard',
        type: 'select',
        options: ['general', 'rule', 'find', 'font'],
        default: 'general',
        help: 'Target pasteboard; "general" is the normal clipboard.',
      },
      { name: 'text', type: 'string', placeholder: 'text to copy' },
    ],
    build: (v) => {
      const name = CLIPBOARD_WIRE[requireField(v, 'clipboard')];
      if (name == null) throw new Error(`unknown clipboard: ${v.clipboard}`);
      const text = requireField(v, 'text');
      return `${osc1337(`CopyToClipboard=${name}`)}${text}${osc1337('EndCopy')}`;
    },
  },
  {
    id: 'osc1337-block',
    label: 'Block',
    group: 'osc-1337',
    description: 'Mark the start or end of a named block of output (foldable, copyable; iTerm2 3.5+).',
    fields: [
      { name: 'identifier', type: 'string', placeholder: 'build-log' },
      { name: 'attr', type: 'select', options: ['start', 'end'], default: 'start' },
    ],
    build: (v) => osc1337(`Block=id=${requireField(v, 'identifier')};attr=${v.attr}`),
  },
  {
    id: 'osc1337-update-block',
    label: 'UpdateBlock',
    group: 'osc-1337',
    description: 'Fold or unfold an existing block by id (iTerm2 3.5+).',
    fields: [
      { name: 'identifier', type: 'string', placeholder: 'build-log' },
      { name: 'action', type: 'select', options: ['fold', 'unfold'], default: 'fold' },
    ],
    build: (v) => osc1337(`UpdateBlock=id=${requireField(v, 'identifier')};action=${v.action}`),
  },
  {
    id: 'osc1337-button-copy',
    label: 'Button (copy block)',
    group: 'osc-1337',
    description: 'Show a button that copies the named block when clicked (iTerm2 3.5+).',
    fields: [{ name: 'block', type: 'string', placeholder: 'build-log' }],
    build: (v) => osc1337(`Button=type=copy;block=${requireField(v, 'block')}`),
  },
  {
    id: 'osc1337-button-custom',
    label: 'Button (custom)',
    group: 'osc-1337',
    description: 'Show a custom button that sends a code when clicked; empty code removes the button (iTerm2 3.5+).',
    fields: [
      { name: 'code', type: 'string', placeholder: 'make deploy', help: 'Leave empty to remove the button.' },
      { name: 'icon', type: 'string', placeholder: 'play.circle', help: 'SF Symbol name.' },
    ],
    build: (v) => {
      const args = [
        'type=custom',
        v.code ? `code=${v.code}` : '',
        v.icon ? `icon=${v.icon}` : '',
      ].filter(Boolean);
      return osc1337(`Button=${args.join(';')}`);
    },
  },
  {
    id: 'osc1337-set-colors',
    label: 'SetColors',
    group: 'osc-1337',
    description: 'Change a session color at runtime.',
    fields: [
      {
        name: 'key',
        type: 'select',
        options: SET_COLORS_KEYS,
        default: 'fg',
        help: '"preset" applies a whole color preset by name.',
      },
      {
        name: 'value',
        type: 'string',
        placeholder: 'f0f0f0',
        help: 'RGB | RRGGBB | <srgb|rgb|p3>:RRGGBB; preset name when key=preset; "default" removes a tab color.',
      },
    ],
    build: (v) => osc1337(`SetColors=${v.key}=${requireField(v, 'value')}`),
  },
  {
    id: 'osc1337-highlight-cursor-line',
    label: 'HighlightCursorLine',
    group: 'osc-1337',
    description: 'Toggle highlighting of the line the cursor is on.',
    fields: [{ name: 'enabled', type: 'select', options: ['yes', 'no'], default: 'yes' }],
    build: (v) => osc1337(`HighlightCursorLine=${v.enabled}`),
  },
  {
    id: 'osc1337-report-cell-size',
    label: 'ReportCellSize',
    group: 'osc-1337',
    description: 'Ask iTerm2 to report the cell size; the reply arrives as terminal input.',
    fields: [],
    build: () => osc1337('ReportCellSize'),
  },
  {
    id: 'osc1337-steal-focus',
    label: 'StealFocus',
    group: 'osc-1337',
    description: 'Bring iTerm2 to the foreground.',
    fields: [],
    build: () => osc1337('StealFocus'),
  },
  {
    id: 'osc1337-clear-scrollback',
    label: 'ClearScrollback',
    group: 'osc-1337',
    description: 'Erase the session scrollback buffer.',
    fields: [],
    build: () => osc1337('ClearScrollback'),
  },
  {
    id: 'osc133-a',
    label: 'Prompt start (A)',
    group: 'osc-133',
    description: 'FinalTerm prompt-start marker.',
    fields: [],
    build: () => osc133('A'),
  },
  {
    id: 'osc133-b',
    label: 'Command start (B)',
    group: 'osc-133',
    description: 'FinalTerm command-start marker.',
    fields: [],
    build: () => osc133('B'),
  },
  {
    id: 'osc133-c',
    label: 'Command executed (C)',
    group: 'osc-133',
    description: 'FinalTerm command-executed marker (output begins).',
    fields: [],
    build: () => osc133('C'),
  },
  {
    id: 'osc133-d',
    label: 'Command finished (D)',
    group: 'osc-133',
    description: 'FinalTerm command-finished marker with exit status.',
    fields: [{ name: 'status', type: 'number', default: '0' }],
    build: (v) => osc133(`D;${v.status}`),
  },
  {
    id: 'osc8-hyperlink',
    label: 'Hyperlink',
    group: 'osc-8',
    description: 'Render text as a clickable hyperlink (closes with OSC 8 ;; ST).',
    fields: [
      { name: 'url', type: 'string', placeholder: 'https://example.com' },
      { name: 'text', type: 'string', placeholder: 'click here' },
      {
        name: 'link_id',
        type: 'string',
        placeholder: 'my-link',
        help: 'Optional id= param; cells sharing an id highlight as one link across line breaks.',
      },
    ],
    build: (v) => {
      const url = requireField(v, 'url');
      const text = requireField(v, 'text');
      const params = v.link_id ? `id=${v.link_id}` : '';
      return `${ESC}]8;${params};${url}${ST}${text}${ESC}]8;;${ST}`;
    },
  },
  {
    id: 'csi-underline-style',
    label: 'Underline style',
    group: 'csi',
    description: 'Set the underline style for subsequent text (SGR 4:n; iTerm2 3.4+).',
    fields: [
      {
        name: 'style',
        type: 'select',
        options: UNDERLINE_STYLES,
        default: 'curly',
      },
    ],
    build: (v) => {
      const idx = UNDERLINE_STYLES.indexOf(v.style);
      if (idx < 0) throw new Error(`unknown underline style: ${v.style}`);
      return csi(`4:${idx}m`);
    },
  },
  {
    id: 'csi-underline-color',
    label: 'Underline color',
    group: 'csi',
    description: 'Set the underline color for subsequent text (SGR 58 direct RGB; iTerm2 3.4+).',
    fields: [
      { name: 'red', type: 'number', default: '255' },
      { name: 'green', type: 'number', default: '0' },
      { name: 'blue', type: 'number', default: '0' },
    ],
    build: (v) => csi(`58:2::${v.red}:${v.green}:${v.blue}m`),
  },
  {
    id: 'csi-underline-color-reset',
    label: 'Underline color reset',
    group: 'csi',
    description: 'Restore the default underline color (SGR 59).',
    fields: [],
    build: () => csi('59m'),
  },
  {
    id: 'csi-sgr-reset',
    label: 'SGR reset',
    group: 'csi',
    description: 'Reset all character attributes (SGR 0), including underline style and color.',
    fields: [],
    build: () => csi('0m'),
  },
  {
    id: 'csi-reset-cursor',
    label: 'Reset cursor shape',
    group: 'csi',
    description: 'Restore the cursor appearance chosen in the profile (CSI 0 SP q).',
    fields: [],
    build: () => csi('0 q'),
  },
];
