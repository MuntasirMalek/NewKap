#!/usr/bin/env node
'use strict';

// Patches aperture module for macOS Sonoma/Sequoia compatibility and disables
// electron-util's enforceMacOSAppLocation across all nested copies.
const fs = require('fs');
const path = require('path');

const PATCH_MARKER = '/* patched-by-newkap */';
const aperturePath = path.join(__dirname, '..', 'node_modules', 'aperture', 'index.js');

if (fs.existsSync(aperturePath)) {
  let content = fs.readFileSync(aperturePath, 'utf8');
  let patched = false;

  // Increase recording start timeout from 5s to 30s for macOS Sonoma+
  if (content.includes('within 5 seconds')) {
    content = content.replace(
      /Could not start recording within \d+ seconds/,
      'Could not start recording within 30 seconds'
    );
    content = content.replace(
      /},\s*5000\);/,
      '}, 30000);'
    );
    patched = true;
  }

  if (patched) {
    fs.writeFileSync(aperturePath, content);
    console.log('✅ Patched aperture: recording timeout increased to 30s');
  } else {
    console.log('✅ Aperture already patched or timeout not found');
  }
} else {
  console.log('aperture not found, skipping aperture patch');
}

// Patch ALL copies of electron-util: disable enforceMacOSAppLocation everywhere.
// There are multiple nested copies (mac-open-with, macos-audio-devices,
// mac-screen-capture-permissions, electron-timber) that each bundle their own
// electron-util with the enforce function still active.
const noopEnforce = `'use strict';\n${PATCH_MARKER}\n// Patched by NewKap: disabled — unreliable and shows wrong branding.\nmodule.exports = () => {};\n`;
const nodeModulesDirectory = path.join(__dirname, '..', 'node_modules');

function patchAllEnforceCopies(directory) {
  let count = 0;
  const entries = fs.readdirSync(directory, {withFileTypes: true});

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.name === 'electron-util') {
      // Patch source/enforce-macos-app-location.js if it exists
      const sourceEnforce = path.join(fullPath, 'source', 'enforce-macos-app-location.js');
      if (fs.existsSync(sourceEnforce)) {
        const current = fs.readFileSync(sourceEnforce, 'utf8');
        if (!current.includes(PATCH_MARKER)) {
          fs.writeFileSync(sourceEnforce, noopEnforce);
          count++;
        }
      }

      // Patch bundled index.js (v0.8.x has enforce inline in index.js) idempotently
      const indexJs = path.join(fullPath, 'index.js');
      if (fs.existsSync(indexJs)) {
        let indexContent = fs.readFileSync(indexJs, 'utf8');
        if (!indexContent.includes(PATCH_MARKER) && (indexContent.includes('isInApplicationsFolder') || indexContent.includes('Move to Applications folder'))) {
          indexContent = indexContent.replace(
            /exports\.enforceMacOSAppLocation\s*=\s*\(\)\s*=>\s*{/,
            'exports.enforceMacOSAppLocation = () => { return;'
          );
          indexContent = indexContent.replace(
            /function legacyEnforceMacOSAppLocation\(\)\s*{/,
            'function legacyEnforceMacOSAppLocation() { return;'
          );
          indexContent = indexContent.replace(
            /function isInApplicationsFolder\(\)\s*{/,
            'function isInApplicationsFolder() { return true;'
          );
          indexContent = `${PATCH_MARKER}\n${indexContent}`;
          fs.writeFileSync(indexJs, indexContent);
          count++;
        }
      }
    }

    // Recurse into nested node_modules
    const nested = path.join(fullPath, 'node_modules');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
      count += patchAllEnforceCopies(nested);
    }
  }

  return count;
}

if (fs.existsSync(nodeModulesDirectory)) {
  const patchCount = patchAllEnforceCopies(nodeModulesDirectory);
  console.log(`✅ Patched ${patchCount} copies of electron-util: enforceMacOSAppLocation disabled`);
}
