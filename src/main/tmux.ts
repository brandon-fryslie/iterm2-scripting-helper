import { create } from '@bufbuild/protobuf';
import { TmuxRequestSchema, TmuxResponse_Status } from '@shared/proto/gen/api_pb';
import type { TmuxConnectionsResult } from '@shared/rpc';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

// The tmux store's read authority: which tmux gateway connections iTerm2 currently knows about. This
// is the read half of the TmuxRequest oneof (the three mutating arms are console actions in actions.ts).
// [LAW:no-silent-failure] Transport, status, and response-shape failures each surface their real cause;
// an empty connection set is reported as ok with [] — "no tmux connections", not a failure.
export async function listTmuxConnections(
  orchestrator: ConnectionOrchestrator,
): Promise<TmuxConnectionsResult> {
  try {
    const response = await orchestrator.sendRequest({
      submessage: {
        case: 'tmuxRequest',
        value: create(TmuxRequestSchema, {
          payload: { case: 'listConnections', value: {} },
        }),
      },
    });
    if (response.submessage.case === 'error') {
      return { ok: false, error: response.submessage.value };
    }
    if (response.submessage.case !== 'tmuxResponse') {
      return {
        ok: false,
        error: `expected tmuxResponse, got ${response.submessage.case ?? '<none>'}`,
      };
    }
    const resp = response.submessage.value;
    if (resp.status !== TmuxResponse_Status.OK) {
      return {
        ok: false,
        error: `iTerm2 refused: ${TmuxResponse_Status[resp.status] ?? resp.status}`,
      };
    }
    if (resp.payload.case !== 'listConnections') {
      return {
        ok: false,
        error: `expected listConnections payload, got ${resp.payload.case ?? '<none>'}`,
      };
    }
    return {
      ok: true,
      connections: resp.payload.value.connections.map((c) => ({
        connectionId: c.connectionId,
        owningSessionId: c.owningSessionId,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
