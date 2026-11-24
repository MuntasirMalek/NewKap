'use strict';

// Electron-builder afterPack hook for macOS builds:
// 1. Ensures the bundled ffmpeg binary matches the target architecture (x64 or
//    arm64), fixing cross-architecture packaging where ffmpeg-static otherwise
//    copies only the host machine's binary into both DMGs.
// 2. Audits every Mach-O binary inside the packaged .app to verify that none
//    lack the target architecture (preventing accidental x86_64-only binaries
//    in Apple Silicon releases or arm64-only binaries in Intel releases).
// 3. For unsigned builds (when CSC_IDENTITY_AUTO_DISCOVERY=false or no signing
//    identity is present), applies a proper bottom-up ad-hoc code signature
//    binding Info.plist, com.newkap.app, entitlements, and helper executables
//    (including aperture) so macOS TCC permissions match cleanly.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const FFMPEG_RELEASE_TAG = 'b6.1.1';
const FFMPEG_BINARIES = {
  arm64: {
    asset: 'ffmpeg-darwin-arm64.gz',
    sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584'
  },
  x64: {
    asset: 'ffmpeg-darwin-x64.gz',
    sha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894'
  }
};

// Matches electron-builder's Arch enum values (builder-util/out/arch.js)
const ARCH_MAP = {
  1: 'x64',
  3: 'arm64'
};

const EXPECTED_LIPO_ARCH = {
  x64: 'x86_64',
  arm64: 'arm64'
};

const sha256File = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const fetchWithRetry = (url, outputPath, attempts = 3) => {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('curl', ['-fsSL', url, '-o', outputPath], {stdio: 'inherit'});
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }

      console.warn(`afterPack: download failed (attempt ${attempt}/${attempts}), retrying...`);
    }
  }
};

const ensureTargetFfmpeg = (projectDirectory, appPath, targetArch) => {
  const spec = FFMPEG_BINARIES[targetArch];
  if (!spec) {
    return;
  }

  const packagedFfmpeg = path.join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    'ffmpeg'
  );

  if (!fs.existsSync(packagedFfmpeg)) {
    throw new Error(`afterPack: expected unpacked ffmpeg binary at ${packagedFfmpeg}`);
  }

  if (sha256File(packagedFfmpeg) === spec.sha256) {
    console.log(`afterPack: ffmpeg already matches ${targetArch} (${FFMPEG_RELEASE_TAG})`);
    return;
  }

  const cacheDirectory = path.join(projectDirectory, 'vendor', 'ffmpeg-cache');
  const cachedBinary = path.join(cacheDirectory, `ffmpeg-darwin-${targetArch}`);

  if (!fs.existsSync(cachedBinary) || sha256File(cachedBinary) !== spec.sha256) {
    const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE_TAG}/${spec.asset}`;
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newkap-ffmpeg-'));
    const archivePath = path.join(temporaryDirectory, spec.asset);
    const extractedPath = path.join(temporaryDirectory, 'ffmpeg');

    try {
      console.log(`afterPack: fetching ffmpeg ${FFMPEG_RELEASE_TAG} for darwin-${targetArch}...`);
      fetchWithRetry(url, archivePath);

      const decompressed = execFileSync('gunzip', ['-c', archivePath], {maxBuffer: 150 * 1024 * 1024});
      fs.writeFileSync(extractedPath, decompressed);

      const actualHash = sha256File(extractedPath);
      if (actualHash !== spec.sha256) {
        throw new Error(`afterPack: ffmpeg ${targetArch} checksum mismatch (expected ${spec.sha256}, got ${actualHash})`);
      }

      fs.mkdirSync(cacheDirectory, {recursive: true});
      const stagedCache = `${cachedBinary}.download`;
      fs.copyFileSync(extractedPath, stagedCache);
      fs.chmodSync(stagedCache, 0o755);
      fs.renameSync(stagedCache, cachedBinary);
    } finally {
      fs.rmSync(temporaryDirectory, {recursive: true, force: true});
    }
  }

  fs.copyFileSync(cachedBinary, packagedFfmpeg);
  fs.chmodSync(packagedFfmpeg, 0o755);
  console.log(`afterPack: installed native ${targetArch} ffmpeg (${FFMPEG_RELEASE_TAG})`);
};

const walkFiles = directory => {
  const results = [];
  const entries = fs.readdirSync(directory, {withFileTypes: true});

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
};

const isMachOBinary = filePath => {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fileDescriptor, header, 0, 4, 0);
    if (bytesRead < 4) {
      return false;
    }

    const magic = header.readUInt32BE(0);
    return (
      magic === 0xFE_ED_FA_CE || // 32-bit BE
      magic === 0xCE_FA_ED_FE || // 32-bit LE
      magic === 0xFE_ED_FA_CF || // 64-bit BE
      magic === 0xCF_FA_ED_FE || // 64-bit LE
      magic === 0xCA_FE_BA_BE || // Universal fat BE
      magic === 0xBE_BA_FE_CA // Universal fat LE
    );
  } catch {
    return false;
  } finally {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
  }
};

const auditMachOArchitectures = (appPath, targetArch) => {
  const expectedSlice = EXPECTED_LIPO_ARCH[targetArch];
  if (!expectedSlice) {
    return;
  }

  const allFiles = walkFiles(appPath);
  const machOFiles = allFiles.filter(filePath => isMachOBinary(filePath));
  const mismatches = [];

  for (const binaryPath of machOFiles) {
    const architectures = execFileSync('lipo', ['-archs', binaryPath], {encoding: 'utf8'}).trim().split(/\s+/);
    if (!architectures.includes(expectedSlice)) {
      mismatches.push(`${path.relative(appPath, binaryPath)} [${architectures.join(', ')}]`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `afterPack: Mach-O architecture audit failed for ${targetArch} (expected ${expectedSlice}):\n  - ${mismatches.join('\n  - ')}`
    );
  }

  console.log(`afterPack: verified ${machOFiles.length} Mach-O binaries contain ${expectedSlice}`);
};

const hasDeveloperSigningIdentity = () => {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    return false;
  }

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return true;
  }

  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {encoding: 'utf8'});
    return !output.includes('0 valid identities found');
  } catch {
    return false;
  }
};

const adHocSignAppBundle = (projectDirectory, appPath, appId) => {
  const entitlementsPath = path.join(projectDirectory, 'build', 'entitlements.mac.inherit.plist');

  // Sign unpacked helper binaries, libraries, and native addons first
  const unpackedDirectory = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
  if (fs.existsSync(unpackedDirectory)) {
    const unpackedBinaries = walkFiles(unpackedDirectory).filter(filePath => isMachOBinary(filePath));
    for (const binaryPath of unpackedBinaries) {
      execFileSync('codesign', ['--force', '--sign', '-', binaryPath], {stdio: 'pipe'});
    }
  }

  // Sign nested frameworks and helper apps bottom-up
  const frameworksDirectory = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworksDirectory)) {
    const entries = fs.readdirSync(frameworksDirectory);
    for (const entry of entries) {
      const fullPath = path.join(frameworksDirectory, entry);
      if (entry.endsWith('.framework') || entry.endsWith('.app')) {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', fullPath], {stdio: 'pipe'});
      }
    }
  }

  // Sign the main app bundle, binding Info.plist, bundle identifier, and entitlements
  const signArguments = ['--force', '--sign', '-', '--identifier', appId];
  if (fs.existsSync(entitlementsPath)) {
    signArguments.push('--entitlements', entitlementsPath);
  }

  signArguments.push(appPath);
  execFileSync('codesign', signArguments, {stdio: 'pipe'});

  // Verify the final bundle signature integrity
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {stdio: 'pipe'});
  console.log(`afterPack: ad-hoc signed ${path.basename(appPath)} (${appId}) and verified integrity`);
};

exports.default = async context => {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const targetArch = ARCH_MAP[context.arch];
  if (!targetArch) {
    console.warn(`afterPack: skipping unsupported arch enum ${context.arch}`);
    return;
  }

  const projectDirectory = context.packager.projectDir;
  const productFilename = context.packager.appInfo.productFilename;
  const appId = context.packager.appInfo.id || 'com.newkap.app';
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  ensureTargetFfmpeg(projectDirectory, appPath, targetArch);
  auditMachOArchitectures(appPath, targetArch);

  if (!hasDeveloperSigningIdentity()) {
    adHocSignAppBundle(projectDirectory, appPath, appId);
  }
};
