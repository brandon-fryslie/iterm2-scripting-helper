const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const electronExecutableByPlatform = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  linux: 'electron',
  win32: 'electron.exe',
};

const relativeExecutablePath = electronExecutableByPlatform[process.platform];

if (relativeExecutablePath === undefined) {
  throw new Error(`Unsupported Electron platform: ${process.platform}`);
}

const electronPackageDir = path.dirname(require.resolve('electron/package.json'));
const electronRequire = createRequire(path.join(electronPackageDir, 'install.js'));
const electronPackage = electronRequire('./package.json');
const electronInstallScript = path.join(electronPackageDir, 'install.js');
const electronDistDir = path.join(electronPackageDir, 'dist');
const electronPathFile = path.join(electronPackageDir, 'path.txt');
const executablePathFile = path.join(repoRoot, '.electron-executable-path');
const packageExecutablePath = path.join(
  electronPackageDir,
  'dist',
  relativeExecutablePath,
);
const runtimeDir = path.join(
  repoRoot,
  '.electron-runtime',
  `${electronPackage.version}-${process.platform}-${process.arch}`,
);
const runtimeExecutablePath = path.join(runtimeDir, relativeExecutablePath);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const executablePath = await resolveElectronExecutablePath();
  // [LAW:verifiable-goals] E2E launches the Electron binary this preflight verified.
  fs.writeFileSync(executablePathFile, executablePath);
  process.stdout.write(executablePath);
}

async function resolveElectronExecutablePath() {
  if (isUsableElectronExecutable(packageExecutablePath)) {
    fs.writeFileSync(electronPathFile, relativeExecutablePath);
    return packageExecutablePath;
  }

  runElectronInstaller();

  if (isUsableElectronExecutable(packageExecutablePath)) {
    fs.writeFileSync(electronPathFile, relativeExecutablePath);
    return packageExecutablePath;
  }

  await installRuntimeElectron();

  if (isUsableElectronExecutable(runtimeExecutablePath)) {
    fs.writeFileSync(
      electronPathFile,
      path.relative(electronDistDir, runtimeExecutablePath),
    );
    return runtimeExecutablePath;
  }

  throw new Error(
    `Electron binary missing after install: ${packageExecutablePath}`,
  );
}

function isUsableElectronExecutable(executablePath) {
  if (!fs.existsSync(executablePath)) return false;

  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  });

  return result.status === 0;
}

function runElectronInstaller() {
  fs.rmSync(electronDistDir, { recursive: true, force: true });
  fs.rmSync(electronPathFile, { force: true });

  const env = { ...process.env };
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  delete env.ELECTRON_OVERRIDE_DIST_PATH;
  env.force_no_cache = 'true';
  env.npm_config_arch = process.arch;
  env.npm_config_platform = process.platform;

  const result = spawnSync(process.execPath, [electronInstallScript], {
    env,
    encoding: 'utf8',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.signal !== null) {
    throw new Error(`Electron installer terminated by signal ${result.signal}`);
  }

  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Electron installer failed with status ${result.status}`);
  }
}

async function installRuntimeElectron() {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  const { downloadArtifact } = electronRequire('@electron/get');
  const extract = electronRequire('extract-zip');
  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: 'electron',
    force: true,
    cacheRoot: path.join(repoRoot, '.electron-cache'),
    checksums: electronRequire('./checksums.json'),
    platform: process.platform,
    arch: process.arch,
  });

  await extract(zipPath, { dir: runtimeDir });
}
