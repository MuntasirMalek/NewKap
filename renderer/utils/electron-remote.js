'use strict';
let remote;
try {
  remote = require('@electron/remote');
} catch {
  remote = false;
}

module.exports = remote;
