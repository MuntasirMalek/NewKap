#!/usr/bin/env node
// Patches aperture module for macOS Sonoma/Sequoia compatibility
const fs = require('fs');
const path = require('path');

const aperturePath = path.join(__dirname, '..', 'node_modules', 'aperture', 'index.js');

if (!fs.existsSync(aperturePath)) {
  console.log('aperture not found, skipping patch');
  process.exit(0);
}

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

// Patch ALL copies of electron-util: disable enforceMacOSAppLocation everywhere
// There are multiple nested copies (mac-open-with, macos-audio-devices,
// mac-screen-capture-permissions, electron-timber) that each bundle their own
// electron-util with the enforce function still active.
const noopEnforce = '\'use strict\';\n// Patched by NewKap: disabled — unreliable and shows wrong branding.\nmodule.exports = () => {};\n';
const nodeModulesDir = path.join(__dirname, '..', 'node_modules');

function patchAllEnforceCopies(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.name === 'electron-util') {
      // Patch source/enforce-macos-app-location.js if it exists
      const srcEnforce = path.join(full, 'source', 'enforce-macos-app-location.js');
      if (fs.existsSync(srcEnforce)) {
        fs.writeFileSync(srcEnforce, noopEnforce);
        count++;
      }

      // Patch bundled index.js (v0.8.x has enforce inline in index.js)
      const indexJs = path.join(full, 'index.js');
      if (fs.existsSync(indexJs)) {
        let idx = fs.readFileSync(indexJs, 'utf8');
        if (idx.includes('isInApplicationsFolder') || idx.includes('Move to Applications folder')) {
          // Replace enforce export with no-op (handles all format variations)
          idx = idx.replace(
            /exports\.enforceMacOSAppLocation\s*=\s*\(\)\s*=>\s*{/,
            'exports.enforceMacOSAppLocation = () => { return;'
          );
          // Neuter the legacy function
          idx = idx.replace(
            /function legacyEnforceMacOSAppLocation\(\)\s*{/,
            'function legacyEnforceMacOSAppLocation() { return;'
          );
          // Make isInApplicationsFolder always return true
          idx = idx.replace(
            /function isInApplicationsFolder\(\)\s*{/,
            'function isInApplicationsFolder() { return true;'
          );
          fs.writeFileSync(indexJs, idx);
          count++;
        }
      }
    }

    // Recurse into node_modules
    const nested = path.join(full, 'node_modules');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
      count += patchAllEnforceCopies(nested);
    }
  }

  return count;
}

const patchCount = patchAllEnforceCopies(nodeModulesDir);
console.log(`✅ Patched ${patchCount} copies of electron-util: enforceMacOSAppLocation disabled`);
