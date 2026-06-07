const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
const electronInstallScript = path.join(electronPackageDir, 'install.js');
const electronDistDir = path.join(electronPackageDir, 'dist');
const electronPathFile = path.join(electronPackageDir, 'path.txt');
const executablePath = path.join(
  electronPackageDir,
  'dist',
  relativeExecutablePath,
);

if (!fs.existsSync(executablePath)) {
  fs.rmSync(electronDistDir, { recursive: true, force: true });
  fs.rmSync(electronPathFile, { force: true });

  const env = { ...process.env };
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;

  const result = spawnSync(process.execPath, [electronInstallScript], {
    env,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.signal !== null) {
    throw new Error(`Electron installer terminated by signal ${result.signal}`);
  }

  if (result.status !== 0) {
    throw new Error(`Electron installer failed with status ${result.status}`);
  }
}

if (!fs.existsSync(executablePath)) {
  throw new Error(`Electron binary missing after install: ${executablePath}`);
}

// [LAW:verifiable-goals] Playwright must fail before launch when Electron's install artifact is incomplete.
fs.writeFileSync(electronPathFile, relativeExecutablePath);
