'use strict';

import {parse} from 'semver';
import {settings} from './settings';

const pkg = require('../../package');

const version = parse(pkg.version);

export const track = (...paths: string[]) => {
  const allowAnalytics = settings.get('allowAnalytics');

  if (allowAnalytics) {
    console.log('Tracking', `v${version?.major}.${version?.minor}`, ...paths);
  }
};

export const initializeAnalytics = () => {
  if (settings.get('version') !== pkg.version) {
    track('install');
    settings.set('version', pkg.version);
  }
};
