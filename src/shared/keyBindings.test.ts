import { describe, it, expect } from 'vitest';
import {
  decodeBindingKey,
  formatKeystroke,
  keyActionName,
  encodeKeystrokeFromBrowser,
} from './keyBindings';

describe('decodeBindingKey', () => {
  it('decodes a plain printable key with no modifiers', () => {
    const d = decodeBindingKey('0x61-0x0');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('a');
    expect(d!.modifiers).toEqual([]);
    expect(d!.hexChar).toBe('0x61');
    expect(d!.hexMods).toBe('0x0');
  });

  it('decodes a key with command modifier', () => {
    const d = decodeBindingKey('0x61-0x100000');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('a');
    expect(d!.modifiers).toContain('command');
  });

  it('decodes a key with multiple modifiers', () => {
    const d = decodeBindingKey('0x61-0x120000');
    expect(d).not.toBeNull();
    expect(d!.modifiers).toContain('shift');
    expect(d!.modifiers).toContain('command');
  });

  it('decodes an NSF-key (arrow)', () => {
    const d = decodeBindingKey('0xf700-0x800000');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('↑');
    expect(d!.modifiers).toContain('fn');
  });

  it('decodes F1 key', () => {
    const d = decodeBindingKey('0xf704-0x800000');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('F1');
  });

  it('returns null for invalid format', () => {
    expect(decodeBindingKey('not-a-key')).toBeNull();
    expect(decodeBindingKey('')).toBeNull();
    expect(decodeBindingKey('0x61')).toBeNull();
  });

  it('is case-insensitive', () => {
    const d = decodeBindingKey('0xF700-0x800000');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('↑');
  });
});

describe('formatKeystroke', () => {
  it('formats a bare key', () => {
    const d = decodeBindingKey('0x61-0x0')!;
    expect(formatKeystroke(d)).toBe('a');
  });

  it('formats cmd+a as ⌘a', () => {
    const d = decodeBindingKey('0x61-0x100000')!;
    expect(formatKeystroke(d)).toBe('⌘a');
  });

  it('formats ctrl+opt+shift+cmd correctly', () => {
    // ctrl=0x40000, opt=0x80000, shift=0x20000, cmd=0x100000
    const flags = 0x40000 | 0x80000 | 0x20000 | 0x100000;
    const d = decodeBindingKey(`0x61-0x${flags.toString(16)}`)!;
    // Order: control, option, shift, command
    expect(formatKeystroke(d)).toBe('⌃⌥⇧⌘a');
  });
});

describe('keyActionName', () => {
  it('returns a name for known actions', () => {
    expect(keyActionName(9)).toBe('Send Text');
    expect(keyActionName(0)).toBe('Ignore');
    expect(keyActionName(11)).toBe('Toggle Fullscreen');
  });

  it('returns a fallback for unknown action numbers', () => {
    expect(keyActionName(999)).toBe('Action #999');
  });
});

describe('encodeKeystrokeFromBrowser', () => {
  it('encodes a printable key with cmd', () => {
    const result = encodeKeystrokeFromBrowser({
      key: 'a',
      code: 'KeyA',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: true,
    });
    expect(result).not.toBeNull();
    expect(result!.encoded).toBe('0x61-0x100000');
    expect(result!.decoded.key).toBe('a');
    expect(result!.decoded.modifiers).toContain('command');
  });

  it('encodes an arrow key', () => {
    const result = encodeKeystrokeFromBrowser({
      key: 'ArrowUp',
      code: 'ArrowUp',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(result).not.toBeNull();
    expect(result!.decoded.key).toBe('↑');
    expect(result!.decoded.modifiers).toContain('fn');
  });

  it('encodes Escape', () => {
    const result = encodeKeystrokeFromBrowser({
      key: 'Escape',
      code: 'Escape',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(result).not.toBeNull();
    expect(result!.decoded.key).toBe('Escape');
  });

  it('returns null for unrecognized keys (e.g. modifier-only event)', () => {
    const result = encodeKeystrokeFromBrowser({
      key: 'Meta',
      code: 'MetaLeft',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: true,
    });
    expect(result).toBeNull();
  });
});
