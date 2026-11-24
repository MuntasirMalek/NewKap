import {app, BrowserWindow, Menu} from 'electron';
import {Promisable} from 'type-fest';
import {settings} from '../common/settings';

export const shouldKeepDockVisible = () => settings.get('showInDock', false);

export const syncDockVisibility = async () => {
  if (!app.dock) {
    return;
  }

  if (shouldKeepDockVisible()) {
    await app.dock.show();
    return;
  }

  const hasNonCropperWindow = BrowserWindow.getAllWindows().some(
    window => !window.isDestroyed() && window.isVisible()
  );

  if (!hasNonCropperWindow) {
    app.dock.hide();
  }
};

export const setupDockMenu = ({
  openCropper,
  openVideo,
  openPreferences
}: {
  openCropper: () => void;
  openVideo: () => void;
  openPreferences: () => void;
}) => {
  if (!app.dock) {
    return;
  }

  const dockMenu = Menu.buildFromTemplate([
    {
      label: 'New Recording',
      click: openCropper
    },
    {
      label: 'Open Video…',
      click: openVideo
    },
    {
      type: 'separator'
    },
    {
      label: 'Preferences…',
      click: openPreferences
    }
  ]);

  app.dock.setMenu(dockMenu);
};

export const ensureDockIsShowing = async (action: () => Promisable<void>) => {
  const wasDockShowing = app.dock.isVisible();
  if (!wasDockShowing) {
    await app.dock.show();
  }

  try {
    await action();
  } finally {
    if (!wasDockShowing && !shouldKeepDockVisible()) {
      app.dock.hide();
    }
  }
};

export const ensureDockIsShowingSync = (action: () => void) => {
  const wasDockShowing = app.dock.isVisible();
  if (!wasDockShowing) {
    app.dock.show();
  }

  try {
    action();
  } finally {
    if (!wasDockShowing && !shouldKeepDockVisible()) {
      app.dock.hide();
    }
  }
};
