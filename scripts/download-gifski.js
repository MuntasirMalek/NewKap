'use strict';

// The gifski npm package is stuck at 1.7.1 (unmaintained since 2022), so fetch
// the universal (x86_64 + arm64) gifski binary from the official GitHub release.
// This keeps GIF export on a current, natively-running gifski with no Rosetta.
// macOS only, like the rest of Kap; uses curl + tar, which ship with macOS.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const VERSION = '1.34.0';
// SHA-256 of gifski-1.34.0.tar.xz from the official release (download integrity).
const ARCHIVE_SHA256 = 'b9b6591aa163123d737353d9c8581efdf3234d28eeaa45329b31da905cd5a996';
// SHA-256 of the extracted universal `gifski` binary (on-disk validity). Pinning
// the binary too lets us detect a stale version or a truncated/partial prior
// copy and re-download, instead of trusting whatever file happens to be there.
const BINARY_SHA256 = 'f5f73e09fba870a21e8c502f3191e58633e5081b1914f71e32d5ee714450e839';

const destination = path.join(__dirname, '..', 'vendor', 'gifski');
const binary = path.join(destination, 'gifski');

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const fetchWithRetry = (url, output, attempts = 3) => {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('curl', ['-fsSL', url, '-o', output], {stdio: 'inherit'});
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }

      console.warn(`gifski download failed (attempt ${attempt}/${attempts}), retrying...`);
    }
  }
};

const download = () => {
  // Skip only when the on-disk binary is exactly the pinned build; a stale
  // version or a truncated file (e.g. an interrupted prior install) fails this
  // check and is re-downloaded.
  if (fs.existsSync(binary) && sha256(binary) === BINARY_SHA256) {
    return;
  }

  const url = `https://github.com/ImageOptim/gifski/releases/download/${VERSION}/gifski-${VERSION}.tar.xz`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gifski-'));
  const archive = path.join(temporary, 'gifski.tar.xz');

  try {
    fetchWithRetry(url, archive);

    const actualHash = sha256(archive);
    if (actualHash !== ARCHIVE_SHA256) {
      throw new Error(`gifski ${VERSION} checksum mismatch: expected ${ARCHIVE_SHA256}, got ${actualHash}`);
    }

    execFileSync('tar', ['xf', archive, '-C', temporary]);

    const extracted = path.join(temporary, 'mac', 'gifski');
    if (sha256(extracted) !== BINARY_SHA256) {
      throw new Error(`gifski ${VERSION} binary checksum mismatch after extraction`);
    }

    fs.mkdirSync(destination, {recursive: true});

    // Install atomically: stage under a temp name on the same filesystem, then
    // rename, so an interrupted run never leaves a partial binary at the real
    // path for the next run to trust.
    const staged = `${binary}.download`;
    fs.copyFileSync(extracted, staged);
    fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, binary);

    console.log(`gifski ${VERSION} (universal) installed to ${path.relative(process.cwd(), binary)}`);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
};

download();
