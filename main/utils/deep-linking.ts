import {screen, dialog, shell} from 'electron';
import {windowManager} from '../windows/manager';

const pluginPromises = new Map<string, (path: string) => void>();

const handlePluginsDeepLink = (path: string) => {
  const [plugin, ...rest] = path.split('/');

  if (pluginPromises.has(plugin)) {
    pluginPromises.get(plugin)?.(rest.join('/'));
    pluginPromises.delete(plugin);
    return;
  }

  console.error(`Received link for plugin "${plugin}" but there was no registered listener.`);
};

export const addPluginPromise = (plugin: string, resolveFunction: (path: string) => void) => {
  pluginPromises.set(plugin, resolveFunction);
};

const triggerPluginAction = (action: string) => (name: string) => windowManager.preferences?.open({target: {name, action}});

const showPermissionError = async () => {
  const {response} = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Open System Settings', 'OK'],
    defaultId: 0,
    message: 'Screen Recording permission required',
    detail: 'Kap needs Screen Recording permission.\n\n' +
      '1. Open System Settings > Privacy & Security > Screen Recording\n' +
      '2. Toggle Kap ON\n' +
      '3. Quit and relaunch Kap'
  });

  if (response === 0) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
};

// Start full-screen  no cropper windowrecording
const handleRecordFullScreen = async () => {
  try {
    // Close cropper if it's open
    windowManager.cropper?.close();

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const {width, height} = display.bounds;

    const {startRecording} = require('../aperture');
    await startRecording({
      cropperBounds: {x: 0, y: 0, width, height},
      screenBounds: {width, height},
      displayId: display.id
    });

    console.log(`Full-screen recording started on display ${display.id} (${width}x${height})`);
  } catch (error: any) {
    console.error('Failed to start full-screen recording:', error);
    const errorString = String(error?.message || error);
    if (errorString.includes('Cannot Record') || errorString.includes('-11805') || errorString.includes('not authorized')) {
      await showPermissionError();
    }
  }
};

// Stop recording
const handleStopRecording = async () => {
  try {
    const {stopRecording} = require('../aperture');
    await stopRecording();
  } catch (error) {
    console.error('Failed to stop recording:', error);
  }
};

const routes = new Map<string, (path: string) => void | Promise<void>>([
  ['plugins', handlePluginsDeepLink],
  ['install-plugin', triggerPluginAction('install')],
  ['configure-plugin', triggerPluginAction('configure')],
  ['record', handleRecordFullScreen as any],
  ['stop', handleStopRecording as any]
]);

export const handleDeepLink = (url: string) => {
  const {host, pathname} = new URL(url);

  if (routes.has(host)) {
    return routes.get(host)?.(pathname.slice(1));
  }

  console.error(`Route not recognized: ${host} (${url}).`);
};
