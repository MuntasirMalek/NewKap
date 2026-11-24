import {systemPreferences, shell, dialog, app} from 'electron';
const {ensureDockIsShowing} = require('../utils/dock');

// Safe wrapper for mac-screen-capture-permissions
let hasScreenCapturePermission: () => boolean;
let hasPromptedForPermission: () => boolean;

try {
  const macPerms = require('mac-screen-capture-permissions');
  hasScreenCapturePermission = macPerms.hasScreenCapturePermission;
  hasPromptedForPermission = macPerms.hasPromptedForPermission;
} catch (error) {
  console.error('mac-screen-capture-permissions failed to load:', error);
  // On failure, assume permission granted and let aperture surface any capture error
  hasScreenCapturePermission = () => true;
  hasPromptedForPermission = () => true;
}

let isDialogShowing = false;

const getSystemSettingsUrl = (privacySection: string) =>
  `x-apple.systempreferences:com.apple.preference.security?${privacySection}`;

const promptSystemPreferences = (options: {message: string; detail: string; systemPreferencesPath: string}) => async ({hasAsked}: {hasAsked?: boolean} = {}) => {
  if (hasAsked || isDialogShowing) {
    return false;
  }

  isDialogShowing = true;
  try {
    await ensureDockIsShowing(async () => {
      const {response} = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Open System Settings', 'Cancel'],
        defaultId: 0,
        message: options.message,
        detail: options.detail,
        cancelId: 1
      });

      if (response === 0) {
        await openSystemPreferences(options.systemPreferencesPath);
        app.quit();
      }
    });
  } finally {
    isDialogShowing = false;
  }

  return false;
};

export const openSystemPreferences = async (path: string) => shell.openExternal(getSystemSettingsUrl(path));

// Microphone

const getMicrophoneAccess = () => systemPreferences.getMediaAccessStatus('microphone');

const microphoneFallback = promptSystemPreferences({
  message: 'NewKap cannot access the microphone.',
  detail: 'NewKap requires microphone access to be able to record audio. You can grant this in System Settings → Privacy & Security → Microphone. Afterwards, relaunch NewKap.',
  systemPreferencesPath: 'Privacy_Microphone'
});

export const ensureMicrophonePermissions = async (fallback = microphoneFallback) => {
  const access = getMicrophoneAccess();

  if (access === 'granted') {
    return true;
  }

  if (access !== 'denied') {
    const granted = await systemPreferences.askForMediaAccess('microphone');

    if (granted) {
      return true;
    }

    return fallback({hasAsked: true});
  }

  return fallback();
};

export const hasMicrophoneAccess = () => getMicrophoneAccess() === 'granted';

// Screen Capture (10.15 and newer)

const screenCaptureFallback = promptSystemPreferences({
  message: 'NewKap cannot record the screen.',
  detail: 'NewKap requires screen capture access to be able to record the screen. You can grant this in System Settings → Privacy & Security → Screen Recording. Afterwards, relaunch NewKap.',
  systemPreferencesPath: 'Privacy_ScreenCapture'
});

export const ensureScreenCapturePermissions = (fallback = screenCaptureFallback) => {
  try {
    const hadAsked = hasPromptedForPermission();
    const hasAccess = hasScreenCapturePermission();

    if (hasAccess) {
      return true;
    }

    fallback({hasAsked: !hadAsked});
    return false;
  } catch (error) {
    console.error('Screen capture permission check failed:', error);
    // On failure, show the permission prompt rather than silently failing
    fallback({hasAsked: false});
    return false;
  }
};

export const hasScreenCaptureAccess = () => {
  try {
    return hasScreenCapturePermission();
  } catch {
    return false;
  }
};
