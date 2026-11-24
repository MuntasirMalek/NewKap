import ffmpeg from 'ffmpeg-static';
import util from 'electron-util';

if (!ffmpeg) {
  throw new Error('FFmpeg binary not found for this platform/architecture');
}

const ffmpegPath = util.fixPathForAsarUnpack(ffmpeg);

export default ffmpegPath;
