// Selects the Developer ID Application codesigning identity for a team from the output
// of `security find-identity -v -p codesigning`. Pure: the caller runs `security` (an
// effect) and passes the text here, so selection is testable. [LAW:effects-at-boundaries]
//
// Used to code-sign the distributable DMG. `@electron/osx-sign` auto-discovers this same
// certificate for the .app; we resolve it explicitly for the DMG, keyed to the team so a
// machine with multiple Developer IDs picks the right one.

// `  3) E8665B1F…ACAA "Developer ID Application: Brandon Fryslie (6R988MUU27)"`
const IDENTITY_LINE = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/;

/**
 * Return the SHA-1 of the single valid `Developer ID Application: … (teamId)` identity in
 * the given `security find-identity` output. Throws — never guesses — when zero or more
 * than one such identity is present, because signing with the wrong (or no) certificate is
 * a misconfiguration that must surface, not degrade silently. [LAW:no-silent-failure]
 */
export function selectDeveloperIdApplicationIdentity(findIdentityOutput: string, teamId: string): string {
  const suffix = `(${teamId})`;
  const matches = findIdentityOutput
    .split('\n')
    .map((line) => IDENTITY_LINE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, sha1, name]) => ({ sha1, name }))
    .filter(({ name }) => name.startsWith('Developer ID Application:') && name.endsWith(suffix));

  if (matches.length === 1) {
    return matches[0].sha1;
  }
  if (matches.length === 0) {
    throw new Error(
      `No valid "Developer ID Application: … ${suffix}" codesigning identity found in the ` +
        `login keychain. Install the Developer ID Application certificate for team ${teamId}.`,
    );
  }
  throw new Error(
    `Found ${matches.length} "Developer ID Application: … ${suffix}" identities; ` +
      `cannot pick one unambiguously. Remove the stale certificate(s) for team ${teamId}. ` +
      `Candidates: ${matches.map((m) => m.name).join(', ')}.`,
  );
}
