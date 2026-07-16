import React from 'react';
import * as Sentry from '@sentry/browser';

const SENTRY_PUBLIC_DSN = 'https://2dffdbd619f34418817f4db3309299ce@sentry.io/255536';

class SentryErrorBoundary extends React.Component<{children: React.ReactNode}> {
  constructor(props) {
    super(props);
    const remote = require('./electron-remote');
    const {settings} = remote.require('./common/settings');
    const isDevelopment = 'ELECTRON_IS_DEV' in process.env ?
      Number.parseInt(process.env.ELECTRON_IS_DEV!, 10) === 1 :
      !remote.app.isPackaged;

    if (!isDevelopment && settings.get('allowAnalytics')) {
      const release = `${remote.app.name}@${remote.app.getVersion()}`.toLowerCase();
      Sentry.init({dsn: SENTRY_PUBLIC_DSN, release});
    }
  }

  componentDidCatch(error, errorInfo) {
    console.log(error, errorInfo);
    Sentry.configureScope(scope => {
      for (const [key, value] of Object.entries(errorInfo)) {
        scope.setExtra(key, value);
      }
    });

    Sentry.captureException(error);

    // This is needed to render errors correctly in development / production
    super.componentDidCatch(error, errorInfo);
  }

  render() {
    return this.props.children;
  }
}

export default SentryErrorBoundary;
