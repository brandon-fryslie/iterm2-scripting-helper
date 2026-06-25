import type { AppProbeResult } from './domain';
import { ESC, BEL, osc1337, base64Utf8 } from './escape-sequences';

// [LAW:decomposition] The Live Template Designer's pure core: everything that turns an authored
// interpolated-string template into a preview and an apply escape, with ZERO IO. The two effects the
// feature needs already exist as boundaries — `monitor/probe-variable` evaluates the template (the one
// interpolation seam) and `actions/inject` delivers the apply bytes — so this module never re-evaluates
// a template itself ([LAW:one-source-of-truth]) and never touches the world ([LAW:effects-at-boundaries]).

// [LAW:no-mode-explosion] The closed set of apply targets. Status-bar components are deliberately
// excluded: iTerm2 has no escape that sets a status-bar component's value (they are profile-configured),
// so claiming to apply one would be a silent lie ([LAW:no-silent-failure]). The previewed format IS
// exactly what a status-bar "Interpolated String" component would render, so authoring still serves
// that case — only the one-shot apply is scoped to the escape-injectable targets. Exit plan: a future
// `user-var` target (OSC 1337 SetUserVar) would feed a user-definable status-bar component honestly.
export type TemplateTargetId = 'badge' | 'window-title' | 'tab-title';

// How iTerm2 treats the authored template once applied — the single fact that distinguishes the targets.
//  - 'live': iTerm2 stores the interpolation FORMAT and re-evaluates it continuously (the badge via
//    SetBadgeFormat). The `\(…)` template is sent verbatim; iTerm2 owns interpolation, so the target
//    stays live and an apply is valid even when the current preview cannot resolve.
//  - 'snapshot': the target accepts only literal text (OSC window/tab title), so the probe-RENDERED
//    value is sent once. A snapshot can only be applied from a resolved preview value, never an error.
export type TemplateApplyMode = 'live' | 'snapshot';

// [LAW:types-are-the-program] A target is one type with the apply mode and escape builder as data, not
// three near-identical types. `buildSequence` receives both the authored format and the rendered value;
// each target reads exactly the field its mode needs ([LAW:dataflow-not-control-flow]) — the badge wraps
// the format, the titles wrap the rendered text — so the apply path stays one shape across all targets.
export interface TemplateTarget {
  id: TemplateTargetId;
  label: string;
  description: string;
  applyMode: TemplateApplyMode;
  buildSequence: (parts: { format: string; rendered: string }) => string;
}

export const TEMPLATE_TARGETS: readonly TemplateTarget[] = [
  {
    id: 'badge',
    label: 'Badge',
    description:
      'OSC 1337 SetBadgeFormat — iTerm2 re-interpolates this format continuously, so the badge stays live as the session changes.',
    applyMode: 'live',
    buildSequence: ({ format }) => osc1337(`SetBadgeFormat=${base64Utf8(format)}`),
  },
  {
    id: 'window-title',
    label: 'Window title',
    description:
      'OSC 2 — sets the window title to the rendered text once (a snapshot; the profile must allow terminal-set titles).',
    applyMode: 'snapshot',
    buildSequence: ({ rendered }) => `${ESC}]2;${rendered}${BEL}`,
  },
  {
    id: 'tab-title',
    label: 'Tab title',
    description:
      'OSC 1 — sets the tab title to the rendered text once (a snapshot; the profile must allow terminal-set titles).',
    applyMode: 'snapshot',
    buildSequence: ({ rendered }) => `${ESC}]1;${rendered}${BEL}`,
  },
];

// [LAW:no-defensive-null-guards] The catalog is closed and the id is always one of its members, so this
// resolves exactly. A missing id is a programming error (an id minted nowhere in the union), surfaced
// loudly rather than papered over with a nullable return that every caller would then have to defend.
export function findTemplateTarget(id: TemplateTargetId): TemplateTarget {
  const target = TEMPLATE_TARGETS.find((t) => t.id === id);
  if (target === undefined) {
    throw new Error(`unknown template target: ${id}`);
  }
  return target;
}

// [LAW:types-are-the-program] The preview display model. An empty rendered string is its own resolved
// state (`rendered` with value ''), never collapsed into `idle`/blank: a template that interpolates to
// nothing is a real, visible answer, distinct from "nothing authored yet" and from a failure
// ([LAW:no-silent-failure]). The error arm is first-class so an unresolved/invalid interpolation always
// surfaces iTerm2's own reason instead of a silent blank.
export type TemplatePreview =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'rendered'; value: string }
  | { state: 'error'; message: string };

// [LAW:one-source-of-truth] The probe IS the evaluator; this only maps its self-describing outcome onto
// the display model. There is no second interpolation here — `value` and `message` pass through verbatim.
export function previewFromProbe(result: AppProbeResult): TemplatePreview {
  switch (result.outcome) {
    case 'value':
      return { state: 'rendered', value: result.value };
    case 'error':
      return { state: 'error', message: result.message };
  }
}

const REFERENCE_PATTERN = /\\\(([^()]*)\)/g;

// [LAW:decomposition] Extract the SIMPLE variable-path references a template interpolates — `\( … )`
// spans with no nested call syntax, which are exactly the references whose existence we can check by
// membership against the live variable set. A reference containing parentheses (a function call like
// `\(myFunc(x: 1))`) is intentionally skipped: validating it would require evaluating it, which only the
// probe does ([LAW:one-source-of-truth]). Surfacing a "missing variable" for a function call would be a
// false negative that drives the user to fix something that is not wrong.
export function extractSimpleReferences(template: string): string[] {
  const refs: string[] = [];
  for (const match of template.matchAll(REFERENCE_PATTERN)) {
    const inner = match[1].trim();
    if (inner !== '') {
      refs.push(inner);
    }
  }
  return refs;
}

// [LAW:no-silent-failure] A static pre-flight against the canonical live variable set: the simple
// references that name no live variable. This renders nothing, so it can never drift from how iTerm2
// interpolates — it is a membership check, not a second evaluator. It names an unresolved reference
// proactively, before the probe round-trip turns it into an empty string or an error, so the user sees
// WHICH reference is wrong rather than a blank or a generic message. Duplicates collapse; order follows
// first appearance so the surfaced list reads like the template.
export function unresolvedReferences(template: string, liveNames: readonly string[]): string[] {
  const known = new Set(liveNames);
  const seen = new Set<string>();
  const unresolved: string[] = [];
  for (const ref of extractSimpleReferences(template)) {
    if (!known.has(ref) && !seen.has(ref)) {
      seen.add(ref);
      unresolved.push(ref);
    }
  }
  return unresolved;
}

// [LAW:dataflow-not-control-flow] Whether the apply affordance is actionable, as a derived value the
// button reads — not a branch scattered across the UI. Both apply modes require an authored template and
// a focused session to inject into; the snapshot-needs-a-resolved-value rule is enforced at apply time
// against a FRESH probe (so it can never act on a stale render), not predicted here.
export type ApplyAvailability = { ok: true } | { ok: false; reason: string };

export function applyAvailability(draft: string, hasSession: boolean): ApplyAvailability {
  if (draft.trim() === '') {
    return { ok: false, reason: 'Author a template first.' };
  }
  if (!hasSession) {
    return { ok: false, reason: 'Focus a session to apply.' };
  }
  return { ok: true };
}
