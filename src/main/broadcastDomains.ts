import { create } from '@bufbuild/protobuf';
import { GetBroadcastDomainsRequestSchema } from '@shared/proto/gen/api_pb';
import type { BroadcastDomainsResult } from '@shared/rpc';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

// Engine truth for the broadcast table: the GET verb of the same wire surface the SET action
// writes through, so what the editor shows is exactly what iTerm2 will replace.
export async function getBroadcastDomains(
  orchestrator: ConnectionOrchestrator,
): Promise<BroadcastDomainsResult> {
  try {
    const response = await orchestrator.sendRequest({
      submessage: {
        case: 'getBroadcastDomainsRequest',
        value: create(GetBroadcastDomainsRequestSchema, {}),
      },
    });
    if (response.submessage.case === 'error') {
      return { ok: false, error: response.submessage.value };
    }
    if (response.submessage.case !== 'getBroadcastDomainsResponse') {
      return {
        ok: false,
        error: `expected getBroadcastDomainsResponse, got ${response.submessage.case ?? '<none>'}`,
      };
    }
    return {
      ok: true,
      domains: response.submessage.value.broadcastDomains.map((d) => [...d.sessionIds]),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
