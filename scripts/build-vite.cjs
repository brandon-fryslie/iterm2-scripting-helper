const fs = require('node:fs');
const path = require('node:path');
const loadForgeConfig = require('@electron-forge/core/dist/util/forge-config').default;
const ViteConfigGenerator = require('@electron-forge/plugin-vite/dist/ViteConfig').default;

const repoRoot = path.resolve(__dirname, '..');

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const forgeConfig = await loadForgeConfig(repoRoot);
  const vitePlugin = forgeConfig.plugins.find((plugin) => plugin.name === 'vite');
  const { build } = await import('vite');

  if (!vitePlugin) {
    throw new Error('Forge Vite plugin is not configured.');
  }

  fs.rmSync(path.join(repoRoot, '.vite'), { recursive: true, force: true });

  // [LAW:one-source-of-truth] Forge owns the Vite build shape used by package and e2e.
  const configGenerator = new ViteConfigGenerator(vitePlugin.config, repoRoot, true);
  const configs = [
    ...(await configGenerator.getBuildConfigs()),
    ...(await configGenerator.getRendererConfig()),
  ];

  for (const config of configs) {
    await build({
      configFile: false,
      logLevel: 'error',
      ...config,
    });
  }
}
