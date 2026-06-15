import { describe, expect, it } from 'vitest';
import { MAC_SIGNING_ENV, resolveMacSigning } from './macSigning';

const complete = {
  [MAC_SIGNING_ENV.appleId]: 'dev@example.com',
  [MAC_SIGNING_ENV.appleIdPassword]: 'abcd-efgh-ijkl-mnop',
  [MAC_SIGNING_ENV.teamId]: 'ABCDE12345',
};

describe('resolveMacSigning', () => {
  it('signs and notarizes when all credential vars are present', () => {
    expect(resolveMacSigning(complete)).toEqual({
      kind: 'signed',
      notarize: {
        appleId: 'dev@example.com',
        appleIdPassword: 'abcd-efgh-ijkl-mnop',
        teamId: 'ABCDE12345',
      },
    });
  });

  it('produces an unsigned build when no credential vars are present', () => {
    expect(resolveMacSigning({})).toEqual({ kind: 'unsigned' });
  });

  it('treats blank/whitespace-only credential vars as absent', () => {
    expect(
      resolveMacSigning({
        [MAC_SIGNING_ENV.appleId]: '',
        [MAC_SIGNING_ENV.appleIdPassword]: '   ',
        [MAC_SIGNING_ENV.teamId]: undefined,
      }),
    ).toEqual({ kind: 'unsigned' });
  });

  it('trims surrounding whitespace from credential values', () => {
    const result = resolveMacSigning({
      [MAC_SIGNING_ENV.appleId]: '  dev@example.com  ',
      [MAC_SIGNING_ENV.appleIdPassword]: '\tabcd-efgh-ijkl-mnop\n',
      [MAC_SIGNING_ENV.teamId]: ' ABCDE12345 ',
    });
    expect(result).toEqual({
      kind: 'signed',
      notarize: { appleId: 'dev@example.com', appleIdPassword: 'abcd-efgh-ijkl-mnop', teamId: 'ABCDE12345' },
    });
  });

  it('throws naming the missing vars when the credential set is partial', () => {
    expect(() =>
      resolveMacSigning({ [MAC_SIGNING_ENV.appleId]: 'dev@example.com' }),
    ).toThrowError(/Missing: APPLE_ID_PASSWORD, APPLE_TEAM_ID\./);
  });

  it('throws when a single credential var is missing', () => {
    const partial = {
      [MAC_SIGNING_ENV.appleId]: complete[MAC_SIGNING_ENV.appleId],
      [MAC_SIGNING_ENV.appleIdPassword]: complete[MAC_SIGNING_ENV.appleIdPassword],
    };
    expect(() => resolveMacSigning(partial)).toThrowError(/Missing: APPLE_TEAM_ID\./);
  });
});
