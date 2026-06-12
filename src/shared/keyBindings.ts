// Pure decode/encode for iTerm2's key-binding representation.
//
// iTerm2 stores global key bindings in the com.googlecode.iterm2 defaults domain under
// GlobalKeyMap. Each entry key is "<hexChar>-<hexModifiers>" where hexChar is the Unicode
// code point (or NSF-key code for special keys) and hexModifiers is the NSEventModifierFlags
// bitmask iTerm2 writes when the user records a binding.
//
// This module is the one place that understands that encoding, so inspectors and encoders
// share a single decoder and cannot drift. [LAW:single-enforcer]

// NSEventModifierFlags bits observed in real GlobalKeyMap entries.
export const MODIFIER_BITS = {
  capsLock: 0x10000,
  shift: 0x20000,
  control: 0x40000,
  option: 0x80000,
  command: 0x100000,
  numPad: 0x200000,
  help: 0x400000,
  fn: 0x800000,
} as const;

export type ModifierName = keyof typeof MODIFIER_BITS;

// NSF-key code points (Unicode private-use block 0xF700–0xF8FF) as iTerm2 uses them.
const NSF_KEY_NAMES: Record<number, string> = {
  0xf700: '↑',
  0xf701: '↓',
  0xf702: '←',
  0xf703: '→',
  0xf704: 'F1',
  0xf705: 'F2',
  0xf706: 'F3',
  0xf707: 'F4',
  0xf708: 'F5',
  0xf709: 'F6',
  0xf70a: 'F7',
  0xf70b: 'F8',
  0xf70c: 'F9',
  0xf70d: 'F10',
  0xf70e: 'F11',
  0xf70f: 'F12',
  0xf710: 'F13',
  0xf711: 'F14',
  0xf712: 'F15',
  0xf713: 'F16',
  0xf714: 'F17',
  0xf715: 'F18',
  0xf716: 'F19',
  0xf717: 'F20',
  0xf726: 'F35',
  0xf727: 'Insert',
  0xf728: 'Delete→',
  0xf729: 'Home',
  0xf72b: 'End',
  0xf72c: 'PageUp',
  0xf72d: 'PageDown',
  0xf72f: 'ScrollLock',
  0xf730: 'Pause',
  0xf731: 'SysReq',
  0xf732: 'Break',
  0xf733: 'Reset',
};

// Well-known control-character code points.
const CONTROL_CHAR_NAMES: Record<number, string> = {
  0x00: 'NUL',
  0x01: 'SOH (^A)',
  0x02: 'STX (^B)',
  0x03: 'ETX (^C)',
  0x04: 'EOT (^D)',
  0x05: 'ENQ (^E)',
  0x06: 'ACK (^F)',
  0x07: 'BEL (^G)',
  0x08: 'BS (^H)',
  0x09: 'Tab',
  0x0a: 'LF (^J)',
  0x0b: 'VT (^K)',
  0x0c: 'FF (^L)',
  0x0d: 'Return',
  0x0e: 'SO (^N)',
  0x0f: 'SI (^O)',
  0x10: 'DLE (^P)',
  0x11: 'DC1 (^Q)',
  0x12: 'DC2 (^R)',
  0x13: 'DC3 (^S)',
  0x14: 'DC4 (^T)',
  0x15: 'NAK (^U)',
  0x16: 'SYN (^V)',
  0x17: 'ETB (^W)',
  0x18: 'CAN (^X)',
  0x19: 'EM (^Y)',
  0x1a: 'SUB (^Z)',
  0x1b: 'Escape',
  0x1c: 'FS',
  0x1d: 'GS',
  0x1e: 'RS',
  0x1f: 'US',
  0x20: 'Space',
  0x7f: '⌫ (Backspace)',
};

// [LAW:types-are-the-program] Every binding key parses into this — never a string bag.
export interface DecodedKeystroke {
  // The readable key label (e.g. "a", "F1", "Tab", "↑").
  key: string;
  // Active modifier names, ordered from outermost to innermost as iTerm2 displays them.
  modifiers: ModifierName[];
  // The raw hex char code (for reference/export).
  hexChar: string;
  // The raw hex modifier flags (for reference/export).
  hexMods: string;
}

// Parse a raw GlobalKeyMap key string into its components.
export function decodeBindingKey(raw: string): DecodedKeystroke | null {
  const match = /^(0x[0-9a-f]+)-(0x[0-9a-f]+)$/i.exec(raw.trim());
  if (!match) return null;
  const charCode = parseInt(match[1], 16);
  const modFlags = parseInt(match[2], 16);
  const key = decodeCharCode(charCode);
  const modifiers = decodeModifierFlags(modFlags);
  return { key, modifiers, hexChar: match[1].toLowerCase(), hexMods: match[2].toLowerCase() };
}

function decodeCharCode(code: number): string {
  if (NSF_KEY_NAMES[code] !== undefined) return NSF_KEY_NAMES[code];
  if (CONTROL_CHAR_NAMES[code] !== undefined) return CONTROL_CHAR_NAMES[code];
  if (code >= 0x20 && code < 0x7f) return String.fromCodePoint(code);
  if (code >= 0xf700 && code <= 0xf8ff) return `NSF-0x${code.toString(16)}`;
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Ordered by visual convention: ctrl < opt < shift < cmd (innermost modifier last).
const MODIFIER_ORDER: ModifierName[] = ['control', 'option', 'shift', 'command', 'fn', 'numPad', 'capsLock', 'help'];

function decodeModifierFlags(flags: number): ModifierName[] {
  return MODIFIER_ORDER.filter((name) => flags & MODIFIER_BITS[name]);
}

// Render a decoded keystroke as a human-readable string (e.g. "⌘⇧A", "⌃⌥F1").
const MODIFIER_SYMBOLS: Record<ModifierName, string> = {
  control: '⌃',
  option: '⌥',
  shift: '⇧',
  command: '⌘',
  fn: 'fn',
  numPad: '⌨',
  capsLock: '⇪',
  help: '?',
};

export function formatKeystroke(decoded: DecodedKeystroke): string {
  return decoded.modifiers.map((m) => MODIFIER_SYMBOLS[m]).join('') + decoded.key;
}

// iTerm2 key action integers → readable names.
// Source: iTerm2 source Key.h / iTermKeyBindingMgr.m KEY_ACTION enum.
export const KEY_ACTION_NAMES: Record<number, string> = {
  0: 'Ignore',
  1: 'Next Session',
  2: 'Next Window',
  3: 'Previous Session',
  4: 'Previous Window',
  5: 'Scroll to End',
  6: 'Scroll to Top',
  7: 'Scroll Up',
  8: 'Scroll Down',
  9: 'Send Text',
  10: 'Run Coprocess',
  11: 'Toggle Fullscreen',
  12: 'Select Menu Item',
  13: 'Send Escape Sequence',
  14: 'Send Hex Codes',
  15: 'Send Text with "vim" Special Chars',
  16: 'Do Not Remap Modifiers',
  17: 'Toggle Mouse Reporting',
  18: 'Run Silent Coprocess',
  19: 'Paste Special From Selection',
  20: 'Paste Special From Clipboard',
  21: 'Paste Special (Deprecated)',
  22: 'New Window with Profile',
  23: 'New Tab with Profile',
  24: 'Next Tab',
  25: 'Previous Tab',
  26: 'Next Pane',
  27: 'Previous Pane',
  28: 'Split Vertically with Profile',
  29: 'Split Horizontally with Profile',
  30: 'Load URL in Background',
  31: 'Swap Pane Left',
  32: 'Swap Pane Right',
  33: 'Swap Pane Above',
  34: 'Swap Pane Below',
  35: 'Select Pane Left',
  36: 'Select Pane Right',
  37: 'Select Pane Above',
  38: 'Select Pane Below',
  39: 'Remap Modifiers in iTerm2',
  40: 'Move to Split Pane',
  41: 'Find Regex',
  42: 'End of Line',
  43: 'Beginning of Line',
  44: 'Backward Word',
  45: 'Forward Word',
  46: 'Backward Delete Word',
  47: 'Undo',
  48: 'Alert on Next Mark',
  49: 'Toggle Hotkey Window Pinned',
  50: 'Cycle Tabs Forward',
  51: 'Duplicate Tab',
  52: 'Move to Split Pane',
  53: 'Invoke Script Function',
};

export function keyActionName(action: number): string {
  return KEY_ACTION_NAMES[action] ?? `Action #${action}`;
}

// Map a browser KeyboardEvent to an iTerm2 GlobalKeyMap encoding.
// Best-effort: browser events lose some macOS specifics (key vs keyCode diverges in edge cases).
export function encodeKeystrokeFromBrowser(e: {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): { encoded: string; decoded: DecodedKeystroke } | null {
  const charCode = browserKeyToCharCode(e.key, e.code);
  if (charCode === null) return null;

  let modFlags = 0;
  if (e.ctrlKey) modFlags |= MODIFIER_BITS.control;
  if (e.altKey) modFlags |= MODIFIER_BITS.option;
  if (e.shiftKey && charCode >= 0xf700) modFlags |= MODIFIER_BITS.shift; // only flag shift for special keys
  if (e.metaKey) modFlags |= MODIFIER_BITS.command;
  if (charCode >= 0xf700) modFlags |= MODIFIER_BITS.fn; // function/special keys always have fn

  const hexChar = `0x${charCode.toString(16)}`;
  const hexMods = `0x${modFlags.toString(16)}`;
  const encoded = `${hexChar}-${hexMods}`;
  const decoded = decodeBindingKey(encoded);
  if (!decoded) return null;
  return { encoded, decoded };
}

function browserKeyToCharCode(key: string, code: string): number | null {
  // Single printable character: use the code point (unshifted char is the binding key).
  if (key.length === 1) return key.codePointAt(0) ?? null;

  // Named special keys.
  const specialMap: Record<string, number> = {
    ArrowUp: 0xf700,
    ArrowDown: 0xf701,
    ArrowLeft: 0xf702,
    ArrowRight: 0xf703,
    F1: 0xf704,
    F2: 0xf705,
    F3: 0xf706,
    F4: 0xf707,
    F5: 0xf708,
    F6: 0xf709,
    F7: 0xf70a,
    F8: 0xf70b,
    F9: 0xf70c,
    F10: 0xf70d,
    F11: 0xf70e,
    F12: 0xf70f,
    F13: 0xf710,
    F14: 0xf711,
    F15: 0xf712,
    F16: 0xf713,
    F17: 0xf714,
    F18: 0xf715,
    F19: 0xf716,
    F20: 0xf717,
    Delete: 0xf728,
    Home: 0xf729,
    End: 0xf72b,
    PageUp: 0xf72c,
    PageDown: 0xf72d,
    Insert: 0xf727,
    Escape: 0x1b,
    Tab: 0x09,
    Enter: 0x0d,
    Backspace: 0x7f,
    ' ': 0x20,
  };
  return specialMap[key] ?? null;
}
