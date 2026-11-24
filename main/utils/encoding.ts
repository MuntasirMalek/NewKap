/* eslint-disable array-element-newline */

import fs from 'fs';
import path from 'path';
import execa from 'execa';
import tempy from 'tempy';
import {track} from '../common/analytics';
import ffmpegPath from './ffmpeg-path';
import {getH264VideoToolboxArgs, hasHardwareEncoder} from './video-encoder';

export const getEncoding = async (filePath: string) => {
  try {
    await execa(ffmpegPath, ['-i', filePath]);
    return undefined;
  } catch (error) {
    return /.*: Video: (.*?) \(.*/.exec((error as any)?.stderr)?.[1];
  }
};

// `ffmpeg -i original.mp4 -vcodec libx264 -crf 27 -preset veryfast -c:a copy output.mp4`
export const convertToH264 = async (inputPath: string) => {
  const outputPath = tempy.file({extension: path.extname(inputPath)});

  track('encoding/converted/hevc');

  if (await hasHardwareEncoder('h264_videotoolbox')) {
    try {
      await execa(ffmpegPath, [
        '-i', inputPath,
        ...getH264VideoToolboxArgs(),
        '-c:a', 'copy',
        outputPath
      ]);

      return outputPath;
    } catch (error) {
      console.warn('Hardware H.264 preview conversion failed, falling back to libx264:', error);
      fs.rmSync(outputPath, {force: true});
    }
  }

  await execa(ffmpegPath, [
    '-i', inputPath,
    '-vcodec', 'libx264',
    '-crf', '27',
    '-preset', 'veryfast',
    '-c:a', 'copy',
    outputPath
  ]);

  return outputPath;
};
