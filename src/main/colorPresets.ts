import { create } from '@bufbuild/protobuf';
import { ColorPresetRequestSchema, ColorPresetResponse_Status } from '@shared/proto/gen/api_pb';
import type { ColorPresetsResult } from '@shared/rpc';
import type { ConnectionOrchestrator } from './drivers/ConnectionOrchestrator';

// The color-preset store's read authority: which preset names iTerm2 knows. This is the listPresets
// read arm of the ColorPresetRequest oneof (getPreset — reading one preset's colors — is fired by the
// apply action in actions.ts). Mirrors the snapshot readers in arrangements.ts / tmux.ts.
// [LAW:no-silent-failure] Transport, status, and response-shape failures each surface their real
// cause; an empty preset set is reported as ok with [] — "no presets", not a failure.
export async function listColorPresets(
  orchestrator: ConnectionOrchestrator,
): Promise<ColorPresetsResult> {
  try {
    const response = await orchestrator.sendRequest({
      submessage: {
        case: 'colorPresetRequest',
        value: create(ColorPresetRequestSchema, {
          request: { case: 'listPresets', value: {} },
        }),
      },
    });
    if (response.submessage.case === 'error') {
      return { ok: false, error: response.submessage.value };
    }
    if (response.submessage.case !== 'colorPresetResponse') {
      return {
        ok: false,
        error: `expected colorPresetResponse, got ${response.submessage.case ?? '<none>'}`,
      };
    }
    const resp = response.submessage.value;
    if (resp.status !== ColorPresetResponse_Status.OK) {
      return {
        ok: false,
        error: `iTerm2 refused: ${ColorPresetResponse_Status[resp.status] ?? resp.status}`,
      };
    }
    if (resp.response.case !== 'listPresets') {
      return {
        ok: false,
        error: `expected listPresets payload, got ${resp.response.case ?? '<none>'}`,
      };
    }
    return { ok: true, presets: resp.response.value.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
