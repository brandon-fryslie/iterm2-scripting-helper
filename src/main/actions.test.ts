import { describe, it, expect, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  ServerOriginatedMessageSchema,
  ColorPresetResponse_Status,
  SetProfilePropertyResponse_Status,
} from '@shared/proto/gen/api_pb';
import { actionGetPreference, actionApplyColorPreset } from './actions';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

// A fake orchestrator: each sendRequest returns the next queued ServerOriginatedMessage and records
// the envelope it was given, so a test can assert exactly what crossed the wire.
function fakeOrchestrator(responses: ReturnType<typeof create>[]) {
  let i = 0;
  const sendRequest = vi.fn(async (envelope: unknown) => {
    const r = responses[i++];
    if (!r) throw new Error('no queued response');
    return r;
  });
  return { sendRequest } as unknown as ConnectionOrchestrator & {
    sendRequest: ReturnType<typeof vi.fn>;
  };
}

describe('actionGetPreference', () => {
  it('returns the raw jsonValue for the key', async () => {
    const o = fakeOrchestrator([
      create(ServerOriginatedMessageSchema, {
        id: 7n,
        submessage: {
          case: 'preferencesResponse',
          value: { results: [{ result: { case: 'getPreferenceResult', value: { jsonValue: '"YES"' } } }] },
        },
      }),
    ]);

    const result = await actionGetPreference(o, { key: 'PromptOnQuit' });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ key: 'PromptOnQuit', jsonValue: '"YES"' });
    const envelope = o.sendRequest.mock.calls[0][0] as any;
    expect(envelope.submessage.value.requests[0].request.value.key).toBe('PromptOnQuit');
  });

  it('treats an empty jsonValue (no value set) as success, not failure', async () => {
    const o = fakeOrchestrator([
      create(ServerOriginatedMessageSchema, {
        id: 1n,
        submessage: {
          case: 'preferencesResponse',
          value: { results: [{ result: { case: 'getPreferenceResult', value: { jsonValue: '' } } }] },
        },
      }),
    ]);

    const result = await actionGetPreference(o, { key: 'NeverSet' });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ key: 'NeverSet', jsonValue: '' });
  });

  it('fails loudly when iTerm2 returns a non-getPreference result (unrecognized request)', async () => {
    const o = fakeOrchestrator([
      create(ServerOriginatedMessageSchema, {
        id: 2n,
        submessage: {
          case: 'preferencesResponse',
          value: { results: [{ result: { case: 'unrecognizedRequest', value: {} } }] },
        },
      }),
    ]);

    const result = await actionGetPreference(o, { key: 'k' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('unrecognizedRequest');
    // An error result carries no payload — the same invariant every failure path in actions.ts keeps.
    expect(result.payload).toBeNull();
  });

  it('requires a key before touching the wire', async () => {
    const o = fakeOrchestrator([]);
    const result = await actionGetPreference(o, { key: '' });
    expect(result.ok).toBe(false);
    expect(o.sendRequest).not.toHaveBeenCalled();
  });
});

describe('actionApplyColorPreset', () => {
  function getPresetOk(colorSettings: Array<Record<string, unknown>>) {
    return create(ServerOriginatedMessageSchema, {
      id: 10n,
      submessage: {
        case: 'colorPresetResponse',
        value: { status: ColorPresetResponse_Status.OK, response: { case: 'getPreset', value: { colorSettings } } },
      },
    });
  }

  it('reads the preset then writes its colors to every guid as profile assignments', async () => {
    const o = fakeOrchestrator([
      getPresetOk([
        { key: 'Background Color', red: 0, green: 0, blue: 0, alpha: 1, colorSpace: 'sRGB' },
        { key: 'Foreground Color', red: 1, green: 1, blue: 1, alpha: 1, colorSpace: 'sRGB' },
      ]),
      create(ServerOriginatedMessageSchema, {
        id: 11n,
        submessage: { case: 'setProfilePropertyResponse', value: { status: SetProfilePropertyResponse_Status.OK } },
      }),
    ]);

    const result = await actionApplyColorPreset(o, { presetName: 'Solarized', guids: ['g1', 'g2'] });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ presetName: 'Solarized', profileCount: 2, colorCount: 2 });
    // requestId is the mutation's id (the write is the action's effect on the wire), not the read's.
    expect(result.requestId).toBe('11');

    const readEnv = o.sendRequest.mock.calls[0][0] as any;
    expect(readEnv.submessage.case).toBe('colorPresetRequest');
    expect(readEnv.submessage.value.request.value.name).toBe('Solarized');

    const writeEnv = o.sendRequest.mock.calls[1][0] as any;
    expect(writeEnv.submessage.case).toBe('setProfilePropertyRequest');
    expect(writeEnv.submessage.value.target.case).toBe('guidList');
    expect(writeEnv.submessage.value.target.value.guids).toEqual(['g1', 'g2']);
    const assignments = writeEnv.submessage.value.assignments;
    expect(assignments[0].key).toBe('Background Color');
    expect(JSON.parse(assignments[0].jsonValue)).toEqual({
      'Red Component': 0,
      'Green Component': 0,
      'Blue Component': 0,
      'Alpha Component': 1,
      'Color Space': 'sRGB',
    });
  });

  it('stops at the read — never writes — when the preset is not found', async () => {
    const o = fakeOrchestrator([
      create(ServerOriginatedMessageSchema, {
        id: 20n,
        submessage: {
          case: 'colorPresetResponse',
          value: { status: ColorPresetResponse_Status.PRESET_NOT_FOUND, response: { case: undefined } },
        },
      }),
    ]);

    const result = await actionApplyColorPreset(o, { presetName: 'Missing', guids: ['g1'] });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('PRESET_NOT_FOUND');
    expect(o.sendRequest).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the profile write is refused (bad guid)', async () => {
    const o = fakeOrchestrator([
      getPresetOk([{ key: 'Background Color', red: 0, green: 0, blue: 0, alpha: 1, colorSpace: 'sRGB' }]),
      create(ServerOriginatedMessageSchema, {
        id: 31n,
        submessage: { case: 'setProfilePropertyResponse', value: { status: SetProfilePropertyResponse_Status.BAD_GUID } },
      }),
    ]);

    const result = await actionApplyColorPreset(o, { presetName: 'X', guids: ['nope'] });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('BAD_GUID');
  });

  it('requires a preset name and at least one guid before touching the wire', async () => {
    const o = fakeOrchestrator([]);

    const noName = await actionApplyColorPreset(o, { presetName: '', guids: ['g1'] });
    const noGuid = await actionApplyColorPreset(o, { presetName: 'X', guids: [] });

    expect(noName.ok).toBe(false);
    expect(noGuid.ok).toBe(false);
    expect(o.sendRequest).not.toHaveBeenCalled();
  });
});
