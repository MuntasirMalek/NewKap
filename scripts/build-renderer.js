'use strict';

// Builds and exports the Next.js 10 renderer. Node 17+ uses OpenSSL 3 by
// default, which requires --openssl-legacy-provider for Webpack 4 hashes.
const path = require('path');
const {execFileSync} = require('child_process');

const nextBin = path.join(__dirname, '..', 'node_modules', '.bin', 'next');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

const environment = {...process.env};
if (nodeMajor >= 17 && !(environment.NODE_OPTIONS || '').includes('--openssl-legacy-provider')) {
  environment.NODE_OPTIONS = [environment.NODE_OPTIONS, '--openssl-legacy-provider'].filter(Boolean).join(' ');
}

execFileSync(nextBin, ['build', 'renderer'], {stdio: 'inherit', env: environment});
execFileSync(nextBin, ['export', 'renderer'], {stdio: 'inherit', env: environment});
