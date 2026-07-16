import {useCallback} from 'react';

interface UseConfirmationOptions {
  message: string;
  detail?: string;
  confirmButtonText: string;
  cancelButtonText?: string;
}

export const useConfirmation = (
  callback: () => void,
  options: UseConfirmationOptions
) => {
  return useCallback(() => {
    const remote = require('../utils/electron-remote');

    const buttonIndex = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
      type: 'question',
      buttons: [
        options.confirmButtonText,
        options.cancelButtonText ?? 'Cancel'
      ],
      defaultId: 0,
      cancelId: 1,
      message: options.message,
      detail: options.detail
    });

    if (buttonIndex === 0) {
      callback();
    }
  }, [callback]);
};
