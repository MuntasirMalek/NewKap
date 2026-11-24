/* eslint-disable array-element-newline */
import PCancelable, {CancelError} from 'p-cancelable';
import tempy from 'tempy';
import {convert, gifski, ProcessOptions} from './process';
import {areDimensionsEven, conditionalArgs, ConvertOptions, GIF_MAX_FPS, makeEven} from './utils';
import {
  getH264VideoToolboxArgs,
  getHevcVideoToolboxArgs,
  HardwareEncoder,
  hasHardwareEncoder
} from '../utils/video-encoder';
import {settings} from '../common/settings';
import os from 'os';
import {Format} from '../common/types';
import fs from 'fs';

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertWithHardwareFallback = ({
  outputPath,
  processOptions,
  encoder,
  hardwareArgs,
  softwareArgs
}: {
  outputPath: string;
  processOptions: ProcessOptions;
  encoder: HardwareEncoder;
  hardwareArgs: string[];
  softwareArgs: string[];
}) => PCancelable.fn(async (onCancel: PCancelable.OnCancelFunction) => {
  let isCanceled = false;
  let activeProcess: PCancelable<string> | undefined;

  onCancel(() => {
    isCanceled = true;
    activeProcess?.cancel();
  });

  if (await hasHardwareEncoder(encoder)) {
    if (isCanceled) {
      return outputPath;
    }

    try {
      activeProcess = convert(outputPath, processOptions, hardwareArgs);
      return await activeProcess;
    } catch (error) {
      if (isCanceled || (error as CancelError)?.isCanceled) {
        throw error;
      }

      console.warn(`Hardware encoder ${encoder} failed, falling back to software encoder:`, error);
      fs.rmSync(outputPath, {force: true});
    }
  }

  if (isCanceled) {
    return outputPath;
  }

  activeProcess = convert(outputPath, processOptions, softwareArgs);
  return activeProcess;
})();

// GIF export: trim the clip with ffmpeg if a range is selected, then encode it
// with gifski. gifski reads video directly (its bundled binary statically links
// FFmpeg) and handles fps resampling and scaling itself, so no intermediate image
// frames are needed. It is multithreaded and higher quality than ffmpeg's
// palettegen/paletteuse pipeline, and its binary is universal (x86_64 + arm64) —
// so this also drops the x86_64-only gifsicle dependency that triggered the macOS
// Intel/Rosetta deprecation warning on Apple Silicon.
const convertToGif = PCancelable.fn(async (options: ConvertOptions, onCancel: PCancelable.OnCancelFunction) => {
  const shouldLoop = settings.get('loopExports');
  const useLossy = settings.get('lossyCompression', false);
  // GIF fps is capped (see GIF_MAX_FPS) because frame delays are stored in
  // 1/100s units; higher rates get mangled into slow motion.
  const fps = Math.min(options.fps, GIF_MAX_FPS);

  // Because gifski can't trim, use ffmpeg to cut the selected range into a
  // temporary clip when needed; otherwise hand the input straight to gifski.
  let gifskiInput = options.inputPath;
  let trimmedPath: string | undefined;

  try {
    if (options.shouldCrop) {
      trimmedPath = tempy.file({extension: 'mp4'});

      const trimProcessOptions: ProcessOptions = {
        onProgress: (progress, estimate) => {
          options.onProgress('Converting', progress, estimate);
        },
        startTime: options.startTime,
        endTime: options.endTime
      };

      const commonTrimArgs = conditionalArgs(
        '-i', options.inputPath,
        '-ss', options.startTime.toString(),
        '-to', options.endTime.toString(),
        '-an' // GIFs have no audio track
      );

      const trimProcess = convertWithHardwareFallback({
        outputPath: trimmedPath,
        processOptions: trimProcessOptions,
        encoder: 'h264_videotoolbox',
        hardwareArgs: [
          ...commonTrimArgs,
          ...getH264VideoToolboxArgs({
            width: makeEven(options.width),
            height: makeEven(options.height),
            fps
          }),
          trimmedPath
        ],
        softwareArgs: [
          ...commonTrimArgs,
          // Gifski re-quantizes to a 256-colour GIF, so the intermediate quality
          // barely matters — use the fastest x264 preset to keep the trim cheap.
          '-preset', 'ultrafast',
          '-crf', '18',
          trimmedPath
        ]
      });

      onCancel(() => {
        trimProcess.cancel();
      });

      await trimProcess;
      gifskiInput = trimmedPath;
    }

    // By default gifski downscales output to ~800x600 unless the target size is
    // set explicitly, so always pass the export dimensions through.
    const gifProcess = gifski(options.outputPath, {
      onProgress: (progress, estimate) => {
        // Distinct label from the ffmpeg trim ('Converting') above, matching the
        // old pipeline's 'Compressing' phase, so the bar doesn't reset under one
        // label.
        options.onProgress('Compressing', progress, estimate);
      }
    }, conditionalArgs(
      '--fps', fps.toString(),
      '--quality', useLossy ? '70' : '90',
      '--width', options.width.toString(),
      '--height', options.height.toString(),
      {args: ['--repeat', '-1'], if: !shouldLoop}, // -1 == no loop; gifski's default 0 == loop forever
      '-o', options.outputPath,
      gifskiInput
    ));

    onCancel(() => {
      gifProcess.cancel();
    });

    await gifProcess;

    return options.outputPath;
  } finally {
    // Remove the temporary trimmed clip (if any), whether the export succeeded,
    // failed, or was cancelled.
    if (trimmedPath) {
      fs.rmSync(trimmedPath, {force: true});
    }
  }
});

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertToMp4 = (options: ConvertOptions) => {
  const processOptions: ProcessOptions = {
    onProgress: (progress, estimate) => {
      options.onProgress('Converting', progress, estimate);
    },
    startTime: options.startTime,
    endTime: options.endTime
  };

  const evenWidth = makeEven(options.width);
  const evenHeight = makeEven(options.height);
  const tailArgs = conditionalArgs(
    {
      args: ['-an'],
      if: options.shouldMute
    },
    {
      args: [
        '-s',
        `${evenWidth}x${evenHeight}`,
        '-ss',
        options.startTime.toString(),
        '-to',
        options.endTime.toString()
      ],
      if: options.shouldCrop || !areDimensionsEven(options)
    },
    options.outputPath
  );

  return convertWithHardwareFallback({
    outputPath: options.outputPath,
    processOptions,
    encoder: 'h264_videotoolbox',
    hardwareArgs: [
      '-i', options.inputPath,
      '-r', options.fps.toString(),
      ...getH264VideoToolboxArgs({width: evenWidth, height: evenHeight, fps: options.fps}),
      ...tailArgs
    ],
    softwareArgs: [
      '-i', options.inputPath,
      '-r', options.fps.toString(),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      ...tailArgs
    ]
  });
};

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertToWebm = (options: ConvertOptions) => convert(options.outputPath, {
  onProgress: (progress, estimate) => {
    options.onProgress('Converting', progress, estimate);
  },
  startTime: options.startTime,
  endTime: options.endTime
}, conditionalArgs(
  '-i', options.inputPath,
  // http://wiki.webmproject.org/ffmpeg
  // https://trac.ffmpeg.org/wiki/Encode/VP9
  '-threads', Math.max(os.cpus().length - 1, 1).toString(),
  '-deadline', 'good', // `best` is twice as slow and only slighty better
  '-b:v', '1M', // Bitrate (same as the MP4)
  '-codec:v', 'vp9',
  '-codec:a', 'vorbis',
  '-ac', '2', // https://stackoverflow.com/questions/19004762/ffmpeg-covert-from-mp4-to-webm-only-working-on-some-files
  '-strict', '-2', // Needed because `vorbis` is experimental
  '-r', options.fps.toString(),
  {
    args: ['-an'],
    if: options.shouldMute
  },
  {
    args: [
      '-s',
      `${makeEven(options.width)}x${makeEven(options.height)}`,
      '-ss',
      options.startTime.toString(),
      '-to',
      options.endTime.toString()
    ],
    if: options.shouldCrop || !areDimensionsEven(options)
  },
  options.outputPath
));

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertToAv1 = (options: ConvertOptions) => convert(options.outputPath, {
  onProgress: (progress, estimate) => {
    options.onProgress('Converting', progress, estimate);
  },
  startTime: options.startTime,
  endTime: options.endTime
}, conditionalArgs(
  '-i', options.inputPath,
  '-r', options.fps.toString(),
  '-c:v', 'libaom-av1',
  '-c:a', 'libopus',
  '-crf', '34',
  '-b:v', '0',
  '-strict', 'experimental',
  // Enables row-based multi-threading which maximizes CPU usage
  // https://trac.ffmpeg.org/wiki/Encode/AV1
  '-cpu-used', '4',
  '-row-mt', '1',
  '-tiles', '2x2',
  {
    args: ['-an'],
    if: options.shouldMute
  },
  {
    args: [
      '-s',
      `${makeEven(options.width)}x${makeEven(options.height)}`,
      '-ss',
      options.startTime.toString(),
      '-to',
      options.endTime.toString()
    ],
    if: options.shouldCrop || !areDimensionsEven(options)
  },
  options.outputPath
));

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertToHevc = (options: ConvertOptions) => {
  const processOptions: ProcessOptions = {
    onProgress: (progress, estimate) => {
      options.onProgress('Converting', progress, estimate);
    },
    startTime: options.startTime,
    endTime: options.endTime
  };

  const evenWidth = makeEven(options.width);
  const evenHeight = makeEven(options.height);
  const tailArgs = conditionalArgs(
    '-c:a', 'libopus',
    {
      args: ['-an'],
      if: options.shouldMute
    },
    {
      args: [
        '-s',
        `${evenWidth}x${evenHeight}`,
        '-ss',
        options.startTime.toString(),
        '-to',
        options.endTime.toString()
      ],
      if: options.shouldCrop || !areDimensionsEven(options)
    },
    options.outputPath
  );

  return convertWithHardwareFallback({
    outputPath: options.outputPath,
    processOptions,
    encoder: 'hevc_videotoolbox',
    hardwareArgs: [
      '-i', options.inputPath,
      '-r', options.fps.toString(),
      ...getHevcVideoToolboxArgs({width: evenWidth, height: evenHeight, fps: options.fps}),
      ...tailArgs
    ],
    softwareArgs: [
      '-i', options.inputPath,
      '-r', options.fps.toString(),
      '-c:v', 'libx265',
      '-preset', 'medium',
      '-tag:v', 'hvc1', // Metadata for macOS
      ...tailArgs
    ]
  });
};

// eslint-disable-next-line @typescript-eslint/promise-function-async
const convertToApng = (options: ConvertOptions) => convert(options.outputPath, {
  onProgress: (progress, estimate) => {
    options.onProgress('Converting', progress, estimate);
  },
  startTime: options.startTime,
  endTime: options.endTime
}, conditionalArgs(
  '-i', options.inputPath,
  '-vf', `fps=${options.fps}${options.shouldCrop ? `,scale=${options.width}:${options.height}:flags=lanczos` : ''}`,
  // Strange for APNG instead of -loop it uses -plays see: https://stackoverflow.com/questions/43795518/using-ffmpeg-to-create-looping-apng
  '-plays', settings.get('loopExports') ? '0' : '1', // 0 == forever; 1 == no loop
  {
    args: ['-an'],
    if: options.shouldMute
  },
  {
    args: [
      '-ss',
      options.startTime.toString(),
      '-to',
      options.endTime.toString()
    ],
    if: options.shouldCrop
  },
  options.outputPath
));

// eslint-disable-next-line @typescript-eslint/promise-function-async
export const crop = (options: ConvertOptions) => {
  const processOptions: ProcessOptions = {
    onProgress: (progress, estimate) => {
      options.onProgress('Cropping', progress, estimate);
    },
    startTime: options.startTime,
    endTime: options.endTime
  };

  const evenWidth = makeEven(options.width);
  const evenHeight = makeEven(options.height);
  const cropTailArgs = [
    '-s', `${evenWidth}x${evenHeight}`,
    '-ss', options.startTime.toString(),
    '-to', options.endTime.toString(),
    options.outputPath
  ];

  return convertWithHardwareFallback({
    outputPath: options.outputPath,
    processOptions,
    encoder: 'h264_videotoolbox',
    hardwareArgs: [
      '-i', options.inputPath,
      ...getH264VideoToolboxArgs({width: evenWidth, height: evenHeight, fps: options.fps}),
      ...cropTailArgs
    ],
    softwareArgs: [
      '-i', options.inputPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      ...cropTailArgs
    ]
  });
};

export default new Map([
  [Format.gif, convertToGif],
  [Format.mp4, convertToMp4],
  [Format.hevc, convertToHevc],
  [Format.webm, convertToWebm],
  [Format.apng, convertToApng],
  [Format.av1, convertToAv1]
]);
