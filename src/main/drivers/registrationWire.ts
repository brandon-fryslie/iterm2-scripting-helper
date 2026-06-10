import { create } from '@bufbuild/protobuf';
import {
  RPCRegistrationRequestSchema,
  RPCRegistrationRequest_RPCArgumentSignatureSchema,
  RPCRegistrationRequest_RPCArgumentSchema,
  RPCRegistrationRequest_StatusBarComponentAttributesSchema,
  RPCRegistrationRequest_StatusBarComponentAttributes_KnobSchema,
  RPCRegistrationRequest_SessionTitleAttributesSchema,
  RPCRegistrationRequest_ContextMenuAttributesSchema,
  RPCRegistrationRequest_Role,
  RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type,
  RPCRegistrationRequest_StatusBarComponentAttributes_Format,
  RegisterToolRequestSchema,
  RegisterToolRequest_ToolType,
  type RPCRegistrationRequest,
  type RegisterToolRequest,
} from '@shared/proto/gen/api_pb';
import type {
  RpcRegistrationSpec,
  StatusBarAttrs,
  ToolbeltAttrs,
} from '@shared/rpc';

// [LAW:decomposition] The single translation seam from a registration spec to its iTerm2 wire
// message. The orchestrator owns sending; this module owns shape — so every role's encoding is a
// pure, unit-testable function of the spec.

// [LAW:types-are-the-program] RpcRegistrationSpec excludes the toolbelt arm, so a toolbelt spec can
// never reach the RPC-registration encoding — toolbelt tools register through buildToolRequest's
// distinct client-originated message, not a notification subscription.
export function buildRegistrationRequest(
  spec: RpcRegistrationSpec,
): RPCRegistrationRequest {
  const roleMap = {
    generic: RPCRegistrationRequest_Role.GENERIC,
    'session-title': RPCRegistrationRequest_Role.SESSION_TITLE,
    'status-bar': RPCRegistrationRequest_Role.STATUS_BAR_COMPONENT,
    'context-menu': RPCRegistrationRequest_Role.CONTEXT_MENU,
  } as const;

  return create(RPCRegistrationRequestSchema, {
    name: spec.name,
    arguments: spec.arguments.map((name) =>
      create(RPCRegistrationRequest_RPCArgumentSignatureSchema, { name }),
    ),
    defaults: spec.defaults.map((d) =>
      create(RPCRegistrationRequest_RPCArgumentSchema, { name: d.name, path: d.path }),
    ),
    timeout: spec.timeout,
    role: roleMap[spec.role],
    ...(buildRoleAttrs(spec) ?? {}),
  });
}

export function buildToolRequest(attrs: ToolbeltAttrs): RegisterToolRequest {
  return create(RegisterToolRequestSchema, {
    name: attrs.displayName,
    identifier: attrs.identifier,
    URL: attrs.url,
    revealIfAlreadyRegistered: attrs.revealIfAlreadyRegistered,
    toolType: RegisterToolRequest_ToolType.WEB_VIEW_TOOL,
  });
}

type RegistrationRequestInit = Parameters<
  typeof create<typeof RPCRegistrationRequestSchema>
>[1];

// Exhaustive over the RPC roles: each role's required attrs map onto its oneof case, and 'generic'
// genuinely has none. There is no fall-through arm that silently drops attributes.
function buildRoleAttrs(spec: RpcRegistrationSpec): RegistrationRequestInit | undefined {
  switch (spec.role) {
    case 'generic':
      return undefined;
    case 'status-bar':
      return {
        RoleSpecificAttributes: {
          case: 'statusBarComponentAttributes',
          value: buildStatusBarAttrs(spec.attrs),
        },
      };
    case 'session-title':
      return {
        RoleSpecificAttributes: {
          case: 'sessionTitleAttributes',
          value: create(RPCRegistrationRequest_SessionTitleAttributesSchema, {
            displayName: spec.attrs.displayName,
            uniqueIdentifier: spec.attrs.uniqueIdentifier,
          }),
        },
      };
    case 'context-menu':
      return {
        RoleSpecificAttributes: {
          case: 'contextMenuAttributes',
          value: create(RPCRegistrationRequest_ContextMenuAttributesSchema, {
            displayName: spec.attrs.displayName,
            uniqueIdentifier: spec.attrs.uniqueIdentifier,
          }),
        },
      };
  }
}

function buildStatusBarAttrs(sb: StatusBarAttrs) {
  const knobTypeMap = {
    Checkbox: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.Checkbox,
    String: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.String,
    PositiveFloatingPoint:
      RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.PositiveFloatingPoint,
    Color: RPCRegistrationRequest_StatusBarComponentAttributes_Knob_Type.Color,
  } as const;
  return create(RPCRegistrationRequest_StatusBarComponentAttributesSchema, {
    shortDescription: sb.shortDescription,
    detailedDescription: sb.detailedDescription,
    exemplar: sb.exemplar,
    updateCadence: sb.updateCadence,
    uniqueIdentifier: sb.uniqueIdentifier,
    format:
      sb.format === 'HTML'
        ? RPCRegistrationRequest_StatusBarComponentAttributes_Format.HTML
        : RPCRegistrationRequest_StatusBarComponentAttributes_Format.PLAIN_TEXT,
    knobs: sb.knobs.map((k) =>
      create(RPCRegistrationRequest_StatusBarComponentAttributes_KnobSchema, {
        name: k.name,
        type: knobTypeMap[k.type],
        placeholder: k.placeholder,
        jsonDefaultValue: k.jsonDefaultValue,
        key: k.key,
      }),
    ),
  });
}
