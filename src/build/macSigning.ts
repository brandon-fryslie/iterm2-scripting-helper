// Build-time logic that resolves whether a macOS package should be code-signed and
// notarized, from the credentials present in the environment. Pure: it reads no
// process state itself — the caller passes the env so the decision is testable.

/**
 * The environment variables that supply Apple's app-specific-password notarization
 * credentials. This is the single source of truth for the credential variable names;
 * both the resolver and any documentation/tooling read from here.
 */
export const MAC_SIGNING_ENV = {
  appleId: 'APPLE_ID',
  appleIdPassword: 'APPLE_ID_PASSWORD',
  teamId: 'APPLE_TEAM_ID',
} as const;

/**
 * Apple ID app-specific-password notarization credentials. Structurally compatible
 * with `@electron/notarize`'s `NotaryToolPasswordCredentials`, kept local so this
 * pure module carries no build-toolchain dependency.
 */
export interface NotarizeCredentials {
  appleId: string;
  appleIdPassword: string;
  teamId: string;
}

/**
 * The three legal outcomes of inspecting the credential environment. A fourth state —
 * a partial credential set — is deliberately not representable here: the resolver
 * throws instead, because a half-configured signing setup must fail loudly rather than
 * silently degrade to an unsigned build.
 */
export type MacSigningDecision =
  | { kind: 'unsigned' }
  | { kind: 'signed'; notarize: NotarizeCredentials };

const clean = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Decide signing behavior from the environment:
 * - all three credential vars present  → signed + notarized build
 * - none present                       → unsigned local/dev build
 * - some present, some missing         → throw, naming the missing vars
 */
export function resolveMacSigning(env: Record<string, string | undefined>): MacSigningDecision {
  const appleId = clean(env[MAC_SIGNING_ENV.appleId]);
  const appleIdPassword = clean(env[MAC_SIGNING_ENV.appleIdPassword]);
  const teamId = clean(env[MAC_SIGNING_ENV.teamId]);

  if (appleId && appleIdPassword && teamId) {
    return { kind: 'signed', notarize: { appleId, appleIdPassword, teamId } };
  }
  if (!appleId && !appleIdPassword && !teamId) {
    return { kind: 'unsigned' };
  }

  // [LAW:no-silent-failure] A partial credential set is a misconfiguration — surface it.
  const missing = [
    [MAC_SIGNING_ENV.appleId, appleId],
    [MAC_SIGNING_ENV.appleIdPassword, appleIdPassword],
    [MAC_SIGNING_ENV.teamId, teamId],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  throw new Error(
    `macOS code signing is partially configured. Set all of ` +
      `[${Object.values(MAC_SIGNING_ENV).join(', ')}] to produce a signed and notarized ` +
      `build, or none of them for an unsigned local build. Missing: ${missing.join(', ')}.`,
  );
}
