import execa from 'execa';
import ffmpegPath from './ffmpeg-path';

export type HardwareEncoder = 'h264_videotoolbox' | 'hevc_videotoolbox';

let availableEncodersPromise: Promise<Set<string>> | undefined;

const detectAvailableEncoders = async (): Promise<Set<string>> => {
  if (process.platform !== 'darwin') {
    return new Set();
  }

  try {
    const {stdout} = await execa(ffmpegPath, ['-hide_banner', '-encoders']);
    const encoders = new Set<string>();

    for (const candidate of ['h264_videotoolbox', 'hevc_videotoolbox'] as const) {
      if (stdout.includes(candidate)) {
        encoders.add(candidate);
      }
    }

    return encoders;
  } catch {
    return new Set();
  }
};

export const hasHardwareEncoder = async (encoder: HardwareEncoder): Promise<boolean> => {
  if (!availableEncodersPromise) {
    availableEncodersPromise = detectAvailableEncoders();
  }

  const encoders = await availableEncodersPromise;
  return encoders.has(encoder);
};

export const resetEncoderDetectionCache = () => {
  availableEncodersPromise = undefined;
};

// Compute an adaptive bitrate for Intel VideoToolbox (which does not support
// `-q:v` constant-quality mode; Apple Silicon uses `-q:v` instead).
const computeTargetBitrate = ({
  width,
  height,
  fps,
  codec
}: {
  width?: number;
  height?: number;
  fps?: number;
  codec: 'h264' | 'hevc';
}): string => {
  const safeWidth = Math.max(width ?? 1920, 160);
  const safeHeight = Math.max(height ?? 1080, 120);
  const safeFps = Math.max(fps ?? 30, 10);
  const bitsPerPixel = codec === 'hevc' ? 0.08 : 0.12;
  const rawBitrate = Math.round(safeWidth * safeHeight * safeFps * bitsPerPixel);
  const minBitrate = codec === 'hevc' ? 1_000_000 : 1_500_000;
  const maxBitrate = codec === 'hevc' ? 15_000_000 : 20_000_000;
  const clampedBitrate = Math.min(Math.max(rawBitrate, minBitrate), maxBitrate);

  return clampedBitrate.toString();
};

export const getH264VideoToolboxArgs = ({
  width,
  height,
  fps
}: {
  width?: number;
  height?: number;
  fps?: number;
} = {}): string[] => {
  // Apple Silicon VideoToolbox supports `-q:v` constant quality; Intel Macs
  // require `-b:v` target bitrate (passing `-q:v` fails on Intel).
  const rateControlArgs = process.arch === 'arm64' ?
    ['-q:v', '65'] :
    ['-b:v', computeTargetBitrate({width, height, fps, codec: 'h264'})];

  return [
    '-c:v',
    'h264_videotoolbox',
    ...rateControlArgs,
    '-allow_sw',
    '1',
    '-pix_fmt',
    'yuv420p'
  ];
};

export const getHevcVideoToolboxArgs = ({
  width,
  height,
  fps
}: {
  width?: number;
  height?: number;
  fps?: number;
} = {}): string[] => {
  const rateControlArgs = process.arch === 'arm64' ?
    ['-q:v', '65'] :
    ['-b:v', computeTargetBitrate({width, height, fps, codec: 'hevc'})];

  return [
    '-c:v',
    'hevc_videotoolbox',
    '-profile:v',
    'main',
    ...rateControlArgs,
    '-allow_sw',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-tag:v',
    'hvc1'
  ];
};
