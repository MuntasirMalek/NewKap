// ============================================================================
// NewKap — Fast Phased Startup
// Phase 1: Show tray icon immediately (< 500ms)
// Phase 2: Load renderer + window modules (background)
// Phase 3: Open cropper + deferred init (background)
// ============================================================================

import {app, Tray, dialog} from 'electron';
import path from 'path';
import {settings} from './common/settings';
import {shouldKeepDockVisible, setupDockMenu, syncDockVisibility} from './utils/dock';

// Block "Move to Applications folder" dialog permanently.
// Multiple copies of electron-util exist in dependencies, some using
// showMessageBoxSync, others showMessageBox (async), and others showErrorBox.
// We intercept all dialog methods to block any "Move to Applications" dialog.

const isAppsFolderPrompt = (text?: string) =>
  Boolean(text && (text.includes('Move to Applications folder') || text.includes('Applications folder')));

const originalShowMessageBoxSync = dialog.showMessageBoxSync;
dialog.showMessageBoxSync = ((...args: any[]) => {
  const options = args.length === 1 ? args[0] : args[1];
  if (isAppsFolderPrompt(options?.message)) {
    return 1;
  }

  return (originalShowMessageBoxSync as any).apply(dialog, args);
}) as any;

const originalShowMessageBox = dialog.showMessageBox;
dialog.showMessageBox = (async (...args: any[]) => {
  const options = args.length === 1 ? args[0] : args[1];
  if (isAppsFolderPrompt(options?.message)) {
    return {response: 1, checkboxChecked: false};
  }

  return (originalShowMessageBox as any).apply(dialog, args);
}) as any;

const originalShowErrorBox = dialog.showErrorBox;
dialog.showErrorBox = ((title: string, content: string) => {
  if (isAppsFolderPrompt(title)) {
    return;
  }

  originalShowErrorBox.call(dialog, title, content);
}) as any;

// Override isInApplicationsFolder for any direct main-process checks
Object.defineProperty(app, 'isInApplicationsFolder', {
  value: () => true,
  writable: true,
  configurable: true
});

const filesToOpen: string[] = [];
let onExitCleanupComplete = false;
let isQuitting = false;
let appInitialized = false;
let pendingCropperOpen = false;

app.commandLine.appendSwitch('--enable-features', 'OverlayScrollbar');

app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (appInitialized) {
    require('./common/analytics').track('editor/opened/running');
    require('./utils/open-files').openFiles(filePath);
  } else {
    filesToOpen.push(filePath);
  }
});

// Queue deep links received before app is fully initialized
let pendingDeepLink: string | undefined;
let deepLinkReady = false;
let hadDeepLinkOnStartup = false;

export const markDeepLinkReady = () => {
  deepLinkReady = true;
  if (pendingDeepLink) {
    hadDeepLinkOnStartup = true;
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
  if (!shouldKeepDockVisible()) {
    app.dock.hide();
  }
});

app.on('activate', (_, hasVisibleWindows) => {
  if (hasVisibleWindows) {
    return;
  }

  if (!appInitialized) {
    pendingCropperOpen = true;
    return;
  }

  const {isPast} = require('./aperture');
  const {windowManager} = require('./windows/manager');
  if (!isPast() && !windowManager.cropper?.isOpen()) {
    windowManager.cropper?.open();
  }
});

// Phase 1: Instant tray
(async () => {
  await app.whenReady();

  await syncDockVisibility();
  app.setAboutPanelOptions({copyright: 'Copyright © NewKap Contributors'});

  // React immediately when the user toggles "Show in Dock" in Preferences
  settings.onDidChange('showInDock', () => {
    syncDockVisibility();
  });

  // Show tray icon immediately — before loading any heavy modules
  const tray = new Tray(path.join(__dirname, '..', 'static', 'menubarDefaultTemplate.png'));

  // Queue click if triggered before Phase 2 completes (avoids polling/timer leaks)
  tray.on('click', () => {
    pendingCropperOpen = true;
  });

  // Yield helper: breaks up synchronous work so macOS event loop stays responsive
  const tick = async () => new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

  // Phase 2: Background initialization (yielding between heavy requires)
  setImmediate(async () => {
    try {
      // Error handling (lightweight)
      require('./utils/errors').setupErrorHandling();
      await tick();

      // Protocol setup (needed before windows load)
      require('./utils/protocol').setupProtocol();

      // Prepare Next.js renderer (instant in production — just sets file protocol)
      const prepareNext = require('electron-next');
      await prepareNext('./renderer');
      await tick();

      // Remote states (lightweight IPC setup)
      require('./remote-states').setupRemoteStates();

      // Load all window modules — registers cropper, editor, etc. with windowManager
      require('./windows/load');
      await tick();

      // Now replace the temporary tray handler with the full-featured one
      tray.removeAllListeners('click');
      tray.removeAllListeners('right-click');
      const {initializeTray: wireUpTray} = require('./tray');
      wireUpTray(tray);
      appInitialized = true;

      const {windowManager} = require('./windows/manager');
      const {getOpenFileMenuItem} = require('./menus/common');
      setupDockMenu({
        openCropper: () => {
          const {isPast} = require('./aperture');
          if (!isPast()) {
            windowManager.cropper?.open();
          }
        },
        openVideo: () => {
          getOpenFileMenuItem().click();
        },
        openPreferences: () => {
          windowManager.preferences?.open();
        }
      });

      // Process any deep links received during startup (e.g. kap://record)
      markDeepLinkReady();

      // Phase 3: Deferred non-critical init (each step yields)
      await tick();

      // Logging (deferred — heavy module, not needed for tray/recording)
      try {
        require('electron-timber').hookConsole({main: true, renderer: true});
      } catch {}

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

      const {ensureScreenCapturePermissions, hasMicrophoneAccess} = require('./common/system-permissions');

      if (filesToOpen.length > 0) {
        require('./common/analytics').track('editor/opened/startup');
        require('./utils/open-files').openFiles(...filesToOpen);
        require('./recording-history').hasActiveRecording().catch(console.error);
      } else if (hadDeepLinkOnStartup) {
        // Skip cropper — deep link (e.g. kap://record) is handling startup
      } else if (pendingCropperOpen) {
        pendingCropperOpen = false;
        windowManager.cropper?.open();
      } else {
        try {
          const {hasActiveRecording} = require('./recording-history');
          if (
            !(await hasActiveRecording()) &&
            !app.getLoginItemSettings().wasOpenedAtLogin &&
            ensureScreenCapturePermissions() &&
            (!settings.get('recordAudio') || hasMicrophoneAccess())
          ) {
            windowManager.cropper?.open();
          }
        } catch (error) {
          console.error('Error during startup permission check:', error);
          windowManager.cropper?.open();
        }
      }

      // Plugin upgrade — fire and forget
      const {is} = require('electron-util');
      if (!is.development) {
        const {plugins} = require('./plugins');
        plugins.upgrade().catch((error: unknown) => {
          console.log('Plugin upgrade failed (non-fatal):', error);
        });
      }

      // Defer update check
      setTimeout(() => {
        if (is.development) {
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
    } catch (error) {
      console.error('Fatal error during startup initialization:', error);
    }
  });
})();

// Quit handling

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
  if (onExitCleanupComplete) {
    return;
  }

  if (isQuitting) {
    event.preventDefault();
    return;
  }

  // Ask the user before quitting if any exports are still running, so we don't
  // start force-quit timers or kill the app while the confirmation dialog is open.
  if (appInitialized) {
    const {confirmQuitWithActiveExports} = require('./export');
    if (!confirmQuitWithActiveExports()) {
      event.preventDefault();
      return;
    }
  }

  event.preventDefault();
  isQuitting = true;

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
});

// Handle terminal signals gracefully
const handleTerminationSignal = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}, quitting...`);
  onExitCleanupComplete = true;
  app.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, handleTerminationSignal);
}
