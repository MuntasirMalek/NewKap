import path from 'path';
import {clipboard, app} from 'electron';
import ensureError from 'ensure-error';
import cleanStack from 'clean-stack';
import {openNewGitHubIssue} from 'electron-util';
import macosRelease from './macos-release';

import {windowManager} from '../windows/manager';
import {InstalledPlugin} from '../plugins/plugin';

const ERRORS_TO_IGNORE = [
  /net::ERR_CONNECTION_TIMED_OUT/,
  /net::ERR_NETWORK_IO_SUSPENDED/,
  /net::ERR_CONNECTION_CLOSED/,
  /net::ERR_INTERNET_DISCONNECTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /The operation couldn't be completed/
];

const shouldIgnoreError = (errorText: string) => ERRORS_TO_IGNORE.some(regex => regex.test(errorText));

const getPrettyStack = (error: Error) => {
  const pluginsPath = path.join(app.getPath('userData'), 'plugins', 'node_modules');
  return cleanStack(error.stack ?? '', {pretty: true, basePath: pluginsPath});
};

const release = macosRelease();

const getIssueBody = (title: string, errorStack: string) => `
<!--
Thank you for helping us improve NewKap!
-->

**macOS version:**    ${release.name} (${release.version})
**Architecture:**     ${process.arch}
**NewKap version:**   ${app.getVersion()}

\`\`\`
${title}

${errorStack}
\`\`\`

<!-- If you have additional information, enter it below. -->
`;

export const showError = async (
  error: Error,
  {
    title: customTitle,
    plugin
  }: {
    title?: string;
    plugin?: InstalledPlugin;
  } = {}
) => {
  await app.whenReady();
  const ensuredError = ensureError(error);
  const title = customTitle ?? ensuredError.name;
  const detail = getPrettyStack(ensuredError);

  console.log(error);
  if (shouldIgnoreError(`${title}\n${detail}`)) {
    return;
  }

  const mainButtons = [
    'Don\'t Report',
    {
      label: 'Copy Error',
      action: () => {
        clipboard.writeText(`${title}\n${detail}`);
      }
    }
  ];

  // If it's a plugin error, offer to open an issue on the plugin repo (if known)
  if (plugin) {
    const openIssueButton = plugin.repoUrl && {
      label: 'Open Issue',
      action: () => {
        openNewGitHubIssue({
          repoUrl: plugin.repoUrl,
          title,
          body: getIssueBody(title, detail)
        });
      }
    };

    return windowManager.dialog?.open({
      title,
      detail,
      cancelId: 0,
      defaultId: openIssueButton ? 2 : 0,
      buttons: [...mainButtons, openIssueButton].filter(Boolean)
    });
  }

  const buttons: any[] = [
    ...mainButtons,
    {
      label: 'Open Issue',
      action: () => {
        openNewGitHubIssue({
          user: 'MuntasirMalek',
          repo: 'NewKap',
          title,
          body: getIssueBody(title, detail)
        });
      }
    }
  ];

  return windowManager.dialog?.open({
    title,
    detail,
    buttons,
    message: 'Reporting this issue on GitHub will help us resolve it faster.',
    cancelId: 0,
    defaultId: 2
  });
};

export const setupErrorHandling = () => {
  process.on('uncaughtException', error => {
    showError(error, {title: 'Unhandled Error'});
  });

  process.on('unhandledRejection', error => {
    showError(ensureError(error), {title: 'Unhandled Promise Rejection'});
  });
};
