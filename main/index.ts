import {app, BrowserWindow, Tray, Menu, dialog, nativeImage} from 'electron';
import path from 'path';
import fs from 'fs';
import {initialize as initializeRemote} from '@electron/remote/main';
import {mark} from './utils/perf';

mark('main module entered');

app.setName('Kap');
process.title = 'Kap';

if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory');

  const preserveMenuBarPolicy = () => {
    app.setActivationPolicy('accessory');
  };

  app.on('activate', preserveMenuBarPolicy);
  app.on('browser-window-focus', preserveMenuBarPolicy);
  app.on('browser-window-created', (_event, window) => {
    window.on('show', preserveMenuBarPolicy);
  });
}

const _origShowMessageBoxSync = dialog.showMessageBoxSync;
dialog.showMessageBoxSync = ((...args: any[]) => {
  const options: any = args.length === 1 ? args[0] : args[1];
  if (options?.message?.includes('Move to Applications folder') || options?.message?.includes('Applications folder')) {
    return 1;
  }

  return _origShowMessageBoxSync.apply(dialog, args as any);
}) as any;

const _origShowMessageBox = dialog.showMessageBox;
dialog.showMessageBox = (async (...args: any[]) => {
  const options: any = args.length === 1 ? args[0] : args[1];
  if (options?.message?.includes('Move to Applications folder') || options?.message?.includes('Applications folder')) {
    return Promise.resolve({response: 1, checkboxChecked: false});
  }

  return _origShowMessageBox.apply(dialog, args as any);
}) as any;

const _origShowErrorBox = dialog.showErrorBox;
dialog.showErrorBox = ((title: string, content: string) => {
  if (title?.includes('Move to Applications folder') || title?.includes('Applications folder')) {
    return;
  }

  return _origShowErrorBox.call(dialog, title, content);
}) as any;

Object.defineProperty(app, 'isInApplicationsFolder', {
  value: () => true,
  writable: true,
  configurable: true
});

const filesToOpen: string[] = [];
let onExitCleanupComplete = false;

app.commandLine.appendSwitch('--enable-features', 'OverlayScrollbar');

app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (app.isReady()) {
    require('./common/analytics').track('editor/opened/running');
    require('./utils/open-files').openFiles(filePath);
  } else {
    filesToOpen.push(filePath);
  }
});

let pendingDeepLink: string | undefined;
let deepLinkReady = false;

export const markDeepLinkReady = () => {
  deepLinkReady = true;
  if (pendingDeepLink) {
    const url = pendingDeepLink;
    pendingDeepLink = undefined;
    require('./utils/deep-linking').handleDeepLink(url);
  }
};

app.on('will-finish-launching', () => {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (deepLinkReady) {
      require('./utils/deep-linking').handleDeepLink(url);
    } else {
      pendingDeepLink = url;
    }
  });
});

app.on('window-all-closed', () => {
  app.dock?.hide();
});

(async () => {
  await app.whenReady();
  mark('app.whenReady resolved');

  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.icns')));
    app.setActivationPolicy('accessory');
  }

  // Initialize @electron/remote compatibility bridge.
  // Each BrowserWindow must also call enable() on its webContents.
  initializeRemote();

  // @electron/remote cannot resolve relative app modules from Electron's root
  // module on Electron 28+. Resolve the existing app-owned calls here.
  (app as any).on('remote-require', (event: any, _contents: Electron.WebContents, moduleName: string) => {
    try {
      event.returnValue = require(moduleName);
    } catch (error) {
      console.error(`[remote] failed to require ${moduleName}`, error);
      throw error;
    }
  });

  app.dock?.hide();
  app.setAboutPanelOptions({
    applicationName: 'Kap',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © Kap Contributors'
  });

  const tray = new Tray(path.join(__dirname, '..', 'static', 'menubarDefaultTemplate.png'));
  mark('tray constructed');

  let trayReady = false;
  let pendingOpenCropper = false;

  tray.on('click', () => {
    if (!trayReady) {
      pendingOpenCropper = true;
      return;
    }

    const {windowManager} = require('./windows/manager');
    windowManager.cropper?.open();
  });

  tray.on('right-click', () => {
    if (!trayReady) {
      tray.popUpContextMenu(Menu.buildFromTemplate([
        {label: 'Kap is loading…', enabled: false}
      ]));
    }
  });

  const tick = async () => new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

  // Auto-detect production build — if static output exists, skip the
  // Next.js dev server entirely.  This eliminates the ~16s prepareNext
  // delay, the ~15s pre-compilation wait, and the fsevents crash on
  // Ctrl+C (no file-watcher thread).
  const staticDir = path.join(__dirname, '..', 'renderer', 'out');
  const hasStaticBuild = fs.existsSync(path.join(staticDir, 'cropper.html'));
  if (hasStaticBuild) {
    process.env.ELECTRON_IS_DEV = '0';
  }

  setImmediate(async () => {
    require('./utils/errors').setupErrorHandling();
    await tick();

    require('./utils/protocol').setupProtocol();

    // In production electron-next installs the file-protocol interceptor that
    // maps /_next assets into renderer/out. It must run for static builds too.
    const prepareNext = require('electron-next');
    await prepareNext('./renderer');

    if (!hasStaticBuild) {
      // Pre-compile the cropper page by loading it in a hidden window.
      // Only needed in dev mode (static builds serve instantly).
      const {is: isDev} = require('electron-util');
      if (isDev.development) {
        const preloadWin = new BrowserWindow({
          show: false,
          webPreferences: {nodeIntegration: true, enableRemoteModule: true, contextIsolation: false} as any
        });
        await preloadWin.loadURL('http://localhost:8000/cropper');
        preloadWin.destroy();
      }
    }

    await tick();

    require('./remote-states').setupRemoteStates();

    // Phase 2: Only load cropper first — defer all other window modules
    mark('before cropper require');
    require('./windows/cropper');
    mark('cropper module loaded');
    await tick();

    // Now replace the temporary tray with the full-featured one
    tray.removeAllListeners('click');
    tray.removeAllListeners('right-click');
    const {initializeTray: wireUpTray} = require('./tray');
    wireUpTray(tray);
    trayReady = true;
    mark('tray ready');

    if (pendingOpenCropper) {
      pendingOpenCropper = false;
      const {windowManager} = require('./windows/manager');
      windowManager.cropper?.open();
    }

    markDeepLinkReady();

    await tick();

    // Phase 3: Defer non-critical window modules and init
    setImmediate(() => {
      mark('deferred load starting');
      require('./windows/editor');
      require('./windows/config');
      require('./windows/dialog');
      require('./windows/exports');
      require('./windows/preferences');
      mark('deferred windows loaded');
    });

    // Electron-timber's renderer preload uses Electron's removed built-in
    // remote API and fails before application code on current Electron.
    try {
      require('./utils/sentry');
    } catch (error) {
      console.error('[main] failed to initialize Sentry', error);
    }

    await tick();

    const {initializeDevices} = require('./utils/devices');
    const {initializeAnalytics} = require('./common/analytics');
    const {initializeGlobalAccelerators} = require('./global-accelerators');
    const {setUpExportsListeners} = require('./export');

    initializeDevices();
    initializeAnalytics();
    initializeGlobalAccelerators();
    setUpExportsListeners();

    if (!app.isDefaultProtocolClient('kap')) {
      app.setAsDefaultProtocolClient('kap');
    }

    await tick();

    if (filesToOpen.length > 0) {
      require('./common/analytics').track('editor/opened/startup');
      require('./utils/open-files').openFiles(...filesToOpen);
      require('./recording-history').hasActiveRecording().catch(console.error);
    }

    const {is} = require('electron-util');
    if (app.isPackaged && !is.development) {
      const {plugins} = require('./plugins');
      plugins.upgrade().catch((error: any) => {
        console.log('Plugin upgrade failed (non-fatal):', error);
      });
    }

    setTimeout(() => {
      if (!app.isPackaged || is.development) {
        return;
      }

      const log = require('electron-log');
      const {autoUpdater} = require('electron-updater');
      const toMilliseconds = require('@sindresorhus/to-milliseconds');

      autoUpdater.logger = log;
      autoUpdater.logger.transports.file.level = 'info';

      const doCheck = async () => {
        try {
          await autoUpdater.checkForUpdates();
        } catch (error) {
          autoUpdater.logger?.error(error);
        }
      };

      setInterval(doCheck, toMilliseconds({hours: 1}));
      doCheck();
    }, 10_000);
  });
})();

const QUIT_TIMEOUT_MS = 5000;

const performQuitCleanup = async () => {
  try {
    const {stopRecordingWithNoEdit} = require('./aperture');
    await stopRecordingWithNoEdit();
  } catch (error) {
    console.error('Error stopping recording on quit:', error);
  }

  try {
    const {cleanPastRecordings} = require('./recording-history');
    cleanPastRecordings();
  } catch (error) {
    console.error('Error cleaning recordings on quit:', error);
  }
};

app.on('before-quit', (event: any) => {
  if (!onExitCleanupComplete) {
    event.preventDefault();

    const forceQuit = setTimeout(() => {
      console.log('Force quitting after timeout');
      onExitCleanupComplete = true;
      app.exit(0);
    }, QUIT_TIMEOUT_MS);

    performQuitCleanup().finally(() => {
      clearTimeout(forceQuit);
      onExitCleanupComplete = true;
      app.quit();
    });
  }
});

const handleSignal = (signal: 'SIGTERM' | 'SIGINT') => {
  return () => {
    console.log(`Received ${signal}, quitting...`);
    onExitCleanupComplete = true;
    app.exit(0);
  };
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, handleSignal(signal));
}
