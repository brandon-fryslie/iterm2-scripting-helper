import type { ConnectionFailure } from '@shared/rpc';

// [LAW:effects-at-boundaries] Pure classification of a raw connection-error string. The effect that
// produced it (osascript subprocess, socket connect) lives upstream; this is the testable core that
// decides whether a failure is the recoverable macOS Automation (TCC) denial. Co-located with the
// recovery knowledge it implies — the friendly message and the settings deep link — so everything the
// app knows about "Automation was denied, here is how to fix it" lives in one part. [LAW:decomposition]

// The macOS deep link to System Settings → Privacy & Security → Automation. Granting the toggle here
// is exactly what clears the TCC denial; clicking Connect again then succeeds.
export const AUTOMATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

// A denied (or consent-required-but-unshowable) Apple event surfaces as errAEEventNotPermitted
// (-1743) or errAEEventWouldRequireUserConsent (-1744). The numeric code is locale-independent, so it
// is the primary signal; the English text is a secondary match for environments that drop the code.
const TCC_DENIAL_CODE = /\(-174[34]\)/;
const TCC_DENIAL_TEXT = /not authorized to send apple events/i;

export function isAutomationDenied(message: string): boolean {
  return TCC_DENIAL_CODE.test(message) || TCC_DENIAL_TEXT.test(message);
}

const AUTOMATION_DENIED_MESSAGE =
  'macOS denied Automation permission, so this app cannot control iTerm2. Open System Settings → ' +
  'Privacy & Security → Automation, enable iTerm2 for this app, then click Connect again.';

// [LAW:single-enforcer] The one translation from a raw failure string to the typed ConnectionFailure.
// Only an Automation denial becomes recoverable; every other cause is carried verbatim so the real
// error is never swallowed. [LAW:no-silent-failure]
export function classifyConnectionFailure(raw: string): ConnectionFailure {
  if (isAutomationDenied(raw)) {
    return { kind: 'automation-denied', message: AUTOMATION_DENIED_MESSAGE };
  }
  return { kind: 'other', message: raw };
}
