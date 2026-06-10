// The profile-key schema: the single typed surface for iTerm2's profile properties.
//
// iTerm2's API models a profile property as an opaque { key: string, json_value: string } pair
// (see proto/api.proto ProfileProperty) — it carries no type, no default, no grouping. This
// module is the one place that knowledge lives: each ProfileFieldSpec says what a key *is* (its
// category, its value kind, its default), and the codecs below are the one way to move between
// the JSON iTerm2 stores and the value an editor holds.
//
// [LAW:types-are-the-program] FieldValue is a closed discriminated union — every editable shape
// is one variant, every illegal shape unrepresentable. Decode/encode/diff are total matches over
// it, so adding a field kind forces every codec to handle it (the compiler refuses otherwise).
// [LAW:dataflow-not-control-flow] The editor does not branch per key; it maps over PROFILE_FIELDS
// and dispatches on the field's *value* (its kind), which is data carried by the spec.

import { PROFILE_FIELDS } from './profileSchema.generated';

export type ProfileCategory =
  | 'Colors'
  | 'Text'
  | 'Window'
  | 'Terminal'
  | 'Session'
  | 'Keys'
  | 'Advanced';

// Display + iteration order for the editor's category sections.
export const PROFILE_CATEGORIES: readonly ProfileCategory[] = [
  'Colors',
  'Text',
  'Window',
  'Terminal',
  'Session',
  'Keys',
  'Advanced',
];

// The value an editor holds for one field. The wire (JSON) representation is derived from this by
// encodeField; the editor never manipulates wire JSON directly.
export type FieldValue =
  | { kind: 'color'; hex: string; alpha: number }
  | { kind: 'toggle'; on: boolean }
  | { kind: 'number'; raw: string }
  | { kind: 'text'; value: string };

export type FieldKind = FieldValue['kind'];

export interface ProfileFieldSpec {
  // The iTerm2 wire key, e.g. "Background Color".
  key: string;
  category: ProfileCategory;
  label: string;
  kind: FieldKind;
  // The iTerm2 default, used for diff-vs-default and reset.
  default: FieldValue;
  // When present, the field is a closed choice (rendered as a dropdown) rather than free input.
  // Option values are the string form of the underlying value (numbers for number fields).
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export { PROFILE_FIELDS };

export const FIELD_BY_KEY: ReadonlyMap<string, ProfileFieldSpec> = new Map(
  PROFILE_FIELDS.map((f) => [f.key, f]),
);

// The keys to request from ListProfiles so the full editable surface is hydrated. 'Guid' is the
// identity column the read path keys on.
export const FETCH_KEYS: readonly string[] = [
  ...PROFILE_FIELDS.map((f) => f.key),
  'Guid',
];

export function fieldsByCategory(category: ProfileCategory): ProfileFieldSpec[] {
  return PROFILE_FIELDS.filter((f) => f.category === category);
}

// ---- Color codec: iTerm2 stores colors as a component dict, the editor as #rrggbb + alpha ----

interface ColorDict {
  'Red Component': number;
  'Green Component': number;
  'Blue Component': number;
  'Alpha Component': number;
  'Color Space': string;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function isColorDict(v: unknown): v is Record<string, unknown> {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    'Red Component' in v &&
    'Green Component' in v &&
    'Blue Component' in v
  );
}

const HEX6 = /^#?([0-9a-f]{6})$/i;

export function isHexColor(hex: string): boolean {
  return HEX6.test(hex.trim());
}

// A number field's raw text parses to a finite number, or null if it is malformed (the input is
// free text). The single parse used by both the guard and the wire encoder.
export function parseFiniteNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Whether a FieldValue can be encoded to the wire without inventing data. A color hex can be
// malformed and a number's raw text can be non-finite; toggles and text are always encodable.
// The write boundary uses this to refuse a bad value loudly rather than write corrupted data.
export function isEncodableValue(value: FieldValue): boolean {
  switch (value.kind) {
    case 'color':
      return isHexColor(value.hex);
    case 'number':
      return parseFiniteNumber(value.raw) !== null;
    case 'toggle':
    case 'text':
      return true;
  }
}

export function hexToColorDict(hex: string, alpha: number): ColorDict {
  const m = HEX6.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return {
    'Red Component': ((n >> 16) & 0xff) / 255,
    'Green Component': ((n >> 8) & 0xff) / 255,
    'Blue Component': (n & 0xff) / 255,
    'Alpha Component': clamp01(alpha),
    'Color Space': 'sRGB',
  };
}

export function colorDictToHex(d: Record<string, unknown>): string {
  const ch = (k: string) =>
    Math.round(clamp01(Number(d[k] ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch('Red Component')}${ch('Green Component')}${ch('Blue Component')}`;
}

// ---- Decode: one wire property (raw JSON string) -> FieldValue, by the spec's kind ----

export function decodeField(spec: ProfileFieldSpec, rawJson: string | undefined): FieldValue {
  if (rawJson == null) return spec.default;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // iTerm2 occasionally returns a bare string; treat the raw value as that string.
    parsed = rawJson;
  }
  switch (spec.kind) {
    case 'color':
      if (isColorDict(parsed)) {
        return {
          kind: 'color',
          hex: colorDictToHex(parsed),
          alpha: clamp01(Number(parsed['Alpha Component'] ?? 1)),
        };
      }
      return spec.default;
    case 'toggle':
      return { kind: 'toggle', on: Boolean(parsed) };
    case 'number':
      return { kind: 'number', raw: parsed == null ? '' : String(parsed) };
    case 'text':
      return { kind: 'text', value: parsed == null ? '' : String(parsed) };
  }
}

// ---- Encode ----

// A total, deterministic projection of a FieldValue to a wire-shaped string, used for equality and
// diff. It never throws, so the reactive diff path (changedKeys -> fieldValueEquals) is safe even
// while a field is mid-edit to a malformed state; a malformed value normalizes deterministically
// (bad hex -> black, non-finite number -> 0) purely so two equally-malformed values compare equal.
function canonicalWire(value: FieldValue): string {
  switch (value.kind) {
    case 'color':
      return JSON.stringify(hexToColorDict(value.hex, value.alpha));
    case 'toggle':
      return JSON.stringify(value.on);
    case 'number':
      return JSON.stringify(parseFiniteNumber(value.raw) ?? 0);
    case 'text':
      return JSON.stringify(value.value);
  }
}

// The wire value actually written to iTerm2. Unlike canonicalWire it refuses to encode a malformed
// value — [LAW:no-silent-failure] a guard-bypassing caller gets a thrown error, never silently
// corrupted data. The write boundary (rejectInvalidChanges) pre-checks isEncodableValue and
// surfaces a friendly result before this is ever reached, so the throw is a last-resort invariant.
export function encodeField(value: FieldValue): string {
  if (!isEncodableValue(value)) {
    throw new Error(`unencodable ${value.kind} value: ${JSON.stringify(value)}`);
  }
  return canonicalWire(value);
}

// Two FieldValues are equal iff they project to the same wire string — the single comparison used
// by both diff-vs-default and dirty-tracking, so neither can drift from the other.
export function fieldValueEquals(a: FieldValue, b: FieldValue): boolean {
  return canonicalWire(a) === canonicalWire(b);
}

export function isDefaultValue(spec: ProfileFieldSpec, value: FieldValue): boolean {
  return fieldValueEquals(value, spec.default);
}

export function decodeProfile(
  properties: Record<string, string>,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const spec of PROFILE_FIELDS) {
    out[spec.key] = decodeField(spec, properties[spec.key]);
  }
  return out;
}
