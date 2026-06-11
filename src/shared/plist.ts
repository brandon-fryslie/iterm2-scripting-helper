// Apple XML property lists, as emitted by `defaults export <domain> -`. This is the one parser for
// every surface that reads macOS defaults (arrangements now, preferences/color presets next) —
// plutil's JSON conversion rejects <data> and <date> elements, which real iTerm2 domains contain,
// so the read path owns the full plist value space itself.
//
// [LAW:types-are-the-program] PlistValue is exactly the plist value space: the seven element kinds
// map onto plain JS values (data → Uint8Array, date → Date — both survive Electron's structured
// clone). Nothing is widened to `unknown` and nothing outside the grammar parses.
// [LAW:no-silent-failure] Any input outside the grammar throws PlistParseError with position
// context; there is no lenient mode.

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

// [LAW:single-enforcer] The one predicate that distinguishes a dict node from the other object-typed
// members of the value space (arrays, dates, byte blobs).
export function isPlistDict(value: PlistValue): value is { [key: string]: PlistValue } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

export class PlistParseError extends Error {
  constructor(message: string, pos: number) {
    super(`plist parse error at offset ${pos}: ${message}`);
    this.name = 'PlistParseError';
  }
}

// [FRAMING:representation] The display projection, named as one: where PlistValue is the truth,
// this is what JSON-only consumers (inspect panes, diffs) render. Dates become ISO strings; data
// becomes a `{ $plistData, byteLength, base64 }` object rather than being dropped or stringified
// ambiguously. The shape is a display convention, not a typed discriminant — the projection is
// one-way (rendered and diffed, never un-projected), so a real dict with those keys cannot be
// misinterpreted by any consumer that exists.
export type PlistJson =
  | string
  | number
  | boolean
  | PlistJson[]
  | { [key: string]: PlistJson };

export function plistToJson(value: PlistValue): PlistJson {
  // JSON.stringify would silently turn these into null; keep the plist spelling instead.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return Number.isNaN(value) ? 'nan' : value > 0 ? '+infinity' : '-infinity';
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return {
      $plistData: true,
      byteLength: value.byteLength,
      base64: btoa(binary),
    };
  }
  if (Array.isArray(value)) return value.map(plistToJson);
  if (typeof value === 'object') {
    const out: { [key: string]: PlistJson } = {};
    for (const [k, v] of Object.entries(value)) setOwnProperty(out, k, plistToJson(v));
    return out;
  }
  return value;
}

const REAL_SPECIALS: Record<string, number> = {
  '+infinity': Infinity,
  infinity: Infinity,
  '-infinity': -Infinity,
  nan: NaN,
};

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string, basePos: number): string {
  return text.replace(/&([^;&]*);/g, (whole, body: string, offset: number) => {
    const fail = () => new PlistParseError(`invalid entity ${whole}`, basePos + offset);
    if (body.startsWith('#')) {
      const hex = /^#[xX]([0-9a-fA-F]+)$/.exec(body);
      const dec = /^#([0-9]+)$/.exec(body);
      if (!hex && !dec) throw fail();
      const codePoint = hex ? parseInt(hex[1], 16) : parseInt(dec![1], 10);
      if (codePoint > 0x10ffff) throw fail();
      return String.fromCodePoint(codePoint);
    }
    const named = ENTITIES[body];
    if (named === undefined) throw fail();
    return named;
  });
}

// Plain `out[key] = value` on keys like '__proto__' sets the prototype instead of an own property,
// silently dropping (or worse, inheriting) user-chosen keys — arrangement names are exactly such
// keys. defineProperty always creates an own property.
export function setOwnProperty<T>(target: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): PlistValue {
    this.skipProlog();
    const tag = this.openTag();
    if (tag.name !== 'plist') {
      throw new PlistParseError(`expected <plist>, found <${tag.name}>`, this.pos);
    }
    if (tag.selfClosing) {
      throw new PlistParseError('empty <plist/>', this.pos);
    }
    const value = this.parseValue();
    this.closeTag('plist');
    this.skipInterElement();
    if (this.pos < this.src.length) {
      throw new PlistParseError('trailing content after </plist>', this.pos);
    }
    return value;
  }

  private fail(message: string): never {
    throw new PlistParseError(message, this.pos);
  }

  // XML declaration, DOCTYPE, comments, whitespace — everything before the root element.
  private skipProlog(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.src.startsWith('<?', this.pos)) {
        const end = this.src.indexOf('?>', this.pos);
        if (end === -1) this.fail('unterminated <?...?>');
        this.pos = end + 2;
      } else if (this.src.startsWith('<!--', this.pos)) {
        this.skipComment();
      } else if (this.src.startsWith('<!', this.pos)) {
        const end = this.src.indexOf('>', this.pos);
        if (end === -1) this.fail('unterminated <!...>');
        this.pos = end + 1;
      } else {
        return;
      }
    }
  }

  private skipComment(): void {
    const end = this.src.indexOf('-->', this.pos);
    if (end === -1) this.fail('unterminated comment');
    this.pos = end + 3;
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private skipInterElement(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.src.startsWith('<!--', this.pos)) this.skipComment();
      else return;
    }
  }

  private openTag(): { name: string; selfClosing: boolean } {
    this.skipInterElement();
    if (this.src[this.pos] !== '<') this.fail('expected element');
    const end = this.src.indexOf('>', this.pos);
    if (end === -1) this.fail('unterminated tag');
    let inner = this.src.slice(this.pos + 1, end).trim();
    const selfClosing = inner.endsWith('/');
    if (selfClosing) inner = inner.slice(0, -1).trim();
    // Attributes (e.g. version="1.0" on <plist>) are irrelevant to the value space; drop them.
    const name = inner.split(/\s/, 1)[0];
    if (!name) this.fail('empty tag');
    this.pos = end + 1;
    return { name, selfClosing };
  }

  private closeTag(name: string): void {
    this.skipInterElement();
    const expected = `</${name}>`;
    if (!this.src.startsWith(expected, this.pos)) {
      this.fail(`expected ${expected}`);
    }
    this.pos += expected.length;
  }

  private peekIsCloseTag(name: string): boolean {
    this.skipInterElement();
    return this.src.startsWith(`</${name}>`, this.pos);
  }

  // Scalar elements contain only character data; a nested '<' is outside the plist grammar.
  private textUntilClose(name: string): string {
    const start = this.pos;
    const end = this.src.indexOf(`</${name}>`, this.pos);
    if (end === -1) this.fail(`unterminated <${name}>`);
    const raw = this.src.slice(this.pos, end);
    if (raw.includes('<')) this.fail(`unexpected markup inside <${name}>`);
    this.pos = end + name.length + 3;
    return decodeEntities(raw, start);
  }

  private parseValue(): PlistValue {
    const tag = this.openTag();
    switch (tag.name) {
      case 'true':
        if (!tag.selfClosing) this.closeTag('true');
        return true;
      case 'false':
        if (!tag.selfClosing) this.closeTag('false');
        return false;
      case 'string':
        return tag.selfClosing ? '' : this.textUntilClose('string');
      case 'integer': {
        if (tag.selfClosing) this.fail('empty <integer/>');
        const text = this.textUntilClose('integer').trim();
        if (!/^[+-]?\d+$/.test(text)) this.fail(`invalid integer "${text}"`);
        const value = Number(text);
        // plist integers are 64-bit; silently rounding past 2^53 would be a lie. Fail loudly —
        // no real iTerm2 domain observed carries one, and honesty beats lenience here.
        if (!Number.isSafeInteger(value)) this.fail(`integer "${text}" exceeds safe precision`);
        return value;
      }
      case 'real': {
        if (tag.selfClosing) this.fail('empty <real/>');
        const text = this.textUntilClose('real').trim();
        // CoreFoundation spells the non-finite reals "+infinity"/"-infinity"/"nan" (observed in
        // real `defaults export` output); JS Number() does not accept those spellings.
        const special = REAL_SPECIALS[text.toLowerCase()];
        if (special !== undefined) return special;
        // Number() also accepts hex/binary spellings that are not plist reals; reject them.
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
          this.fail(`invalid real "${text}"`);
        }
        return Number(text);
      }
      case 'date': {
        if (tag.selfClosing) this.fail('empty <date/>');
        const text = this.textUntilClose('date').trim();
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) this.fail(`invalid date "${text}"`);
        return date;
      }
      case 'data': {
        const text = tag.selfClosing ? '' : this.textUntilClose('data');
        const base64 = text.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
          this.fail('invalid base64 in <data>');
        }
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      case 'array': {
        const items: PlistValue[] = [];
        if (tag.selfClosing) return items;
        while (!this.peekIsCloseTag('array')) items.push(this.parseValue());
        this.closeTag('array');
        return items;
      }
      case 'dict': {
        const out: { [key: string]: PlistValue } = {};
        if (tag.selfClosing) return out;
        while (!this.peekIsCloseTag('dict')) {
          const keyTag = this.openTag();
          if (keyTag.name !== 'key') this.fail(`expected <key>, found <${keyTag.name}>`);
          const key = keyTag.selfClosing ? '' : this.textUntilClose('key');
          setOwnProperty(out, key, this.parseValue());
        }
        this.closeTag('dict');
        return out;
      }
      default:
        this.fail(`unknown plist element <${tag.name}>`);
    }
  }
}

export function parsePlist(xml: string): PlistValue {
  return new Parser(xml).parse();
}
