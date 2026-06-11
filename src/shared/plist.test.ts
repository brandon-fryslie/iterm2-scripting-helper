import { describe, it, expect } from 'vitest';
import { parsePlist, plistToJson, PlistParseError, type PlistValue } from './plist';

// Shaped from real `defaults export com.googlecode.iterm2 -` output: XML declaration, DOCTYPE,
// tab-indented elements, multi-line <data>, ISO <date>.
const REAL_SHAPE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AIFeatureFunctionCalling</key>
\t<true/>
\t<key>AITermAPI</key>
\t<integer>2</integer>
\t<key>SULastCheckTime</key>
\t<date>2026-06-10T05:05:21Z</date>
\t<key>NSOSPLastRootDirectory</key>
\t<data>
\tYWJj
\tZGVm
\t</data>
\t<key>Window Arrangements</key>
\t<dict>
\t\t<key>dev layout</key>
\t\t<array>
\t\t\t<dict>
\t\t\t\t<key>Frame</key>
\t\t\t\t<string>{{0, 0}, {899, 448}}</string>
\t\t\t\t<key>Scale</key>
\t\t\t\t<real>2.5</real>
\t\t\t\t<key>Hidden</key>
\t\t\t\t<false/>
\t\t\t</dict>
\t\t</array>
\t</dict>
</dict>
</plist>
`;

describe('parsePlist', () => {
  it('parses the defaults-export shape end to end', () => {
    const value = parsePlist(REAL_SHAPE) as { [key: string]: PlistValue };
    expect(value['AIFeatureFunctionCalling']).toBe(true);
    expect(value['AITermAPI']).toBe(2);
    expect(value['SULastCheckTime']).toEqual(new Date('2026-06-10T05:05:21Z'));
    expect(value['NSOSPLastRootDirectory']).toEqual(
      new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65, 0x66]),
    );
    const arrangements = value['Window Arrangements'] as { [key: string]: PlistValue };
    const windows = arrangements['dev layout'] as PlistValue[];
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({
      Frame: '{{0, 0}, {899, 448}}',
      Scale: 2.5,
      Hidden: false,
    });
  });

  it('decodes entities in strings and keys', () => {
    const value = parsePlist(
      `<plist version="1.0"><dict><key>a &amp; b</key><string>&lt;x&gt; &#65;&#x42;</string></dict></plist>`,
    );
    expect(value).toEqual({ 'a & b': '<x> AB' });
  });

  it('parses empty collections and empty strings', () => {
    expect(parsePlist('<plist><array/></plist>')).toEqual([]);
    expect(parsePlist('<plist><dict/></plist>')).toEqual({});
    expect(parsePlist('<plist><string></string></plist>')).toBe('');
    expect(parsePlist('<plist><array><string/></array></plist>')).toEqual(['']);
  });

  it('parses negative integers and reals', () => {
    expect(parsePlist('<plist><integer>-7</integer></plist>')).toBe(-7);
    expect(parsePlist('<plist><real>-0.5</real></plist>')).toBe(-0.5);
  });

  // CoreFoundation emits these spellings in real defaults exports.
  it('parses non-finite reals and round-trips them through the JSON projection', () => {
    expect(parsePlist('<plist><real>+infinity</real></plist>')).toBe(Infinity);
    expect(parsePlist('<plist><real>-infinity</real></plist>')).toBe(-Infinity);
    expect(parsePlist('<plist><real>nan</real></plist>')).toBeNaN();
    expect(plistToJson(Infinity)).toBe('+infinity');
    expect(plistToJson(-Infinity)).toBe('-infinity');
    expect(plistToJson(NaN)).toBe('nan');
  });

  it('rejects content outside the plist grammar', () => {
    expect(() => parsePlist('<plist><blob>x</blob></plist>')).toThrow(PlistParseError);
    expect(() => parsePlist('<plist><integer>twelve</integer></plist>')).toThrow(PlistParseError);
    expect(() => parsePlist('<plist><date>not a date</date></plist>')).toThrow(PlistParseError);
    expect(() => parsePlist('<plist><data>!!!</data></plist>')).toThrow(PlistParseError);
    expect(() =>
      parsePlist('<plist><dict><string>no key</string></dict></plist>'),
    ).toThrow(PlistParseError);
    expect(() => parsePlist('<plist><string>x</string></plist>extra')).toThrow(PlistParseError);
    expect(() => parsePlist('not xml at all')).toThrow(PlistParseError);
  });
});

describe('plistToJson', () => {
  it('projects dates and data into explicit JSON markers', () => {
    const json = plistToJson({
      when: new Date('2026-06-10T05:05:21Z'),
      blob: new Uint8Array([0x61, 0x62, 0x63]),
      nested: [{ ok: true }],
    });
    expect(json).toEqual({
      when: '2026-06-10T05:05:21.000Z',
      blob: { $plistData: true, byteLength: 3, base64: 'YWJj' },
      nested: [{ ok: true }],
    });
  });
});
