import { create } from '@bufbuild/protobuf';
import { ListProfilesRequestSchema } from '@shared/proto/gen/api_pb';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';
import type { ProfileSummary, ProfileListResult } from '@shared/rpc';

export async function listProfiles(
  orchestrator: ConnectionOrchestrator,
): Promise<ProfileListResult> {
  // An empty properties list asks iTerm2 for EVERY profile property — the read-only API-view
  // inspector's whole point is the full raw key space, not a curated subset.
  const req = create(ListProfilesRequestSchema, {
    properties: [],
    guids: [],
  });
  const response = await orchestrator.sendRequest({
    submessage: { case: 'listProfilesRequest', value: req },
  });
  if (response.submessage.case === 'error') {
    return { ok: false, error: response.submessage.value, profiles: [] };
  }
  if (response.submessage.case !== 'listProfilesResponse') {
    return {
      ok: false,
      error: `unexpected response ${response.submessage.case ?? '<none>'}`,
      profiles: [],
    };
  }
  const profiles: ProfileSummary[] = response.submessage.value.profiles.map((p) => {
    const map = new Map<string, string>();
    for (const prop of p.properties) map.set(prop.key, prop.jsonValue);
    const guid = parseJson(map.get('Guid')) ?? '';
    return {
      guid: typeof guid === 'string' ? guid : String(guid ?? ''),
      name: (parseJson(map.get('Name')) as string | undefined) ?? '(unnamed)',
      properties: Object.fromEntries(map.entries()),
    };
  });
  return { ok: true, profiles };
}

function parseJson(raw: string | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
