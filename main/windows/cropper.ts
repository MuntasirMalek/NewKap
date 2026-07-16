import {windowManager} from './manager';
import {BrowserWindow, systemPreferences, dialog, screen, Display, app, globalShortcut, ipcMain} from 'electron';
import {enable as enableRemote} from '@electron/remote/main';

import {settings} from '../common/settings';
import {hasMicrophoneAccess, ensureMicrophonePermissions, openSystemPreferences, ensureScreenCapturePermissions} from '../common/system-permissions';
import {loadRoute} from '../utils/routes';
import {MacWindow} from '../utils/windows';
const croppers = new Map<number, BrowserWindow>();
const readyCroppers = new Set<number>();
let notificationId: number | undefined;
let isOpen = false;
let openingPromise: Promise<void> | undefined;
let isDestroying = false;
let closeShortcutsRegistered = false;
let openSessionId = 0;

const closeShortcutAccelerators = ['Escape'];

const unregisterCloseShortcuts = () => {
  if (!closeShortcutsRegistered) {
    return;
  }

  for (const accelerator of closeShortcutAccelerators) {
    if (globalShortcut.isRegistered(accelerator)) {
      globalShortcut.unregister(accelerator);
    }
  }

  closeShortcutsRegistered = false;
};

const registerCloseShortcuts = () => {
  if (closeShortcutsRegistered) {
    return;
  }

  for (const accelerator of closeShortcutAccelerators) {
    try {
      globalShortcut.register(accelerator, closeAllCroppers);
    } catch (error) {
      console.error('Error registering cropper close shortcut', accelerator, error);
    }
  }

  closeShortcutsRegistered = true;
};

const createCropper = (display: Display, activeDisplayId?: number, sessionId = openSessionId): BrowserWindow => {
  const {id, bounds} = display;
  const {x, y, width, height} = bounds;

  const cropper = new BrowserWindow({
    x,
    y,
    width,
    height,
    hasShadow: false,
    enableLargerThanScreen: true,
    resizable: false,
    movable: false,
    frame: false,
    transparent: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    } as any
  });
  enableRemote(cropper.webContents);
  cropper.setIgnoreMouseEvents(true);

  loadRoute(cropper, 'cropper').catch(error => {
    console.error('[cropper] failed to load renderer route', error);
    closeAllCroppers();
  });

  cropper.setAlwaysOnTop(true, 'screen-saver', 1);

  cropper.webContents.on('did-finish-load', () => {
    readyCroppers.add(cropper.id);
    sendDisplayInfo(cropper, display, activeDisplayId, sessionId);
  });

  cropper.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      closeAllCroppers();
    }
  });

  cropper.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[cropper] renderer failed to load', {errorCode, errorDescription, validatedURL});
    closeAllCroppers();
  });

  cropper.webContents.on('render-process-gone', (_event, details) => {
    console.error('[cropper] render process gone', details);
    closeAllCroppers();
  });

  cropper.webContents.on('unresponsive', () => {
    console.error('[cropper] webContents became unresponsive');
    closeAllCroppers();
  });

  cropper.on('unresponsive', () => {
    console.error('[cropper] window became unresponsive');
    closeAllCroppers();
  });

  cropper.on('close', event => {
    if (isDestroying) {
      return;
    }

    event.preventDefault();
    closeAllCroppers();
  });

  cropper.on('closed', () => {
    if (croppers.has(id)) {
      croppers.delete(id);
    }

    readyCroppers.delete(cropper.id);
  });

  croppers.set(id, cropper);
  return cropper;
};

const closeAllCroppers = () => {
  console.log('[cropper] cleanup windows', {sessionId: openSessionId});
  screen.removeAllListeners('display-removed');
  screen.removeAllListeners('display-added');
  unregisterCloseShortcuts();

  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.setIgnoreMouseEvents(true);
      cropper.setVisibleOnAllWorkspaces(false);
      cropper.webContents.send('hide');
      cropper.hide();
    }
  }

  isOpen = false;

  if (notificationId !== undefined) {
    systemPreferences.unsubscribeWorkspaceNotification(notificationId);
    notificationId = undefined;
  }
};

const destroyAllCroppers = () => {
  console.log('[cropper] cleanup destroy windows', {sessionId: openSessionId});
  isDestroying = true;
  screen.removeAllListeners('display-removed');
  screen.removeAllListeners('display-added');
  unregisterCloseShortcuts();

  for (const [id, cropper] of croppers) {
    cropper.destroy();
    croppers.delete(id);
    readyCroppers.delete(cropper.id);
  }

  isOpen = false;
};

const sendDisplayInfo = (cropper: BrowserWindow, display: Display, activeDisplayId?: number, sessionId = openSessionId) => {
  const {id, bounds} = display;
  const {x, y, width, height} = bounds;
  const isActive = activeDisplayId === id;

  const displayInfo: any = {
    isActive,
    sessionId,
    id,
    x,
    y,
    width,
    height
  };

  if (isActive) {
    const savedCropper = settings.get('cropper', {});
    if ((savedCropper as any).displayId === id) {
      displayInfo.cropper = savedCropper;
    }
  }

  cropper.webContents.send('display', displayInfo);
};

const waitForCropperReady = async (cropper: BrowserWindow): Promise<void> => {
  if (readyCroppers.has(cropper.id)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Cropper window ${cropper.id} did not finish loading within 10 seconds`));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      cropper.webContents.removeListener('did-finish-load', handleReady);
      cropper.webContents.removeListener('did-fail-load', handleFailure);
      cropper.webContents.removeListener('render-process-gone', handleGone);
    };

    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleFailure = (_event: Electron.Event, errorCode: number, errorDescription: string) => {
      cleanup();
      reject(new Error(`Cropper window ${cropper.id} failed to load (${errorCode}): ${errorDescription}`));
    };

    const handleGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      cleanup();
      reject(new Error(`Cropper window ${cropper.id} renderer exited: ${details.reason}`));
    };

    cropper.webContents.once('did-finish-load', handleReady);
    cropper.webContents.once('did-fail-load', handleFailure);
    cropper.webContents.once('render-process-gone', handleGone);
  });
};

const ensureCroppers = async (activeDisplayId: number, sessionId: number): Promise<void> => {
  const displays = screen.getAllDisplays();
  const currentDisplayIds = new Set(displays.map(d => d.id));

  for (const [displayId, cropper] of croppers) {
    if (!currentDisplayIds.has(displayId)) {
      cropper.removeAllListeners('close');
      cropper.removeAllListeners('closed');
      cropper.destroy();
      croppers.delete(displayId);
      readyCroppers.delete(cropper.id);
    }
  }

  const newCropperPromises: Array<Promise<void>> = [];

  for (const display of displays) {
    const existing = croppers.get(display.id);

    if (existing && !existing.isDestroyed()) {
      if (readyCroppers.has(existing.id)) {
        sendDisplayInfo(existing, display, activeDisplayId, sessionId);
      }
    } else {
      const cropper = createCropper(display, activeDisplayId, sessionId);
      newCropperPromises.push(waitForCropperReady(cropper));
    }
  }

  if (newCropperPromises.length > 0) {
    await Promise.all(newCropperPromises);
  }
};

const openCropperWindow = async () => {
  if (openingPromise) {
    return openingPromise;
  }

  openingPromise = (async () => {
    try {
      if (isOpen) {
        closeAllCroppers();
        return;
      }

      if (windowManager.editor?.areAnyBlocking()) {
        return;
      }

      const hasScreenPermission = ensureScreenCapturePermissions();
      if (!hasScreenPermission) {
        return;
      }

      const recordAudio = settings.get('recordAudio');

      if (recordAudio && !hasMicrophoneAccess()) {
        const granted = await ensureMicrophonePermissions(async () => {
          const {response} = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['Open System Preferences', 'Continue'],
            defaultId: 1,
            message: 'Kap cannot access the microphone.',
            detail: 'Audio recording is enabled but Kap does not have access to the microphone. Continue without audio or grant Kap access to the microphone the System Preferences.',
            cancelId: 2
          });

          if (response === 0) {
            openSystemPreferences('Privacy_Microphone');
            return false;
          }

          if (response === 1) {
            settings.set('recordAudio', false);
            return true;
          }

          return false;
        });

        if (!granted) {
          return;
        }
      }

      isOpen = true;
      openSessionId += 1;
      const sessionId = openSessionId;

      const activeDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

      await ensureCroppers(activeDisplayId, sessionId);

      for (const cropper of croppers.values()) {
        cropper.setIgnoreMouseEvents(true);
        cropper.setVisibleOnAllWorkspaces(false);
        cropper.showInactive();
      }

      if (process.platform === 'darwin') {
        app.setActivationPolicy('accessory');
      }

      croppers.get(activeDisplayId)?.focus();
      registerCloseShortcuts();
      console.log('[cropper] opened windows', {sessionId, activeDisplayId, count: croppers.size});

      notificationId = (systemPreferences as any).subscribeWorkspaceNotification('NSWorkspaceActiveSpaceDidChangeNotification', () => {
        closeAllCroppers();
      });

      screen.on('display-removed', (_, oldDisplay) => {
        const {id} = oldDisplay;
        const cropper = croppers.get(id);

        if (!cropper) {
          return;
        }

        const wasFocused = cropper.isFocused();

        cropper.removeAllListeners('close');
        cropper.removeAllListeners('closed');
        cropper.destroy();
        croppers.delete(id);
        readyCroppers.delete(cropper.id);

        if (wasFocused) {
          const newActiveId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
          if (croppers.has(newActiveId)) {
            croppers.get(newActiveId)?.focus();
          }
        }
      });

      screen.on('display-added', (_, newDisplay) => {
        const cropper = createCropper(newDisplay, undefined, openSessionId);
        cropper.webContents.once('did-finish-load', () => {
          cropper.showInactive();
        });
      });
    } catch (error) {
      console.error('[cropper] failed to open recording overlay', error);
      closeAllCroppers();
      throw error;
    } finally {
      openingPromise = undefined;
    }
  })();

  return openingPromise;
};

const preventDefault = (event: any) => event.preventDefault();

const selectApp = async (window: MacWindow, activateWindow: (ownerName: string) => Promise<void>) => {
  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.prependListener('blur', preventDefault);
    }
  }

  await activateWindow(window.ownerName);

  const {x, y, width, height, ownerName} = window;

  const display = screen.getDisplayMatching({x, y, width, height});
  const {id, bounds: {x: screenX, y: screenY}} = display;

  await new Promise(resolve => {
    setTimeout(resolve, 300);
  });

  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.removeListener('blur', preventDefault);
      cropper.webContents.send('blur');
    }
  }

  croppers.get(id)?.focus();

  croppers.get(id)?.webContents.send('select-app', {
    ownerName,
    x: x - screenX,
    y: y - screenY,
    width,
    height
  });
};

const disableCroppers = () => {
  unregisterCloseShortcuts();

  if (notificationId !== undefined) {
    systemPreferences.unsubscribeWorkspaceNotification(notificationId);
    notificationId = undefined;
  }

  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.removeAllListeners('blur');
      cropper.setIgnoreMouseEvents(true);
      cropper.setVisibleOnAllWorkspaces(true);
    }
  }
};

const setRecordingCroppers = () => {
  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.webContents.send('start-recording');
    }
  }
};

const startRecordingFromCroppers = () => {
  console.log('[cropper] start recording requested from shortcut', {sessionId: openSessionId});
  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.webContents.send('start-countdown');
    }
  }
};

const sendCountdownToCroppers = (value: number) => {
  for (const cropper of croppers.values()) {
    if (!cropper.isDestroyed()) {
      cropper.webContents.send('countdown', value);
    }
  }
};

const isCropperOpen = () => isOpen;

const handleControlsReady = (event: Electron.IpcMainEvent, payload?: {sessionId?: number}) => {
  const cropper = BrowserWindow.fromWebContents(event.sender);
  if (!isOpen || !cropper || ![...croppers.values()].includes(cropper)) {
    return;
  }

  if (payload?.sessionId !== undefined && payload.sessionId !== openSessionId) {
    return;
  }

  console.log('[cropper] controls ready', {sessionId: openSessionId, rendererSessionId: payload?.sessionId, windowId: cropper.id});
  cropper.setIgnoreMouseEvents(false);
};

ipcMain.on('cropper-controls-ready', handleControlsReady);

app.on('before-quit', () => {
  ipcMain.removeListener('cropper-controls-ready', handleControlsReady);
  destroyAllCroppers();
});

windowManager.setCropper({
  open: openCropperWindow,
  close: closeAllCroppers,
  selectApp,
  setRecording: setRecordingCroppers,
  startRecording: startRecordingFromCroppers,
  isOpen: isCropperOpen,
  disable: disableCroppers,
  sendCountdown: sendCountdownToCroppers
});
