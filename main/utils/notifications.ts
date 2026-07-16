import {Notification, NotificationConstructorOptions, NotificationAction, app} from 'electron';
import {settings} from '../common/settings';

// Need to persist the notifications, otherwise it is garbage collected and the actions don't trigger
// https://github.com/electron/electron/issues/12690
const notifications = new Set<Notification>();

interface Action extends NotificationAction {
  action?: () => void | Promise<void>;
}

interface NotificationOptions extends NotificationConstructorOptions {
  actions?: Action[];
  click?: () => void | Promise<void>;
  show?: boolean;
}

type NotificationPromise = Promise<void> & {
  show: () => void;
  close: () => void;
};

export const notify = (options: NotificationOptions): NotificationPromise => {
  if (!settings.get('showNotifications')) {
    const promise = Promise.resolve() as NotificationPromise;
    promise.show = () => undefined;
    promise.close = () => undefined;
    return promise;
  }

  const notification = new Notification({
    ...options,
    silent: options.silent ?? !settings.get('playNotificationSound')
  });

  notifications.add(notification);

  const promise = new Promise(resolve => {
    if (options.click && typeof options.click === 'function') {
      notification.on('click', () => {
        resolve(options.click?.());
      });
    }

    if (options.actions && options.actions.length > 0) {
      notification.on('action', (_, index) => {
        const button = options.actions?.[index];

        if (button?.action && typeof button?.action === 'function') {
          resolve(button?.action?.());
        } else {
          resolve(index);
        }
      });
    }

    notification.on('close', () => {
      resolve(undefined);
    });
  });

  const removeWhenSettled = async () => {
    await promise;
    notifications.delete(notification);
  };

  void removeWhenSettled();

  (promise as NotificationPromise).show = () => {
    notification.show();
  };

  (promise as NotificationPromise).close = () => {
    notification.close();
  };

  if (options.show ?? true) {
    notification.show();
  }

  return promise as NotificationPromise;
};

notify.simple = (text: string) => notify({title: app.name, body: text});
