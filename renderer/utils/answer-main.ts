import {ipcRenderer} from 'electron';
import {serializeError} from 'serialize-error';

const remote = require('./electron-remote');
const {getRendererSendChannel} = require('electron-better-ipc/source/util');

const answerMain = <Data, Result>(channel: string, callback: (data: Data) => Result | Promise<Result>) => {
  const sendChannel = getRendererSendChannel(remote.getCurrentWindow().id, channel);

  const listener = async (_event: Electron.IpcRendererEvent, data: any) => {
    const {dataChannel, errorChannel, userData} = data;

    try {
      ipcRenderer.send(dataChannel, await callback(userData));
    } catch (error) {
      ipcRenderer.send(errorChannel, serializeError(error));
    }
  };

  ipcRenderer.on(sendChannel, listener);

  return () => {
    ipcRenderer.off(sendChannel, listener);
  };
};

export default answerMain;
