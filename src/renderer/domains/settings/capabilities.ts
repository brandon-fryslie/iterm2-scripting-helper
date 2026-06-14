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

// [LAW:one-source-of-truth] The protocol version this release was built and tested against. Capability
// claims above describe what this client knows how to drive; a server reporting a newer protocol than
// this is operating outside what we verified, which `protocolDrift` surfaces as an explicit banner.
export const TESTED_PROTOCOL_VERSION = '1.10';

// [LAW:one-source-of-truth] The single numeric-segment comparison both `protocolAtLeast` and
// `protocolDrift` derive from. Returns <0 when a<b, 0 when equal, >0 when a>b. Missing segments are
// zero, so '1' === '1.0' and '1.10' > '1.2' (compared numerically, never lexicographically).
export function compareProtocol(a: string, b: string): number {
  const parts = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function protocolAtLeast(current: string, required: string): boolean {
  if (!current) return false;
  return compareProtocol(current, required) >= 0;
}

// [LAW:types-are-the-program] Drift is a closed three-state fact, not a boolean plus a side-channel
// version string: 'untested' before any handshake reports a version, 'current' when the server is at or
// below what we tested, 'server-newer' (carrying both versions) when the server runs ahead of us.
export type ProtocolDrift =
  | { kind: 'untested' }
  | { kind: 'current' }
  | { kind: 'server-newer'; server: string; tested: string };

export function protocolDrift(server: string, tested: string): ProtocolDrift {
  if (!server) return { kind: 'untested' };
  return compareProtocol(server, tested) > 0
    ? { kind: 'server-newer', server, tested }
    : { kind: 'current' };
}
