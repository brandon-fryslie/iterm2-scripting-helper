import { create } from '@bufbuild/protobuf';
import {
  ListProfilesRequestSchema,
  SetProfilePropertyRequestSchema,
  SetProfilePropertyRequest_AssignmentSchema,
  SetProfilePropertyRequest_GuidListSchema,
  type SetProfilePropertyRequest,
} from '@shared/proto/gen/api_pb';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';
import type { ProfileSummary, ProfileListResult, ActionResult } from '@shared/rpc';

export const PROFILE_KEYS = {
  name: 'Name',
  backgroundColor: 'Background Color',
  foregroundColor: 'Foreground Color',
  badgeText: 'Badge Text',
  transparency: 'Transparency',
  cursorColor: 'Cursor Color',
  useTransparency: 'Use Transparency',
  normalFont: 'Normal Font',
} as const;

const FETCH_KEYS = Object.values(PROFILE_KEYS);

export async function listProfiles(
  orchestrator: ConnectionOrchestrator,
): Promise<ProfileListResult> {
  const req = create(ListProfilesRequestSchema, {
    properties: [...FETCH_KEYS, 'Guid'],
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
      name: (parseJson(map.get(PROFILE_KEYS.name)) as string | undefined) ?? '(unnamed)',
      properties: Object.fromEntries(map.entries()),
    };
  });
  return { ok: true, profiles };
}

export async function setProfileProperty(
  orchestrator: ConnectionOrchestrator,
  args: {
    guids: string[];
    assignments: Array<{ key: string; jsonValue: string }>;
  },
): Promise<ActionResult> {
  const started = Date.now();
  try {
    const target: SetProfilePropertyRequest['target'] = {
      case: 'guidList',
      value: create(SetProfilePropertyRequest_GuidListSchema, { guids: args.guids }),
    };
    const value = create(SetProfilePropertyRequestSchema, {
      target,
      assignments: args.assignments.map((a) =>
        create(SetProfilePropertyRequest_AssignmentSchema, {
          key: a.key,
          jsonValue: a.jsonValue,
        }),
      ),
    });
    const response = await orchestrator.sendRequest({
      submessage: { case: 'setProfilePropertyRequest', value },
    });
    const latencyMs = Date.now() - started;
    const requestId = response.id.toString();
    if (response.submessage.case === 'error') {
      return {
        ok: false,
        error: response.submessage.value,
        latencyMs,
        responseCase: 'error',
        payload: null,
        requestId,
      };
    }
    if (response.submessage.case !== 'setProfilePropertyResponse') {
      return {
        ok: false,
        error: `unexpected response ${response.submessage.case ?? '<none>'}`,
        latencyMs,
        responseCase: response.submessage.case ?? null,
        payload: null,
        requestId,
      };
    }
    return {
      ok: true,
      error: null,
      latencyMs,
      responseCase: 'setProfilePropertyResponse',
      payload: { status: String(response.submessage.value.status) },
      requestId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      responseCase: null,
      payload: null,
      requestId: null,
    };
  }
}

function parseJson(raw: string | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
