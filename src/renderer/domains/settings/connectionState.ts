import type { ConnectionSnapshot } from '@shared/rpc';

export type ConnectionStateId = ConnectionSnapshot['state'];

// [LAW:single-enforcer] The one mapping from a connection state to its human label and badge variant.
// Both the Settings connection panel and the shell's live context strip render the same state, so the
// label/colour decision lives here once rather than being copied into each surface where it would drift
// (a state added to ConnectionState forces an update here, and the exhaustive Record makes that update
// non-optional — [LAW:types-are-the-program]).
export const CONNECTION_STATE_LABEL: Record<ConnectionStateId, string> = {
  idle: 'Idle',
  detecting: 'Detecting socket',
  'requesting-cookie': 'Requesting cookie',
  connecting: 'Connecting',
  ready: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Error',
};

export function connectionStateVariant(
  state: ConnectionStateId,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'ready') return 'default';
  if (state === 'error') return 'destructive';
  if (state === 'idle') return 'outline';
  return 'secondary';
}
