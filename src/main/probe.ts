import { VariableResponse_Status } from '@shared/proto/gen/api_pb';

// [LAW:effects-at-boundaries] Pure shaping for the variable probe: turn raw user input into a
// resolvable path (or an explicit rejection), and turn a protocol status into a human reason. The
// orchestrator owns the IO; everything here is a value-in/value-out function the unit tests pin.

// [LAW:types-are-the-program] Three honest evaluation paths, one per shape the input can take: a
// single variable path resolves exactly via VariableRequest.get; an interpolated template (multiple
// \(refs), literal text, or a function call) must round-trip through the probe_eval RPC because
// iTerm2 exposes no interpolated-string eval message; empty input is a contextual rejection. The
// caller dispatches on `kind` exhaustively — no shape leaks past the type.
export type ProbeTarget =
  | { kind: 'path'; path: string }
  | { kind: 'template'; template: string }
  | { kind: 'reject'; reject: string };

// The registered passthrough function the probe invokes to evaluate a full interpolated template.
// One name, shared by the registration (orchestrator) and the invocation builder below, so the two
// sides cannot drift. Namespaced to avoid colliding with any user-authored registration.
export const PROBE_EVAL_FUNCTION = 'iterm2_helper_probe_eval';
export const PROBE_EVAL_ARG = 'value';

// [LAW:dataflow-not-control-flow] Always returns a target value; the caller's probe always runs and
// always returns a result. A rejection is data the caller renders as an error outcome, not a branch
// that skips the operation.
export function normalizeProbeTarget(input: string): ProbeTarget {
  const trimmed = input.trim();
  if (trimmed === '') {
    return {
      kind: 'reject',
      reject: 'Enter a variable path (e.g. session.name) or a \\(template) to evaluate.',
    };
  }
  const inner = unwrapSingleReference(trimmed);
  // A clean single variable path — bare (session.name) or a single full \(session.name) wrap — has
  // no call syntax and no further interpolation, so it resolves exactly via VariableRequest.get.
  if (!inner.includes('\\(') && !inner.includes('(') && !inner.includes(')')) {
    return { kind: 'path', path: inner };
  }
  // Everything else is an expression iTerm2 must interpolate against the scope. If the user already
  // wrote interpolation, send the template as-is; a bare expression (e.g. a function call) is
  // wrapped into one interpolation so iTerm2 evaluates it instead of echoing it as literal text.
  const template = trimmed.includes('\\(') ? trimmed : `\\(${trimmed})`;
  return { kind: 'template', template };
}

// [LAW:effects-at-boundaries] Pure shaping for the template round-trip: embed the interpolated
// template as a double-quoted argument to probe_eval. Only literal double quotes need escaping so
// they don't close the wrapper; the user's \( … ) interpolations pass through for iTerm2 to evaluate
// against the focused scope. The orchestrator owns sending the resulting invocation.
export function buildProbeEvalInvocation(template: string): string {
  const escaped = template.replace(/"/g, '\\"');
  return `${PROBE_EVAL_FUNCTION}(${PROBE_EVAL_ARG}: "${escaped}")`;
}

// A single full-wrap interpolated reference \( … ) names exactly one path, so it is that path with
// iTerm2's interpolation syntax stripped. Anything that is not a clean single wrap is returned
// unchanged so the leftover \( makes normalizeProbeTarget reject it loudly.
function unwrapSingleReference(s: string): string {
  if (!s.startsWith('\\(')) return s;
  let depth = 0;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i === s.length - 1 ? s.slice(2, -1) : s;
      }
    }
  }
  return s;
}

// [LAW:no-silent-failure] Every non-OK status maps to a specific, fixable reason — never a generic
// "failed" — so the probe UI tells the user exactly what to change about the scope or the path.
export function describeVariableStatus(status: VariableResponse_Status): string {
  switch (status) {
    case VariableResponse_Status.OK:
      return 'OK';
    case VariableResponse_Status.SESSION_NOT_FOUND:
      return 'Session not found for this scope — the focused session may have closed.';
    case VariableResponse_Status.TAB_NOT_FOUND:
      return 'Tab not found for this scope — the focused tab may have closed.';
    case VariableResponse_Status.WINDOW_NOT_FOUND:
      return 'Window not found for this scope — the focused window may have closed.';
    case VariableResponse_Status.MISSING_SCOPE:
      return 'No scope was provided for the request.';
    case VariableResponse_Status.INVALID_NAME:
      return 'Invalid variable name for this request.';
    case VariableResponse_Status.MULTI_GET_DISALLOWED:
      return 'Only a single path can be evaluated at a time.';
  }
}
