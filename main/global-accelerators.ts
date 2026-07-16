import {globalShortcut} from 'electron';
import {ipcMain as ipc} from 'electron-better-ipc';
import {settings} from './common/settings';
import {windowManager} from './windows/manager';

const startOrOpenRecording = () => {
  if (windowManager.cropper?.isOpen()) {
    windowManager.cropper.startRecording();
    return;
  }

  windowManager.cropper?.open();
};

const stopCurrentRecording = () => {
  const {stopRecording} = require('./aperture');
  stopRecording();
};

const handlers = new Map<string, () => void>([
  ['triggerCropper', startOrOpenRecording],
  ['stopRecording', stopCurrentRecording]
]);

const registerShortcut = (shortcut: string, action: () => void) => {
  try {
    const registered = globalShortcut.register(shortcut, action);
    if (!registered) {
      console.warn('Shortcut was not registered', shortcut);
    }
  } catch (error) {
    console.error('Error registering shortcut', shortcut, action, error);
  }
};

export const setCropperShortcutAction = (action = startOrOpenRecording) => {
  if (settings.get('enableShortcuts') && settings.get('shortcuts.triggerCropper')) {
    handlers.set('triggerCropper', action);

    const shortcut = settings.get<string, string>('shortcuts.triggerCropper');
    if (globalShortcut.isRegistered(shortcut)) {
      globalShortcut.unregister(shortcut);
    }

    registerShortcut(shortcut, action);
  }
};

const registerFromStore = () => {
  if (settings.get('enableShortcuts')) {
    for (const [setting, action] of handlers.entries()) {
      const shortcut = settings.get<string, string>(`shortcuts.${setting}`);
      if (shortcut) {
        registerShortcut(shortcut, action);
      }
    }
  } else {
    globalShortcut.unregisterAll();
  }
};

export const initializeGlobalAccelerators = () => {
  ipc.answerRenderer('update-shortcut', ({setting, shortcut}) => {
    const oldShortcut = settings.get<string, string>(`shortcuts.${setting}`);

    try {
      if (oldShortcut && oldShortcut !== shortcut && globalShortcut.isRegistered(oldShortcut)) {
        globalShortcut.unregister(oldShortcut);
      }
    } catch (error) {
      console.error('Error unregistering old shortcutAccelerator', error);
    } finally {
      if (shortcut && shortcut !== oldShortcut) {
        settings.set(`shortcuts.${setting}`, shortcut);
        const handler = handlers.get(setting);

        if (settings.get('enableShortcuts') && handler) {
          registerShortcut(shortcut, handler);
        }
      } else if (!shortcut) {
        (settings as any).delete(`shortcuts.${setting}`);
      }
    }
  });

  ipc.answerRenderer('toggle-shortcuts', ({enabled}) => {
    if (enabled) {
      registerFromStore();
    } else {
      globalShortcut.unregisterAll();
    }
  });

  registerFromStore();
};
