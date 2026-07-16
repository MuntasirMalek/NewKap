'use strict';

import {Tray, Menu} from 'electron';
import {KeyboardEvent} from 'electron/main';
import path from 'path';
import {buildBasicCogMenu, getCogMenuAsync} from './menus/cog';
import {getRecordMenuTemplate} from './menus/record';
import {track} from './common/analytics';
import {openFiles} from './utils/open-files';
import {windowManager} from './windows/manager';
import {pauseRecording, resumeRecording, stopRecording} from './aperture';
import {settings} from './common/settings';
import {recordingHistory} from './recording-history';

let tray: Tray;
let trayAnimation: NodeJS.Timeout | undefined;
let cachedCogMenu: Menu;
let unsubscribeFromSettings: (() => void) | undefined;
let unsubscribeFromHistory: (() => void) | undefined;

const refreshCogMenu = async () => {
  try {
    cachedCogMenu = await getCogMenuAsync();
  } catch (error) {
    console.error('[tray] failed to refresh menu', error);
  }
};

const openCropperWindow = async () => {
  const openPromise = windowManager.cropper?.open();
  if (!openPromise) {
    console.error('[tray] cropper manager is not registered');
    return;
  }

  try {
    await openPromise;
  } catch (error) {
    console.error('[tray] failed to open cropper', error);
  }
};

const openContextMenu = () => {
  if (cachedCogMenu) {
    tray.popUpContextMenu(cachedCogMenu);
  }

  refreshCogMenu();
};

const openRecordingContextMenu = () => {
  tray.popUpContextMenu(Menu.buildFromTemplate(getRecordMenuTemplate(false)));
};

const openPausedContextMenu = () => {
  tray.popUpContextMenu(Menu.buildFromTemplate(getRecordMenuTemplate(true)));
};

export const initializeTray = (existingTray?: Tray) => {
  tray = existingTray ? existingTray : new Tray(path.join(__dirname, '..', 'static', 'menubarDefaultTemplate.png'));

  cachedCogMenu = Menu.buildFromTemplate(buildBasicCogMenu());

  tray.on('click', openCropperWindow);
  tray.on('right-click', openContextMenu);
  tray.on('drop-files', (_, files) => {
    track('editor/opened/tray');
    openFiles(...files);
  });

  refreshCogMenu();

  unsubscribeFromSettings?.();
  unsubscribeFromSettings = settings.onDidAnyChange(refreshCogMenu);
  unsubscribeFromHistory?.();
  unsubscribeFromHistory = recordingHistory.onDidChange('recordings', refreshCogMenu);

  return tray;
};

export const setStartingTray = () => {
  if (trayAnimation) {
    clearTimeout(trayAnimation);
  }

  tray.setImage(path.join(__dirname, '..', 'static', 'menubarDefaultTemplate.png'));
  tray.removeAllListeners('click');
  tray.removeAllListeners('right-click');
};

export const disableTray = () => {
  tray.removeListener('click', openCropperWindow);
  tray.removeListener('right-click', openContextMenu);
};

export const resetTray = () => {
  if (trayAnimation) {
    clearTimeout(trayAnimation);
  }

  tray.removeAllListeners('click');
  tray.removeAllListeners('right-click');

  tray.setImage(path.join(__dirname, '..', 'static', 'menubarDefaultTemplate.png'));
  tray.on('click', openCropperWindow);
  tray.on('right-click', openContextMenu);
  refreshCogMenu();
};

export const setRecordingTray = () => {
  animateIcon();

  tray.removeAllListeners('right-click');

  tray.once('click', onRecordingTrayClick);
  tray.on('right-click', openRecordingContextMenu);
};

export const setPausedTray = () => {
  if (trayAnimation) {
    clearTimeout(trayAnimation);
  }

  tray.removeAllListeners('right-click');

  tray.setImage(path.join(__dirname, '..', 'static', 'pauseTemplate.png'));
  tray.once('click', resumeRecording);
  tray.on('right-click', openPausedContextMenu);
};

const onRecordingTrayClick = (event: KeyboardEvent) => {
  if (event.altKey) {
    pauseRecording();
    return;
  }

  stopRecording();
};

const animateIcon = async () => new Promise<void>(resolve => {
  const interval = 20;
  let i = 0;

  const next = () => {
    trayAnimation = setTimeout(() => {
      const number = String(i++).padStart(5, '0');
      const filename = `loading_${number}Template.png`;

      try {
        tray.setImage(path.join(__dirname, '..', 'static', 'menubar-loading', filename));
        next();
      } catch {
        trayAnimation = undefined;
        resolve();
      }
    }, interval);
  };

  next();
});
