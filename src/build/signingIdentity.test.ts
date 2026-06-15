import { describe, expect, it } from 'vitest';
import { selectDeveloperIdApplicationIdentity } from './signingIdentity';

const output = [
  '  1) 1BB7ACC206ACD6FACCA47B831FC49A08D7DC4B15 "Apple Development: Brandon Fryslie (9S8AZWJ949)"',
  '  2) 0A7CD88279C8A641955FA8D7E64A9B7E5A0486CC "MouseMap Self-Signed"',
  '  3) E8665B1F13003844806A98CE0E76E2D85E22ACAA "Developer ID Application: Brandon Fryslie (6R988MUU27)"',
  '     3 valid identities found',
].join('\n');

describe('selectDeveloperIdApplicationIdentity', () => {
  it('returns the SHA-1 of the Developer ID Application identity matching the team', () => {
    expect(selectDeveloperIdApplicationIdentity(output, '6R988MUU27')).toBe(
      'E8665B1F13003844806A98CE0E76E2D85E22ACAA',
    );
  });

  it('ignores Apple Development, self-signed, and the summary line', () => {
    // Only one match remains after filtering — verified by it not throwing on ambiguity.
    expect(() => selectDeveloperIdApplicationIdentity(output, '6R988MUU27')).not.toThrow();
  });

  it('throws when no Developer ID Application identity exists for the team', () => {
    expect(() => selectDeveloperIdApplicationIdentity(output, 'NOSUCHTEAM')).toThrowError(
      /No valid "Developer ID Application: … \(NOSUCHTEAM\)"/,
    );
  });

  it('does not match a team that only appears as a substring of another team', () => {
    const line = '  1) AAAA1111AAAA1111AAAA1111AAAA1111AAAA1111 "Developer ID Application: Dev (TEAM12345X)"';
    expect(() => selectDeveloperIdApplicationIdentity(line, 'TEAM12345')).toThrowError(/No valid/);
  });

  it('throws on ambiguity when two valid Developer IDs share the team', () => {
    const ambiguous = [
      '  1) AAAA1111AAAA1111AAAA1111AAAA1111AAAA1111 "Developer ID Application: Old (6R988MUU27)"',
      '  2) BBBB2222BBBB2222BBBB2222BBBB2222BBBB2222 "Developer ID Application: New (6R988MUU27)"',
    ].join('\n');
    expect(() => selectDeveloperIdApplicationIdentity(ambiguous, '6R988MUU27')).toThrowError(
      /Found 2 .* identities; cannot pick one unambiguously/,
    );
  });
});
