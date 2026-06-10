#!/usr/bin/env node
// Generates src/shared/profileSchema.generated.ts from iTerm2's authoritative profile
// schema: the DefaultBookmark.plist shipped inside iTerm.app. That plist is the one true
// enumeration of profile keys, their value shapes, and their default values — iTerm2's API
// itself exposes a profile property only as an opaque { key, json_value } pair, so this file
// is the bridge from "opaque string keys" to a typed, defaulted field surface.
//
// [LAW:one-source-of-truth] The generated module is derived, never authoritative: re-run this
// script to resync it with the installed iTerm2. The categorization/enum knowledge below is the
// one place that editorial classification lives.
//
// Usage: node scripts/gen-profile-schema.cjs [path-to-DefaultBookmark.plist]

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PLIST =
  process.argv[2] ||
  '/Applications/iTerm.app/Contents/Resources/DefaultBookmark.plist';

const OUT = path.join(__dirname, '..', 'src', 'shared', 'profileSchema.generated.ts');

// Explicit category assignment for non-color keys. Anything containing "Color" is Colors by
// rule; anything else not listed here lands in Advanced. Order of the categories themselves is
// owned by PROFILE_CATEGORIES in profileSchema.ts, not here.
const CATEGORY = {
  // Text
  'Normal Font': 'Text',
  'Non Ascii Font': 'Text',
  'Use Non-ASCII Font': 'Text',
  'Use Bold Font': 'Text',
  'Use Italic Font': 'Text',
  'Use Bright Bold': 'Text',
  'ASCII Anti Aliased': 'Text',
  'Non-ASCII Anti Aliased': 'Text',
  'Horizontal Spacing': 'Text',
  'Vertical Spacing': 'Text',
  'Blinking Cursor': 'Text',
  // Window
  Transparency: 'Window',
  'Use Transparency': 'Window',
  Blur: 'Window',
  Columns: 'Window',
  Rows: 'Window',
  'Window Type': 'Window',
  Screen: 'Window',
  'Background Image Location': 'Window',
  // Terminal
  'Character Encoding': 'Terminal',
  'Terminal Type': 'Terminal',
  'Scrollback Lines': 'Terminal',
  'Unlimited Scrollback': 'Terminal',
  'Silence Bell': 'Terminal',
  'Visual Bell': 'Terminal',
  'Flashing Bell': 'Terminal',
  'Close Sessions On End': 'Terminal',
  'Mouse Reporting': 'Terminal',
  // Session
  Name: 'Session',
  'Badge Text': 'Session',
  Command: 'Session',
  'Custom Command': 'Session',
  'Working Directory': 'Session',
  'Custom Directory': 'Session',
  Shortcut: 'Session',
  // Keys
  'Option Key Sends': 'Keys',
  'Right Option Key Sends': 'Keys',
  // Advanced — niche/legacy switches that don't belong to a user-facing group.
  'BM Growl': 'Advanced',
  'Ambiguous Double Width': 'Advanced',
  'Idle Code': 'Advanced',
  'Send Code When Idle': 'Advanced',
  'Disable Window Resizing': 'Advanced',
  'Use Separate Colors for Light and Dark Mode': 'Advanced',
  'Default Bookmark': 'Advanced',
  'Sync Title': 'Advanced',
};

// Number-valued enums whose options we are confident about. A field with options renders as a
// dropdown; without, as a free input. Kept deliberately small — a wrong option set is worse than
// a plain numeric input.
const NUMBER_ENUMS = {
  'Option Key Sends': [
    { value: '0', label: 'Normal' },
    { value: '1', label: 'Meta' },
    { value: '2', label: 'Esc+' },
  ],
  'Right Option Key Sends': [
    { value: '0', label: 'Normal' },
    { value: '1', label: 'Meta' },
    { value: '2', label: 'Esc+' },
  ],
};

// Keys the current app edits that are not present in the default plist (iTerm2 supplies them
// lazily). Added so the generated surface is a superset of what already shipped.
const EXTRA_FIELDS = [
  { key: 'Badge Text', kind: 'text', default: { kind: 'text', value: '' } },
  { key: 'Use Transparency', kind: 'toggle', default: { kind: 'toggle', on: false } },
];

function readPlist(file) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

function isColorDict(v) {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    'Red Component' in v &&
    'Green Component' in v &&
    'Blue Component' in v
  );
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function colorToHex(d) {
  const to = (c) =>
    Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(d['Red Component'])}${to(d['Green Component'])}${to(d['Blue Component'])}`;
}

function categoryFor(key) {
  if (/Color/.test(key)) return 'Colors';
  return CATEGORY[key] || 'Advanced';
}

// Decide the field kind + default FieldValue for a raw plist value.
function specFor(key, raw) {
  if (isColorDict(raw)) {
    return {
      kind: 'color',
      default: {
        kind: 'color',
        hex: colorToHex(raw),
        alpha: clamp01(raw['Alpha Component'] ?? 1),
      },
    };
  }
  if (typeof raw === 'boolean') {
    return { kind: 'toggle', default: { kind: 'toggle', on: raw } };
  }
  if (typeof raw === 'number') {
    return { kind: 'number', default: { kind: 'number', raw: String(raw) } };
  }
  if (typeof raw === 'string') {
    return { kind: 'text', default: { kind: 'text', value: raw } };
  }
  return null; // dicts (Keyboard Map), arrays (Tags) — not scalar-editable
}

function labelFor(key) {
  return key;
}

function main() {
  if (!fs.existsSync(PLIST)) {
    console.error(`DefaultBookmark.plist not found at ${PLIST}`);
    process.exit(1);
  }
  const plist = readPlist(PLIST);
  const fields = [];

  for (const key of Object.keys(plist)) {
    // Light/Dark variants are collapsed to their base key for v1; the base set is what applies
    // when "Use Separate Colors for Light and Dark Mode" is off.
    if (/ \((Light|Dark)\)$/.test(key)) continue;
    const spec = specFor(key, plist[key]);
    if (!spec) continue;
    fields.push({
      key,
      category: categoryFor(key),
      label: labelFor(key),
      kind: spec.kind,
      default: spec.default,
      options: NUMBER_ENUMS[key],
    });
  }

  for (const extra of EXTRA_FIELDS) {
    if (fields.some((f) => f.key === extra.key)) continue;
    fields.push({
      key: extra.key,
      category: categoryFor(extra.key),
      label: labelFor(extra.key),
      kind: extra.kind,
      default: extra.default,
      options: NUMBER_ENUMS[extra.key],
    });
  }

  // Stable sort: category order then key, so diffs are legible when iTerm2 ships changes.
  const CAT_ORDER = ['Colors', 'Text', 'Window', 'Terminal', 'Session', 'Keys', 'Advanced'];
  fields.sort((a, b) => {
    const c = CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category);
    return c !== 0 ? c : a.key.localeCompare(b.key);
  });

  const body = fields
    .map((f) => {
      const opts = f.options
        ? `, options: ${JSON.stringify(f.options)}`
        : '';
      return `  { key: ${JSON.stringify(f.key)}, category: '${f.category}', label: ${JSON.stringify(
        f.label,
      )}, kind: '${f.kind}', default: ${JSON.stringify(f.default)}${opts} },`;
    })
    .join('\n');

  const out = `// GENERATED by scripts/gen-profile-schema.cjs from iTerm2's DefaultBookmark.plist.
// Do not edit by hand — re-run the generator to resync with the installed iTerm2.
// [LAW:one-source-of-truth] Derived from the plist; the plist is authoritative.
import type { ProfileFieldSpec } from './profileSchema';

export const PROFILE_FIELDS: readonly ProfileFieldSpec[] = [
${body}
];
`;

  fs.writeFileSync(OUT, out);
  console.error(`Wrote ${fields.length} fields to ${path.relative(process.cwd(), OUT)}`);
}

main();
