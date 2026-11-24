import {screen} from 'electron';
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

// Start full-screen recording directly without opening the cropper window
const handleRecordFullScreen = async () => {
  try {
    // Close cropper if it's open
    windowManager.cropper?.close();

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const {width, height} = display.bounds;

    const {startRecording} = require('../aperture');
    const started = await startRecording({
      cropperBounds: {x: 0, y: 0, width, height},
      screenBounds: {width, height},
      displayId: display.id
    });

    if (started) {
      console.log(`Full-screen recording started on display ${display.id} (${width}x${height})`);
    }
  } catch (error) {
    console.error('Failed to start full-screen recording:', error);
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
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    console.error(`Invalid deep link URL "${url}":`, error);
    return;
  }

  const {host, pathname} = parsedUrl;

  if (routes.has(host)) {
    return routes.get(host)?.(pathname.slice(1));
  }

  console.error(`Route not recognized: ${host} (${url}).`);
};
