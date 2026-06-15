import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildLatestMacYml, planUpdateFeed } from './updateFeed';

describe('planUpdateFeed', () => {
  it('emits one manifest per macOS .zip, written alongside it', () => {
    const plans = planUpdateFeed([
      '/out/make/zip/darwin/arm64/Workbench-darwin-arm64-1.2.3.zip',
      '/out/make/zip/darwin/x64/Workbench-darwin-x64-1.2.3.zip',
    ]);
    expect(plans).toEqual([
      {
        zipPath: '/out/make/zip/darwin/arm64/Workbench-darwin-arm64-1.2.3.zip',
        ymlPath: '/out/make/zip/darwin/arm64/latest-mac.yml',
      },
      {
        zipPath: '/out/make/zip/darwin/x64/Workbench-darwin-x64-1.2.3.zip',
        ymlPath: '/out/make/zip/darwin/x64/latest-mac.yml',
      },
    ]);
  });

  it('ignores non-zip artifacts (DMG, deb, rpm, Squirrel)', () => {
    expect(
      planUpdateFeed([
        '/out/make/Workbench.dmg',
        '/out/make/deb/Workbench.deb',
        '/out/make/squirrel.windows/Workbench.nupkg',
      ]),
    ).toEqual([]);
  });

  it('matches the .zip extension case-insensitively but not as a substring', () => {
    expect(planUpdateFeed(['/out/App.ZIP']).map((p) => p.zipPath)).toEqual(['/out/App.ZIP']);
    expect(planUpdateFeed(['/out/App.zip.dmg'])).toEqual([]);
  });
});

describe('buildLatestMacYml', () => {
  const entry = {
    version: '1.2.3',
    fileName: 'Workbench-darwin-arm64-1.2.3.zip',
    sha512: 'abc/DEF+ghi==',
    size: 4096,
    releaseDate: '2026-06-15T00:00:00.000Z',
  };

  it('produces a manifest electron-updater can parse into UpdateInfo', () => {
    const parsed = parse(buildLatestMacYml(entry));
    expect(parsed).toEqual({
      version: '1.2.3',
      files: [{ url: 'Workbench-darwin-arm64-1.2.3.zip', sha512: 'abc/DEF+ghi==', size: 4096 }],
      path: 'Workbench-darwin-arm64-1.2.3.zip',
      sha512: 'abc/DEF+ghi==',
      releaseDate: '2026-06-15T00:00:00.000Z',
    });
  });

  it('keeps the legacy single-file fields in lockstep with the files entry', () => {
    const parsed = parse(buildLatestMacYml(entry));
    expect(parsed.path).toBe(parsed.files[0].url);
    expect(parsed.sha512).toBe(parsed.files[0].sha512);
  });

  it('round-trips base64 sha512 padding without corruption', () => {
    const parsed = parse(buildLatestMacYml({ ...entry, sha512: 'AAAA====' }));
    expect(parsed.files[0].sha512).toBe('AAAA====');
  });
});
