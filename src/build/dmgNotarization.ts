// Build-time logic that decides which `make` artifacts need their own notarization
// pass, from an already-resolved signing decision. Pure: it performs no notarization
// itself — it returns a plan that the build boundary executes. [LAW:effects-at-boundaries]
//
// Why DMGs need a second pass: `osxNotarize` notarizes and staples the *.app* during
// the package step, but `make` then wraps that app into a *.dmg* — a distinct artifact.
// Gatekeeper assesses the DMG itself on download (`spctl --assess --type install`), and
// that assessment only passes when the DMG carries its own stapled notarization ticket.

import path from 'node:path';
import type { MacSigningDecision, NotarizeCredentials } from './macSigning';

/**
 * One DMG to submit to Apple's notary service and staple. The credentials travel with
 * the task so the executing boundary needs no second look at the environment.
 */
export interface DmgNotarizationTask {
  readonly dmgPath: string;
  readonly notarize: NotarizeCredentials;
}

// The ZIP maker's artifact already contains the app notarized+stapled at package time,
// so only the DMG — whose own Gatekeeper assessment is unsigned until now — qualifies.
const isDmg = (artifact: string): boolean => path.extname(artifact).toLowerCase() === '.dmg';

/**
 * Plan the post-make notarization work from the signing decision and the artifacts
 * `make` produced:
 * - unsigned build            → no tasks (there are no credentials to notarize with)
 * - signed build, no DMGs     → no tasks (nothing to wrap)
 * - signed build, N DMGs      → one task per DMG, each carrying the credentials
 */
export function planDmgNotarization(
  decision: MacSigningDecision,
  artifacts: readonly string[],
): DmgNotarizationTask[] {
  if (decision.kind === 'unsigned') {
    return [];
  }
  return artifacts
    .filter(isDmg)
    .map((dmgPath) => ({ dmgPath, notarize: decision.notarize }));
}
