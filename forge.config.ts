import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { notarize } from '@electron/notarize';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveMacSigning } from './src/build/macSigning';
import { planDmgNotarization } from './src/build/dmgNotarization';
import { selectDeveloperIdApplicationIdentity } from './src/build/signingIdentity';
import { buildLatestMacYml, planUpdateFeed } from './src/build/updateFeed';

const macSigning = resolveMacSigning(process.env);

// The update manifest stamps the version it advertises; an absent version would mint a feed
// that promises an update to nothing, so surface it loudly rather than emitting "undefined".
// [LAW:no-silent-failure]
function readProjectVersion(): string {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('package.json has no version; cannot build an update feed manifest');
  }
  return raw.version;
}

// Make the resolved signing mode observable rather than letting an unsigned release
// slip out unnoticed. [LAW:no-silent-failure]
console.log(
  macSigning.kind === 'signed'
    ? `[forge] macOS signing ENABLED — notarizing as ${macSigning.notarize.appleId} (team ${macSigning.notarize.teamId})`
    : '[forge] macOS signing DISABLED — no Apple credentials in env; producing an unsigned build',
);

// osxSign with default options uses @electron/osx-sign's built-in, Electron-aware
// entitlements and enables the hardened runtime — a notarization prerequisite.
// Notarization requires a signed app, so both keys appear together or neither does.
const macCodesign =
  macSigning.kind === 'signed'
    ? { osxSign: {}, osxNotarize: macSigning.notarize }
    : {};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.brandonfryslie.iterm2-scripting-workbench',
    ...macCodesign,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    // Wraps the already-signed+notarized .app into a distributable DMG. The DMG itself gets
    // codesigned + notarized + stapled in the postMake hook below. [LAW:single-enforcer]
    new MakerDMG({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    // The package step signs+notarizes+staples the .app; `make` then wraps it into a DMG,
    // a separate artifact Gatekeeper assesses on its own. An unsigned-but-notarized DMG is
    // rejected by `spctl -a -t open` ("no usable signature"), so each produced DMG must be
    // codesigned, then notarized, then stapled — in that order, because signing changes the
    // DMG's cdhash that notarization is keyed to. [LAW:no-ambient-temporal-coupling]
    // This boundary owns the whole "make the DMG distributable" effect. [LAW:single-enforcer]
    postMake: async (_forgeConfig, makeResults) => {
      const artifacts = makeResults.flatMap((result) => result.artifacts);
      const tasks = planDmgNotarization(macSigning, artifacts);
      for (const task of tasks) {
        const identitySha1 = selectDeveloperIdApplicationIdentity(
          execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }),
          task.notarize.teamId,
        );
        console.log(`[forge] codesigning DMG ${task.dmgPath} with ${identitySha1}`);
        // --timestamp is required for a notarization-grade Developer ID signature.
        execFileSync('codesign', ['--force', '--timestamp', '--sign', identitySha1, task.dmgPath], {
          stdio: 'inherit',
        });
        console.log(`[forge] notarizing + stapling DMG ${task.dmgPath}`);
        await notarize({ tool: 'notarytool', appPath: task.dmgPath, ...task.notarize });
      }

      // Emit electron-updater's static feed manifest next to each macOS .zip. The manifest is
      // derived from the zip — its sha512 and size are measured here, at the boundary that owns
      // the file IO — while the manifest's shape is decided by the pure planner/serializer.
      // [LAW:effects-at-boundaries] [LAW:single-enforcer]
      const version = readProjectVersion();
      const releaseDate = new Date().toISOString();
      return makeResults.map((result) => {
        const manifests = planUpdateFeed(result.artifacts).map((plan) => {
          const bytes = readFileSync(plan.zipPath);
          const yml = buildLatestMacYml({
            version,
            fileName: path.basename(plan.zipPath),
            sha512: createHash('sha512').update(bytes).digest('base64'),
            size: bytes.byteLength,
            releaseDate,
          });
          writeFileSync(plan.ymlPath, yml);
          console.log(`[forge] wrote update feed manifest ${plan.ymlPath}`);
          return plan.ymlPath;
        });
        return { ...result, artifacts: [...result.artifacts, ...manifests] };
      });
    },
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
