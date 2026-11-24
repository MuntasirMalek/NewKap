import {windowManager} from './windows/manager';
import {setRecordingTray, setPausedTray, disableTray, resetTray} from './tray';
import {setCropperShortcutAction} from './global-accelerators';
import {settings} from './common/settings';
import {track} from './common/analytics';
import {plugins} from './plugins';
import {getAudioDevices, getSelectedInputDeviceId} from './utils/devices';
import {showError} from './utils/errors';
import {RecordServiceContext, RecordServiceState} from './plugins/service-context';
import {setCurrentRecording, updatePluginState, stopCurrentRecording} from './recording-history';
import {Recording} from './video';
import {ApertureOptions, StartRecordingOptions} from './common/types';
import {InstalledPlugin} from './plugins/plugin';
import {RecordService, RecordServiceHook} from './plugins/service';
import {getCurrentDurationStart, getOverallDuration, setCurrentDurationStart, setOverallDuration} from './utils/track-duration';

const createAperture = require('aperture');
let aperture = createAperture();
const MAX_RECORDING_RETRIES = 2;

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
      showError(error as any, {title: `Something went wrong while using the plugin “${plugin.prettyName}”`, plugin});
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
  disableTray();

  const {cropperBounds, screenBounds, displayId} = options;

  const cropArea = {
    ...cropperBounds,
    y: screenBounds.height - (cropperBounds.y + cropperBounds.height)
  };

  const {
    record60fps,
    showCursor,
    highlightClicks,
    recordAudio
  } = settings.store;

  apertureOptions = {
    fps: record60fps ? 60 : 30,
    cropArea,
    showCursor,
    highlightClicks,
    screenId: displayId
  };

  if (recordAudio) {
    // In case for some reason the default audio device is not set
    // use the first available device for recording
    const audioInputDeviceId = getSelectedInputDeviceId();
    if (audioInputDeviceId) {
      apertureOptions.audioDeviceId = audioInputDeviceId;
    } else {
      const [defaultAudioDevice] = await getAudioDevices();
      apertureOptions.audioDeviceId = defaultAudioDevice?.id;
    }
  }

  // TODO: figure out how to correctly process hevc videos with ffmpeg
  // if (recordHevc) {
  //   apertureOptions.videoCodec = 'hevc';
  // }

  console.log(`Collected settings after ${(Date.now() - past) / 1000}s`);

  recordingPlugins = plugins
    .recordingPlugins
    .flatMap(
      plugin => {
        const validServices = plugin.config.validServices;
        return plugin.recordServicesWithStatus
          // Make sure service is valid and enabled
          .filter(({title, isEnabled}) => isEnabled && validServices.includes(title))
          .map(service => ({plugin, service}));
      }
    );

  for (const {service, plugin} of recordingPlugins) {
    serviceState.set(service.title, {persistedState: {}});
    track(`plugins/used/record/${plugin.name}`);
  }

  await callPlugins('willStartRecording');

  // Retry logic for aperture timeout on macOS Sonoma+
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
        // Reset aperture instance for retry
        aperture = createAperture();
        continue;
      }

      break;
    }
  }

  if (lastError) {
    track('recording/stopped/error');
    const errorMessage = String(lastError?.message ?? lastError);
    const isPermissionOrCaptureError = errorMessage.includes('-11805') || errorMessage.includes('Cannot Record');
    const errorTitle = isPermissionOrCaptureError ?
      'Recording error — check Screen Recording permissions in System Settings and relaunch NewKap' :
      'Recording error';
    showError(lastError, {title: errorTitle, plugin: undefined});
    past = undefined;
    await cleanup();
    return false;
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

  // Track aperture errors after recording has started, to avoid kap freezing if something goes wrong
  aperture.recorder.catch((error: any) => {
    // Make sure it doesn't catch the error of ending the recording
    if (past) {
      track('recording/stopped/error');
      showError(error, {title: 'Recording error', plugin: undefined});
      past = undefined;
      cleanup();
    }
  });

  await callPlugins('didStartRecording');
  updatePluginState(serializeEditPluginState());
  return true;
};

export const stopRecording = async () => {
  // Ensure we only stop recording once
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
  // Ensure we only stop recording once
  if (!past) {
    return;
  }

  console.log(`Stopped recording after ${(Date.now() - past) / 1000}s`);
  past = undefined;

  try {
    // Add timeout to prevent hanging on quit
    await Promise.race([
      aperture.stopRecording(),
      new Promise<void>((resolve, reject) => {
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
    await cleanup();
    return;
  }

  try {
    await cleanup();
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
    past = undefined;
    await cleanup();
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
    past = undefined;
    await cleanup();
  }
};
