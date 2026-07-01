'use strict';

// Several mac-* helper packages (mac-open-with, macos-audio-devices,
// mac-windows, node-mac-app-icon) ship prebuilt x86_64-ONLY Swift/ObjC command
// -line binaries. On Apple Silicon those run under Rosetta, which triggers the
// macOS Intel deprecation warning. We ship universal (x86_64 + arm64) rebuilds
// of them in vendor/mac-helpers (compiled from each package's upstream source;
// see scripts/build-mac-helpers.sh) and swap them into node_modules here, on
// postinstall, so the packaged app has no x86_64-only binaries. macOS only.

const fs = require('fs');
const path = require('path');

const vendor = path.join(__dirname, '..', 'vendor', 'mac-helpers');
const nodeModules = path.join(__dirname, '..', 'node_modules');

// Vendored binary -> destination inside node_modules
const replacements = [
  ['audio-devices', 'macos-audio-devices/audio-devices'],
  ['open-with', 'mac-open-with/open-with'],
  ['MacWindows', 'mac-windows/scripts/MacWindows'],
  ['ActivateWindow', 'mac-windows/scripts/ActivateWindow'],
  ['run', 'node-mac-app-icon/run']
];

let patched = 0;
for (const [name, relDest] of replacements) {
  const source = path.join(vendor, name);
  const destination = path.join(nodeModules, relDest);

  if (!fs.existsSync(source)) {
    console.warn(`patch-mac-helpers: missing vendored binary ${name}, skipping`);
    continue;
  }

  // Only patch when the package's prebuilt binary is actually present. Gating on
  // the destination file (not just its parent dir) means a future upstream bump
  // that relocates the binary is skipped, rather than leaving an orphan copy at
  // the stale path while the real x86_64 binary stays unpatched.
  if (!fs.existsSync(destination)) {
    continue;
  }

  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
  patched++;
}

console.log(`patch-mac-helpers: installed ${patched} universal helper binaries (no Rosetta)`);
