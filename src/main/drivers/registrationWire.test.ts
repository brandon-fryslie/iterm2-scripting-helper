import { describe, it, expect } from 'vitest';
import {
  RPCRegistrationRequest_Role,
  RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type,
  RPCRegistrationRequest_StatusBarComponentAttributes_Format,
  RegisterToolRequest_ToolType,
} from '@shared/proto/gen/api_pb';
import { ROLE_CAPABILITIES, type RegistrationRole } from '@shared/rpc';
import { buildRegistrationRequest, buildToolRequest } from './registrationWire';

const rpcCommon = {
  id: 'reg-1',
  name: 'wb_fn',
  arguments: ['session_id', 'knobs'],
  defaults: [{ name: 'sid', path: 'session.id' }],
  timeout: 7,
  responseTemplate: '"ok"',
};

// [LAW:verifiable-goals] Completeness gate, same idiom as the escape-template suite: every role in
// the catalog must have a wire-construction case here. The Record type already fails the compile
// when a role is missing; the runtime check makes the gap a named test failure too.
const CASES: Record<RegistrationRole, () => void> = {
  generic: () => {
    const req = buildRegistrationRequest({ ...rpcCommon, role: 'generic' });
    expect(req.name).toBe('wb_fn');
    expect(req.arguments.map((a) => a.name)).toEqual(['session_id', 'knobs']);
    expect(req.defaults.map((d) => ({ name: d.name, path: d.path }))).toEqual([
      { name: 'sid', path: 'session.id' },
    ]);
    expect(req.timeout).toBe(7);
    expect(req.role).toBe(RPCRegistrationRequest_Role.GENERIC);
    expect(req.RoleSpecificAttributes.case).toBeUndefined();
  },
  'status-bar': () => {
    const req = buildRegistrationRequest({
      ...rpcCommon,
      role: 'status-bar',
      attrs: {
        shortDescription: 'short',
        detailedDescription: 'detail',
        exemplar: '12:34',
        updateCadence: 5,
        uniqueIdentifier: 'com.example.sb',
        format: 'HTML',
        knobs: [
          {
            name: 'tint',
            type: 'Color',
            placeholder: 'Pick',
            jsonDefaultValue: '{"Red Component":1}',
            key: 'tint',
          },
        ],
      },
    });
    expect(req.role).toBe(RPCRegistrationRequest_Role.STATUS_BAR_COMPONENT);
    expect(req.RoleSpecificAttributes.case).toBe('statusBarComponentAttributes');
    if (req.RoleSpecificAttributes.case !== 'statusBarComponentAttributes') return;
    const sb = req.RoleSpecificAttributes.value;
    expect(sb.shortDescription).toBe('short');
    expect(sb.detailedDescription).toBe('detail');
    expect(sb.exemplar).toBe('12:34');
    expect(sb.updateCadence).toBe(5);
    expect(sb.uniqueIdentifier).toBe('com.example.sb');
    expect(sb.format).toBe(RPCRegistrationRequest_StatusBarComponentAttributes_Format.HTML);
    expect(sb.knobs).toHaveLength(1);
    expect(sb.knobs[0].type).toBe(
      RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.Color,
    );
    expect(sb.knobs[0].jsonDefaultValue).toBe('{"Red Component":1}');
    expect(sb.knobs[0].key).toBe('tint');
  },
  'session-title': () => {
    const req = buildRegistrationRequest({
      ...rpcCommon,
      role: 'session-title',
      attrs: { displayName: 'My title', uniqueIdentifier: 'com.example.title' },
    });
    expect(req.role).toBe(RPCRegistrationRequest_Role.SESSION_TITLE);
    expect(req.RoleSpecificAttributes.case).toBe('sessionTitleAttributes');
    if (req.RoleSpecificAttributes.case !== 'sessionTitleAttributes') return;
    expect(req.RoleSpecificAttributes.value.displayName).toBe('My title');
    expect(req.RoleSpecificAttributes.value.uniqueIdentifier).toBe('com.example.title');
  },
  'context-menu': () => {
    const req = buildRegistrationRequest({
      ...rpcCommon,
      role: 'context-menu',
      attrs: { displayName: 'My item', uniqueIdentifier: 'com.example.menu' },
    });
    expect(req.role).toBe(RPCRegistrationRequest_Role.CONTEXT_MENU);
    expect(req.RoleSpecificAttributes.case).toBe('contextMenuAttributes');
    if (req.RoleSpecificAttributes.case !== 'contextMenuAttributes') return;
    expect(req.RoleSpecificAttributes.value.displayName).toBe('My item');
    expect(req.RoleSpecificAttributes.value.uniqueIdentifier).toBe('com.example.menu');
  },
  toolbelt: () => {
    const req = buildToolRequest({
      displayName: 'My tool',
      identifier: 'com.example.tool',
      url: 'https://example.com/tool',
      revealIfAlreadyRegistered: true,
    });
    expect(req.name).toBe('My tool');
    expect(req.identifier).toBe('com.example.tool');
    expect(req.URL).toBe('https://example.com/tool');
    expect(req.revealIfAlreadyRegistered).toBe(true);
    expect(req.toolType).toBe(RegisterToolRequest_ToolType.WEB_VIEW_TOOL);
  },
};

describe('registration wire construction', () => {
  it('covers every role in the capability catalog', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(ROLE_CAPABILITIES).sort());
  });

  for (const [role, run] of Object.entries(CASES)) {
    it(`encodes ${role}`, run);
  }
});
