import { describe, expect, it } from 'vitest';
import { planDmgNotarization } from './dmgNotarization';
import type { MacSigningDecision } from './macSigning';

const signed: MacSigningDecision = {
  kind: 'signed',
  notarize: { appleId: 'dev@example.com', appleIdPassword: 'abcd-efgh-ijkl-mnop', teamId: 'ABCDE12345' },
};
const unsigned: MacSigningDecision = { kind: 'unsigned' };

describe('planDmgNotarization', () => {
  it('plans no work for an unsigned build, even when DMGs are present', () => {
    expect(planDmgNotarization(unsigned, ['/out/App.dmg', '/out/App.zip'])).toEqual([]);
  });

  it('plans no work for a signed build that produced no DMG', () => {
    expect(planDmgNotarization(signed, ['/out/App.zip', '/out/App.app'])).toEqual([]);
  });

  it('plans one task per DMG, carrying the credentials', () => {
    expect(planDmgNotarization(signed, ['/out/App.dmg'])).toEqual([
      { dmgPath: '/out/App.dmg', notarize: signed.notarize },
    ]);
  });

  it('selects only DMGs, ignoring zip/app/linux artifacts', () => {
    const artifacts = ['/out/App.zip', '/out/App-x64.dmg', '/out/app.deb', '/out/App-arm64.dmg', '/out/App.rpm'];
    expect(planDmgNotarization(signed, artifacts)).toEqual([
      { dmgPath: '/out/App-x64.dmg', notarize: signed.notarize },
      { dmgPath: '/out/App-arm64.dmg', notarize: signed.notarize },
    ]);
  });

  it('matches only on the final extension, rejecting .dmg-in-the-middle names', () => {
    expect(planDmgNotarization(signed, ['/out/App.dmg.zip', '/out/notes-about-dmg.txt'])).toEqual([]);
  });

  it('matches the .dmg extension case-insensitively', () => {
    expect(planDmgNotarization(signed, ['/out/App.DMG'])).toEqual([
      { dmgPath: '/out/App.DMG', notarize: signed.notarize },
    ]);
  });
});
