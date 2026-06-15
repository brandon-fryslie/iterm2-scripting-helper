import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { resolveMacSigning } from './src/build/macSigning';

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
    new MakerRpm({}),
    new MakerDeb({}),
  ],
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
