#!/usr/bin/env node
'use strict';

const {spawn} = require('child_process');
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const env = {...process.env};

if (env.NODE_OPTIONS) {
  env.NODE_OPTIONS = env.NODE_OPTIONS
    .split(/\s+/)
    .filter(option => option && option !== '--openssl-legacy-provider')
    .join(' ');

  if (!env.NODE_OPTIONS) {
    delete env.NODE_OPTIONS;
  }
}

const brandDevelopmentHost = () => {
  if (process.platform !== 'darwin') {
    return;
  }

  const contentsDir = path.dirname(path.dirname(electron));
  const appBundle = path.dirname(contentsDir);
  const iconPath = path.join(__dirname, '..', 'build', 'icon.icns');
  const iconHash = crypto.createHash('sha256').update(fs.readFileSync(iconPath)).digest('hex').slice(0, 12);
  const stampPath = path.join(path.dirname(appBundle), `.kap-branding-${require('electron/package.json').version}-${iconHash}`);

  if (fs.existsSync(stampPath)) {
    return;
  }

  const setPlistValue = (plistPath, key, value) => {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath]);
  };

  const appPlist = path.join(contentsDir, 'Info.plist');
  setPlistValue(appPlist, 'CFBundleDisplayName', 'Kap');
  setPlistValue(appPlist, 'CFBundleName', 'Kap');
  setPlistValue(appPlist, 'CFBundleIdentifier', 'com.wulkano.kap.dev');
  setPlistValue(appPlist, 'CFBundleIconFile', 'Kap.icns');
  fs.copyFileSync(iconPath, path.join(contentsDir, 'Resources', 'Kap.icns'));

  const frameworksDir = path.join(contentsDir, 'Frameworks');
  for (const helperName of ['Electron Helper', 'Electron Helper (GPU)', 'Electron Helper (Plugin)', 'Electron Helper (Renderer)']) {
    const helperPlist = path.join(frameworksDir, `${helperName}.app`, 'Contents', 'Info.plist');
    setPlistValue(helperPlist, 'CFBundleName', helperName.replace('Electron', 'Kap'));
  }

  fs.writeFileSync(stampPath, 'Kap development host branding\n');
};

try {
  brandDevelopmentHost();
} catch (error) {
  console.error('[launcher] failed to brand the Electron development host', error);
}

const child = spawn(electron, process.argv.slice(2), {
  env,
  argv0: 'Kap',
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code || 0);
});
