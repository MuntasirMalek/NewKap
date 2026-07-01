#!/bin/bash
# Rebuild the bundled mac-* helper CLIs as universal (x86_64 + arm64) binaries
# from their upstream source, into vendor/mac-helpers/. Run this to refresh the
# vendored binaries (requires Xcode / the Swift toolchain). The npm packages
# ship x86_64-only prebuilts, which run under Rosetta on Apple Silicon and
# trip the macOS Intel deprecation warning; these universal rebuilds avoid it.
#
# Usage: scripts/build-mac-helpers.sh
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/mac-helpers"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST"

ARCHS="--arch arm64 --arch x86_64"
prod() { echo "$1/.build/apple/Products/Release"; }

echo "==> macos-audio-devices"
git clone --depth 1 https://github.com/karaggeorge/macos-audio-devices "$WORK/ad"
swift build -c release $ARCHS --package-path "$WORK/ad" >/dev/null
cp "$(prod "$WORK/ad")/audio-devices" "$DEST/audio-devices"

echo "==> mac-open-with"
git clone --depth 1 https://github.com/karaggeorge/mac-open-with "$WORK/ow"
swift build -c release $ARCHS --package-path "$WORK/ow" >/dev/null
cp "$(prod "$WORK/ow")/open-with" "$DEST/open-with"

echo "==> mac-windows (two subpackages)"
git clone --depth 1 https://github.com/karaggeorge/mac-windows "$WORK/mw"
swift build -c release $ARCHS --package-path "$WORK/mw/swift/MacWindows" >/dev/null
cp "$(prod "$WORK/mw/swift/MacWindows")/mac-windows" "$DEST/MacWindows"
swift build -c release $ARCHS --package-path "$WORK/mw/swift/ActivateWindow" >/dev/null
cp "$(prod "$WORK/mw/swift/ActivateWindow")/activate-window" "$DEST/ActivateWindow"

echo "==> node-mac-app-icon (GetAppIcon submodule)"
git clone --depth 1 --recurse-submodules https://github.com/sallar/node-mac-app-icon "$WORK/ai"
swift build -c release $ARCHS --package-path "$WORK/ai/GetAppIcon" >/dev/null
cp "$(prod "$WORK/ai/GetAppIcon")/GetAppIcon" "$DEST/run"

chmod +x "$DEST"/*
echo "==> done. vendored:"
for f in "$DEST"/*; do printf '  %-16s [%s]\n' "$(basename "$f")" "$(lipo -archs "$f")"; done
