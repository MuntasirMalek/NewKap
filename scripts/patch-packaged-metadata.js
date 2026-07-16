#!/usr/bin/env node
'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const setPlistString = (plistPath, key, value) => {
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath]);
};

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename || 'Kap';
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const appResourcesDir = path.join(appPath, 'Contents', 'Resources');
  const appIconPath = path.join(appResourcesDir, 'icon.icns');
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');

  if (!fs.existsSync(frameworksDir)) {
    console.warn('[packaging] no Frameworks directory found for helper metadata patch');
    return;
  }

  const helperBundles = fs.readdirSync(frameworksDir)
    .filter(name => name.startsWith(`${appName} Helper`) && name.endsWith('.app'));

  for (const helperBundle of helperBundles) {
    const helperName = helperBundle.slice(0, -'.app'.length);
    const helperContentsDir = path.join(frameworksDir, helperBundle, 'Contents');
    const helperPlist = path.join(helperContentsDir, 'Info.plist');
    const helperResourcesDir = path.join(helperContentsDir, 'Resources');

    if (!fs.existsSync(helperPlist)) {
      continue;
    }

    setPlistString(helperPlist, 'CFBundleName', helperName);
    setPlistString(helperPlist, 'CFBundleDisplayName', helperName);

    if (fs.existsSync(appIconPath)) {
      fs.mkdirSync(helperResourcesDir, {recursive: true});
      fs.copyFileSync(appIconPath, path.join(helperResourcesDir, 'icon.icns'));
      setPlistString(helperPlist, 'CFBundleIconFile', 'icon.icns');
    }
  }

  console.log(`[packaging] patched Kap metadata for ${helperBundles.length} helper apps`);
};
