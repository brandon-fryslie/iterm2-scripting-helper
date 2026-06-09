import { VariableResponse_Status } from '@shared/proto/gen/api_pb';

// [LAW:effects-at-boundaries] Pure shaping for the variable probe: turn raw user input into a
// resolvable path (or an explicit rejection), and turn a protocol status into a human reason. The
// orchestrator owns the IO; everything here is a value-in/value-out function the unit tests pin.

export type ProbeTarget = { path: string } | { reject: string };

// [LAW:dataflow-not-control-flow] Always returns a target value; the caller's probe always runs and
// always returns a result. A rejection is data the caller renders as an error outcome, not a branch
// that skips the operation.
export function normalizeProbeTarget(input: string): ProbeTarget {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { reject: 'Enter a variable path (e.g. session.name) or a \\(reference) to evaluate.' };
  }
  const inner = unwrapSingleReference(trimmed);
  if (inner.includes('\\(')) {
    return {
      reject:
        'Multi-reference interpolated templates are not supported yet. Probe one variable path, ' +
        'e.g. session.name or \\(session.name).',
    };
  }
  if (inner.includes('(') || inner.includes(')')) {
    return {
      reject:
        'Function-call expressions are not supported. Probe a variable path, e.g. session.name.',
    };
  }
  return { path: inner };
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
