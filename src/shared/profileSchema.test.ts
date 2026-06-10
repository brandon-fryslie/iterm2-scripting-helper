import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIELDS,
  PROFILE_CATEGORIES,
  FETCH_KEYS,
  decodeField,
  encodeField,
  decodeProfile,
  isDefaultValue,
  fieldValueEquals,
  hexToColorDict,
  colorDictToHex,
  fieldsByCategory,
  isHexColor,
  isEncodableValue,
  type ProfileFieldSpec,
} from './profileSchema';

function spec(key: string): ProfileFieldSpec {
  const s = PROFILE_FIELDS.find((f) => f.key === key);
  if (!s) throw new Error(`missing spec ${key}`);
  return s;
}

describe('schema integrity', () => {
  it('every field has a known category and matching default kind', () => {
    for (const f of PROFILE_FIELDS) {
      expect(PROFILE_CATEGORIES, f.key).toContain(f.category);
      expect(f.default.kind, f.key).toBe(f.kind);
    }
  });

  it('every category in the canonical set is represented', () => {
    for (const c of PROFILE_CATEGORIES) {
      expect(fieldsByCategory(c).length, c).toBeGreaterThan(0);
    }
  });

  it('fetches the full editable surface plus Guid', () => {
    expect(FETCH_KEYS).toContain('Guid');
    for (const f of PROFILE_FIELDS) expect(FETCH_KEYS).toContain(f.key);
  });

  it('exposes the canonical iTerm2 keys the prior editor wrote', () => {
    for (const key of [
      'Name',
      'Background Color',
      'Foreground Color',
      'Badge Text',
      'Transparency',
      'Use Transparency',
    ]) {
      expect(PROFILE_FIELDS.map((f) => f.key)).toContain(key);
    }
  });
});

describe('color codec', () => {
  it('round-trips hex through the iTerm2 component dict', () => {
    const dict = hexToColorDict('#3366cc', 1);
    expect(colorDictToHex(dict as unknown as Record<string, unknown>)).toBe('#3366cc');
  });

  it('produces the exact RGB-dict shape iTerm2 expects', () => {
    // This is the wire value the live color-write depends on; pin its shape.
    expect(hexToColorDict('#ff0000', 1)).toEqual({
      'Red Component': 1,
      'Green Component': 0,
      'Blue Component': 0,
      'Alpha Component': 1,
      'Color Space': 'sRGB',
    });
  });

  it('decodes a profile color property into the editor hex', () => {
    const bg = spec('Background Color');
    const raw = JSON.stringify({
      'Red Component': 0.5,
      'Green Component': 0,
      'Blue Component': 0,
      'Alpha Component': 1,
      'Color Space': 'sRGB',
    });
    const v = decodeField(bg, raw);
    expect(v.kind).toBe('color');
    if (v.kind === 'color') expect(v.hex).toBe('#800000');
  });
});

describe('decode/encode round-trip', () => {
  it('toggle', () => {
    const s = spec('Use Bold Font');
    expect(encodeField(decodeField(s, 'false'))).toBe('false');
    expect(encodeField(decodeField(s, 'true'))).toBe('true');
  });

  it('number', () => {
    const s = spec('Scrollback Lines');
    expect(encodeField(decodeField(s, '5000'))).toBe('5000');
  });

  it('text', () => {
    const s = spec('Name');
    expect(encodeField(decodeField(s, JSON.stringify('My Profile')))).toBe('"My Profile"');
  });

  it('falls back to the default when a property is absent', () => {
    const s = spec('Transparency');
    expect(decodeField(s, undefined)).toEqual(s.default);
  });
});

describe('diff-vs-default', () => {
  it('reports a field at its default as not modified', () => {
    const s = spec('Use Bold Font');
    expect(isDefaultValue(s, s.default)).toBe(true);
  });

  it('reports a changed field as modified', () => {
    const s = spec('Transparency');
    const changed = { kind: 'number', raw: '0.3' } as const;
    expect(isDefaultValue(s, changed)).toBe(false);
  });

  it('equality is by encoded wire value', () => {
    expect(
      fieldValueEquals({ kind: 'number', raw: '1' }, { kind: 'number', raw: '1.0' }),
    ).toBe(true);
  });
});

describe('encodability guard', () => {
  it('accepts well-formed hex, rejects malformed', () => {
    expect(isHexColor('#3366cc')).toBe(true);
    expect(isHexColor('3366cc')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('not-a-color')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });

  it('treats only a malformed color value as unencodable', () => {
    expect(isEncodableValue({ kind: 'color', hex: '#123456', alpha: 1 })).toBe(true);
    expect(isEncodableValue({ kind: 'color', hex: 'zzz', alpha: 1 })).toBe(false);
    expect(isEncodableValue({ kind: 'text', value: 'anything' })).toBe(true);
    expect(isEncodableValue({ kind: 'number', raw: '12' })).toBe(true);
    expect(isEncodableValue({ kind: 'toggle', on: true })).toBe(true);
  });
});

describe('decodeProfile', () => {
  it('decodes every schema key, using defaults for missing ones', () => {
    const decoded = decodeProfile({});
    expect(Object.keys(decoded).length).toBe(PROFILE_FIELDS.length);
    for (const f of PROFILE_FIELDS) {
      expect(decoded[f.key], f.key).toEqual(f.default);
    }
  });
});
