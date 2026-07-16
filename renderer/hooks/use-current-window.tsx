const remote = require('../utils/electron-remote');

export const useCurrentWindow = () => {
  return remote.getCurrentWindow();
};
