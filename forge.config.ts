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
import { resolveMacSigning } from './src/build/macSigning';
import { planDmgNotarization } from './src/build/dmgNotarization';
import { selectDeveloperIdApplicationIdentity } from './src/build/signingIdentity';

const macSigning = resolveMacSigning(process.env);

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
      return makeResults;
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
