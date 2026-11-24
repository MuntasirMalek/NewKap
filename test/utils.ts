import test from 'ava';
import macosRelease from '../main/utils/macos-release';
import {extractProgressFromStderr} from '../main/converters/utils';
import {
  getH264VideoToolboxArgs,
  getHevcVideoToolboxArgs,
  hasHardwareEncoder
} from '../main/utils/video-encoder';

test('`macosRelease()` identifies modern macOS versions', t => {
  t.deepEqual(macosRelease('23.4.0'), {name: 'Sonoma', version: '14'});
  t.deepEqual(macosRelease('24.5.0'), {name: 'Sequoia', version: '15'});
  t.deepEqual(macosRelease('25.1.0'), {name: 'Tahoe', version: '26'});
  t.deepEqual(macosRelease('26.0.0'), {name: 'macOS 27', version: '27'});

  const future = macosRelease('99.0.0');
  t.is(future.name, 'macOS');
  t.truthy(future.version);
});

test('`extractProgressFromStderr()` guards against zero duration and clamps progress', t => {
  const sample = 'frame=  120 fps=30 q=-0.0 size=100kB time=00:00:04.00 bitrate=200kbits/s speed=2.0x';

  t.is(extractProgressFromStderr(sample, Date.now(), 0), undefined);

  const clamped = extractProgressFromStderr(sample, Date.now(), 2000);
  t.truthy(clamped);
  t.is(clamped?.progress, 1);

  const halfway = extractProgressFromStderr(sample, Date.now(), 8000);
  t.truthy(halfway);
  t.is(halfway?.progress, 0.5);
  t.truthy(halfway?.estimate);
});

test('VideoToolbox hardware encoders are detected on macOS and produce valid args', async t => {
  if (process.platform !== 'darwin') {
    t.pass();
    return;
  }

  t.true(await hasHardwareEncoder('h264_videotoolbox'));
  t.true(await hasHardwareEncoder('hevc_videotoolbox'));

  const h264Args = getH264VideoToolboxArgs({width: 1280, height: 720, fps: 30});
  t.true(h264Args.includes('h264_videotoolbox'));
  t.true(h264Args.includes('-pix_fmt'));

  const hevcArgs = getHevcVideoToolboxArgs({width: 1280, height: 720, fps: 30});
  t.true(hevcArgs.includes('hevc_videotoolbox'));
  t.true(hevcArgs.includes('hvc1'));
});
