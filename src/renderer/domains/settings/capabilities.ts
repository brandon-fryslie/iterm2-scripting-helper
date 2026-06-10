export interface Capability {
  id: string;
  label: string;
  description: string;
  minProtocolVersion: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'scripting-api',
    label: 'Scripting API reachable',
    description: 'iTerm2 accepts WebSocket+protobuf clients on the private socket.',
    minProtocolVersion: '0.0',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Subscribe to keystroke, prompt, layout, and variable events.',
    minProtocolVersion: '1.0',
  },
  {
    id: 'custom-control-sequences',
    label: 'Custom control sequences',
    description: 'Emit and subscribe to OSC 1337 Custom= payloads.',
    minProtocolVersion: '1.0',
  },
  {
    id: 'advanced-keystrokes',
    label: 'Advanced keystroke mode',
    description: 'Receive KEY_UP and FLAGS_CHANGED in addition to KEY_DOWN.',
    minProtocolVersion: '1.1',
  },
  {
    id: 'fold-blocks',
    label: 'Foldable output blocks',
    description: 'OSC 1337 Block= + UpdateBlock= sub-commands.',
    minProtocolVersion: '1.10',
  },
];

export function protocolAtLeast(current: string, required: string): boolean {
  if (!current) return false;
  const parts = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(current);
  const b = parts(required);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}
