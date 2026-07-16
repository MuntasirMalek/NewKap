import {app, BrowserWindow} from 'electron';
import {is} from 'electron-util';

export const loadRoute = async (window: BrowserWindow, routeName: string, {openDevTools = false}: {openDevTools?: boolean} = {}) => {
  const loadPromise = is.development ? window.loadURL(`http://localhost:8000/${routeName}`) : window.loadFile(`${app.getAppPath()}/renderer/out/${routeName}.html`);

  if (openDevTools) {
    window.webContents.openDevTools({mode: 'detach'});
  }

  return loadPromise;
};
