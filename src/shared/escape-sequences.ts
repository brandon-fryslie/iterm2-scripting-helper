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

export type FieldType = 'string' | 'number' | 'boolean' | 'multiline' | 'file-base64';

export interface TemplateField {
  name: string;
  type: FieldType;
  placeholder?: string;
  default?: string;
  help?: string;
}

export interface EscapeTemplate {
  id: string;
  label: string;
  group: 'osc-1337' | 'osc-133' | 'osc-8' | 'csi';
  description: string;
  fields: TemplateField[];
  build: (values: Record<string, string>) => string;
}

function osc1337(body: string): string {
  return `${ESC}]1337;${body}${ST}`;
}

function osc133(letter: string): string {
  return `${ESC}]133;${letter}${ST}`;
}

function requireField(values: Record<string, string>, name: string): string {
  const v = values[name];
  if (v == null || v === '') throw new Error(`missing required field: ${name}`);
  return v;
}

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
    description: 'Bounce the Dock icon to request user attention.',
    fields: [
      {
        name: 'mode',
        type: 'string',
        default: 'yes',
        help: 'yes | once | no | fireworks',
      },
    ],
    build: (v) => osc1337(`RequestAttention=${v.mode || 'yes'}`),
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
    id: 'osc1337-file-inline',
    label: 'Inline Image (File)',
    group: 'osc-1337',
    description: 'Embed an image in the terminal output.',
    fields: [
      {
        name: 'name_base64',
        type: 'string',
        placeholder: 'base64-encoded filename',
        help: 'Suggested: btoa("logo.png")',
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
        type: 'boolean',
        default: 'true',
      },
      { name: 'data_base64', type: 'file-base64', placeholder: 'base64 image bytes' },
    ],
    build: (v) => {
      const body = requireField(v, 'data_base64').replace(/\s+/g, '');
      const args = [
        'inline=1',
        v.name_base64 ? `name=${v.name_base64}` : '',
        `width=${v.width || 'auto'}`,
        `height=${v.height || 'auto'}`,
        `preserveAspectRatio=${v.preserve_aspect_ratio === 'false' ? '0' : '1'}`,
      ].filter(Boolean);
      return `${ESC}]1337;File=${args.join(';')}:${body}${BEL}`;
    },
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
      const value = v.value ?? '';
      return osc1337(`SetUserVar=${key}=${base64Utf8(value)}`);
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
    build: (v) => osc133(`D;${v.status || '0'}`),
  },
  {
    id: 'osc8-hyperlink',
    label: 'Hyperlink',
    group: 'osc-8',
    description: 'Render text as a clickable hyperlink (closes with OSC 8 ;; ST).',
    fields: [
      { name: 'url', type: 'string', placeholder: 'https://example.com' },
      { name: 'text', type: 'string', placeholder: 'click here' },
    ],
    build: (v) => {
      const url = requireField(v, 'url');
      const text = requireField(v, 'text');
      return `${ESC}]8;;${url}${ST}${text}${ESC}]8;;${ST}`;
    },
  },
  {
    id: 'csi-curly-underline',
    label: 'Curly underline',
    group: 'csi',
    description: 'Enable curly underline for subsequent text.',
    fields: [],
    build: () => `${ESC}[4:3m`,
  },
];
