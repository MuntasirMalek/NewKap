import {windowManager} from './windows/manager';
import {setRecordingTray, setPausedTray, setStartingTray, resetTray} from './tray';
import {setCropperShortcutAction} from './global-accelerators';
import {settings} from './common/settings';
import {track} from './common/analytics';
import {plugins} from './plugins';
import {getAudioDevices, getCachedAudioDeviceId} from './utils/devices';
import {showError} from './utils/errors';
import {RecordServiceContext, RecordServiceState} from './plugins/service-context';
import {setCurrentRecording, updatePluginState, stopCurrentRecording} from './recording-history';
import {Recording} from './video';
import {ApertureOptions, Encoding, StartRecordingOptions} from './common/types';
import {InstalledPlugin} from './plugins/plugin';
import {RecordService, RecordServiceHook} from './plugins/service';
import {getCurrentDurationStart, getOverallDuration, setCurrentDurationStart, setOverallDuration} from './utils/track-duration';

const createAperture = require('aperture');
let aperture = createAperture();
const MAX_RECORDING_RETRIES = 2;
const recordingCodecs = {
  standard: Encoding.h264,
  high: Encoding.hevc,
  maximum: Encoding.proRes422
};

let recordingPlugins: Array<{plugin: InstalledPlugin; service: RecordService}> = [];
const serviceState = new Map<string, RecordServiceState>();
let apertureOptions: ApertureOptions;
let recordingName: string | undefined;
let past: number | undefined;

export const isPast = () => Boolean(past);

const setRecordingName = (name: string) => {
  recordingName = name;
};

const serializeEditPluginState = () => {
  const result: Record<string, Record<string, Record<string, unknown> | undefined>> = {};

  for (const {plugin, service} of recordingPlugins) {
    if (!result[plugin.name]) {
      result[plugin.name] = {};
    }

    result[plugin.name][service.title] = serviceState.get(service.title)?.persistedState;
  }

  return result;
};

const callPlugins = async (method: RecordServiceHook) => Promise.all(recordingPlugins.map(async ({plugin, service}) => {
  if (service[method] && typeof service[method] === 'function') {
    try {
      await service[method]?.(
        new RecordServiceContext({
          plugin,
          apertureOptions,
          state: serviceState.get(service.title) ?? {},
          setRecordingName
        })
      );
    } catch (error) {
      showError(error as any, {title: `Something went wrong while using the plugin \u201C${plugin.prettyName}\u201D`, plugin});
    }
  }
}));

const cleanup = async () => {
  windowManager.cropper?.close();
  resetTray();

  await callPlugins('didStopRecording');
  serviceState.clear();

  setCropperShortcutAction();
};

export const startRecording = async (options: StartRecordingOptions) => {
  if (past) {
    return;
  }

  past = Date.now();
  recordingName = undefined;

  windowManager.preferences?.close();
  windowManager.cropper?.disable();

  // Use starting tray state instead of disabling tray completely
  setStartingTray();

  const {cropperBounds, screenBounds, displayId} = options;

  cropperBounds.y = screenBounds.height - (cropperBounds.y + cropperBounds.height);

  const {
    record60fps,
    showCursor,
    highlightClicks,
    recordAudio,
    recordingQuality
  } = settings.store;

  const requestedCodec = recordingCodecs[recordingQuality];
  const videoCodec = createAperture.videoCodecs.has(requestedCodec) ? requestedCodec : Encoding.h264;

  apertureOptions = {
    fps: record60fps ? 60 : 30,
    cropArea: cropperBounds,
    showCursor,
    highlightClicks,
    screenId: displayId,
    videoCodec
  };

  if (recordAudio) {
    // Use cached audio device ID to avoid synchronous blocking
    const audioInputDeviceId = getCachedAudioDeviceId();
    if (audioInputDeviceId) {
      apertureOptions.audioDeviceId = audioInputDeviceId;
    } else {
      const [defaultAudioDevice] = await getAudioDevices();
      apertureOptions.audioDeviceId = defaultAudioDevice?.id;
    }
  }

  console.log(`Collected settings after ${(Date.now() - past) / 1000}s`);

  recordingPlugins = plugins
    .recordingPlugins
    .flatMap(
      plugin => {
        const {validServices} = plugin.config;
        return plugin.recordServicesWithStatus
          .filter(({title, isEnabled}) => isEnabled && validServices.includes(title))
          .map(service => ({plugin, service}));
      }
    );

  for (const {service, plugin} of recordingPlugins) {
    serviceState.set(service.title, {persistedState: {}});
    track(`plugins/used/record/${plugin.name}`);
  }

  await callPlugins('willStartRecording');

  let lastError: any;
  for (let attempt = 1; attempt <= MAX_RECORDING_RETRIES; attempt++) {
    try {
      const filePath = await aperture.startRecording(apertureOptions);
      setOverallDuration(0);
      setCurrentDurationStart(Date.now());

      setCurrentRecording({
        filePath,
        name: recordingName,
        apertureOptions,
        plugins: serializeEditPluginState()
      });
      lastError = undefined;
      break;
    } catch (error: any) {
      lastError = error;
      if (error?.code === 'RECORDER_TIMEOUT' && attempt < MAX_RECORDING_RETRIES) {
        console.log(`Recording attempt ${attempt} timed out, retrying...`);
        aperture = createAperture();
        continue;
      }
    }
  }

  if (lastError) {
    track('recording/stopped/error');
    showError(lastError, {title: 'Recording error', plugin: undefined});
    past = undefined;
    cleanup();
    return;
  }

  const startTime = (Date.now() - past) / 1000;
  if (startTime > 3) {
    track(`recording/started/${startTime}`);
  } else {
    track('recording/started');
  }

  console.log(`Started recording after ${startTime}s`);
  windowManager.cropper?.setRecording();
  setRecordingTray();
  setCropperShortcutAction(stopRecording);
  past = Date.now();

  aperture.recorder.catch((error: any) => {
    if (past) {
      track('recording/stopped/error');
      showError(error, {title: 'Recording error', plugin: undefined});
      past = undefined;
      cleanup();
    }
  });

  await callPlugins('didStartRecording');
  updatePluginState(serializeEditPluginState());
};

export const stopRecording = async () => {
  if (!past) {
    return;
  }

  console.log(`Stopped recording after ${(Date.now() - past) / 1000}s`);
  past = undefined;

  let filePath;

  try {
    filePath = await aperture.stopRecording();
    setOverallDuration(0);
    setCurrentDurationStart(0);
  } catch (error) {
    track('recording/stopped/error');
    showError(error as any, {title: 'Recording error', plugin: undefined});
    cleanup();
    return;
  }

  try {
    cleanup();
  } finally {
    track('editor/opened/recording');

    const recording = new Recording({
      filePath,
      title: recordingName,
      apertureOptions
    });
    await recording.openEditorWindow();

    stopCurrentRecording(recordingName);
  }
};

export const stopRecordingWithNoEdit = async () => {
  if (!past) {
    return;
  }

  console.log(`Stopped recording after ${(Date.now() - past) / 1000}s`);
  past = undefined;

  try {
    await Promise.race([
      aperture.stopRecording(),
      new Promise((resolve, reject) => {
        void resolve;
        setTimeout(() => {
          reject(new Error('Stop recording timed out'));
        }, 5000);
      })
    ]);
    setOverallDuration(0);
    setCurrentDurationStart(0);
  } catch (error) {
    console.error('Error stopping recording:', error);
    cleanup();
    return;
  }

  try {
    cleanup();
  } finally {
    track('recording/quit');
    stopCurrentRecording(recordingName);
  }
};

export const pauseRecording = async () => {
  if (!past) {
    return;
  }

  try {
    const isPaused = await aperture.isPaused();
    if (isPaused) {
      return;
    }

    await aperture.pause();
    setOverallDuration(getOverallDuration() + (Date.now() - getCurrentDurationStart()));
    setCurrentDurationStart(0);
    setPausedTray();
    track('recording/paused');
    console.log(`Paused recording after ${(Date.now() - past) / 1000}s`);
  } catch (error) {
    track('recording/paused/error');
    showError(error as any, {title: 'Recording error', plugin: undefined});
    cleanup();
  }
};

export const resumeRecording = async () => {
  if (!past) {
    return;
  }

  try {
    const isPaused = await aperture.isPaused();
    if (!isPaused) {
      return;
    }

    await aperture.resume();
    setCurrentDurationStart(Date.now());
    setRecordingTray();
    track('recording/resumed');
    console.log(`Resume recording after ${(Date.now() - past) / 1000}s`);
  } catch (error) {
    track('recording/resumed/error');
    showError(error as any, {title: 'Recording error', plugin: undefined});
    cleanup();
  }
};
