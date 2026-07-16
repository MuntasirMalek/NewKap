import moment from 'moment';
import prettyMilliseconds from 'pretty-ms';

export interface ConvertOptions {
  inputPath: string;
  outputPath: string;
  shouldCrop: boolean;
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  fps: number;
  shouldMute: boolean;
  onCancel: () => void;
  onProgress: (action: string, progress: number, estimate?: string) => void;
  editService?: {
    pluginName: string;
    serviceTitle: string;
  };
}

// GIF frame delays are stored in 1/100s units, so 50fps (2 centiseconds per
// frame) is the highest cleanly representable rate. Higher rates such as 60fps
// can't be stored and get mangled into slow motion, so GIF exports are capped
// at this fps.
export const GIF_MAX_FPS = 50;

export const makeEven = (number: number) => 2 * Math.round(number / 2);

export const areDimensionsEven = ({width, height}: {width: number; height: number}) => width % 2 === 0 && height % 2 === 0;

export const extractProgressFromStderr = (stderr: string, conversionStartTime: number, durationMs: number) => {
  const conversionDuration = Date.now() - conversionStartTime;
  const data = stderr.trim();

  const speed = Number.parseFloat(/speed=\s*(-?\d+(,\d+)*(\.\d+(e\d+)?)?)/gm.exec(data)?.[1] ?? '0');
  const processedMs = moment.duration(/time=\s*(\d\d:\d\d:\d\d.\d\d)/gm.exec(data)?.[1] ?? 0).asMilliseconds();

  if (speed > 0) {
    const progress = processedMs / durationMs;

    // Wait 2 seconds in the conversion for speed to be stable
    // Either 2 seconds of the video or 15 seconds real time (for super slow conversion like AV1)
    if (processedMs > 2 * 1000 || conversionDuration > 15 * 1000) {
      const msRemaining = (durationMs - processedMs) / speed;

      return {
        progress,
        estimate: prettyMilliseconds(Math.max(msRemaining, 1000), {compact: true})
      };
    }

    return {progress};
  }

  return undefined;
};

// While encoding, gifski writes carriage-return-updated status lines to stdout:
//   "Frame 427 / 1282  ###############_....  6s "
// It has no structured progress flag, so parse the latest "Frame <done> / <total>"
// (and the trailing time-remaining token, when present) to drive the progress bar.
// Pass the newest stdout chunk, not the whole accumulated buffer.
export const extractGifskiProgress = (output: string): {progress: number; estimate?: string} | undefined => {
  const regex = /Frame\s+(\d+)\s*\/\s*(\d+)(?:\s+[#._]+\s+(\d+[smhd]))?/g;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = regex.exec(output)) !== null) {
    last = match;
  }

  if (!last) {
    return undefined;
  }

  const total = Number.parseInt(last[2], 10);
  if (!(total > 0)) {
    return undefined;
  }

  return {
    progress: Math.min(Number.parseInt(last[1], 10) / total, 1),
    estimate: last[3]
  };
};

type ArgType = string[] | string | {args: string[]; if: boolean};

// Resolve conditional args
//
// conditionalArgs(['default', 'args'], {args: ['ignore', 'these'], if: false});
// => ['default', 'args']
export const conditionalArgs = (...args: ArgType[]): string[] => {
  return args.flatMap(arg => {
    if (typeof arg === 'string') {
      return [arg];
    }

    if (Array.isArray(arg)) {
      return arg;
    }

    return arg.if ? arg.args : [];
  });
};
