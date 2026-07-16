# Third-Party Notices

NewKap is distributed under the MIT license. It bundles the following
third-party binaries, which are invoked as separate command-line programs
(arm's-length subprocess execution), not linked into the application:

## gifski

- **Purpose:** GIF encoding (fps resampling, scaling, quantization, encoding).
- **Upstream:** https://github.com/ImageOptim/gifski
- **Version:** 1.34.0 (official universal x86_64 + arm64 release)
- **License:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).
- **Source:** The complete corresponding source is available at the upstream
  URL above and at the tagged release
  https://github.com/ImageOptim/gifski/releases/tag/1.34.0
- **Notes:** The gifski author (Kornel Lesiński / ImageOptim) also offers
  commercial licensing for uses incompatible with the AGPL; see
  https://kornel.ski/contact

NewKap invokes the prebuilt `gifski` binary as an external process via the
command line; it does not link the `libgifski` library. The AGPL applies to
the gifski program itself, whose source is provided above.

## FFmpeg

- **Purpose:** Recording capture and video trimming/transcoding.
- **Upstream:** https://ffmpeg.org
- **Bundled build:** the prebuilt binary shipped by the `ffmpeg-static` npm
  package (v4.4.1).
- **License:** GNU General Public License v3.0 or later (GPL-3.0-or-later). The
  bundled binary is a static GPL build (`--enable-gpl --enable-version3`).
- **Source:** The corresponding source for this build is the FFmpeg source at
  the revision packaged by `ffmpeg-static` (see
  https://github.com/eugeneware/ffmpeg-static and https://github.com/BtbN/FFmpeg-Builds),
  and upstream FFmpeg at https://github.com/FFmpeg/FFmpeg
- **Maintainer note:** this build also reports `--enable-nonfree`. A GPL build
  that includes nonfree components is not redistributable under the GPL, so the
  bundled FFmpeg should be reviewed / replaced with a redistributable build
  before distributing releases. This predates and is independent of the GIF
  pipeline change.
