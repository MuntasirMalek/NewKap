'use strict';

import {homedir} from 'os';
import Store from 'electron-store';
import {Format} from './types';

const {defaultInputDeviceId} = require('./constants');
const shortcutToAccelerator = require('../utils/shortcut-to-accelerator');

export const shortcuts = {
  triggerCropper: 'Start Recording',
  stopRecording: 'Stop Recording'
};

export type RecordingQuality = 'standard' | 'high' | 'maximum';

const shortcutSchema = {
  type: 'string' as const,
  default: ''
};

interface Settings {
  kapturesDir: string;
  allowAnalytics: boolean;
  showCursor: boolean;
  highlightClicks: boolean;
  record60fps: boolean;
  loopExports: boolean;
  recordKeyboardShortcut: boolean;
  recordAudio: boolean;
  showCountdown: boolean;
  countdownDuration: number;
  audioInputDeviceId?: string;
  recordingQuality: RecordingQuality;
  defaultExportFormat: Format;
  showNotifications: boolean;
  playNotificationSound: boolean;
  cropperShortcut: {
    metaKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    character: string;
  };
  lossyCompression: boolean;
  enableShortcuts: boolean;
  shortcuts: {
    [key in keyof typeof shortcuts]: string
  };
  version: string;
}

export const settings = new Store<Settings>({
  schema: {
    kapturesDir: {
      type: 'string',
      default: `${homedir()}/Movies/Kaptures`
    },
    allowAnalytics: {
      type: 'boolean',
      default: true
    },
    showCursor: {
      type: 'boolean',
      default: true
    },
    highlightClicks: {
      type: 'boolean',
      default: false
    },
    record60fps: {
      type: 'boolean',
      default: false
    },
    loopExports: {
      type: 'boolean',
      default: true
    },
    recordKeyboardShortcut: {
      type: 'boolean',
      default: true
    },
    recordAudio: {
      type: 'boolean',
      default: false
    },
    showCountdown: {
      type: 'boolean',
      default: true
    },
    countdownDuration: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      default: 3
    },
    audioInputDeviceId: {
      type: [
        'string',
        'null'
      ],
      default: defaultInputDeviceId
    },
    recordingQuality: {
      type: 'string',
      enum: ['standard', 'high', 'maximum'],
      default: 'standard'
    },
    defaultExportFormat: {
      type: 'string',
      enum: ['mp4', 'hevc', 'av1', 'gif', 'apng', 'webm'],
      default: Format.mp4
    },
    showNotifications: {
      type: 'boolean',
      default: true
    },
    playNotificationSound: {
      type: 'boolean',
      default: true
    },
    cropperShortcut: {
      type: 'object',
      properties: {
        metaKey: {
          type: 'boolean',
          default: true
        },
        altKey: {
          type: 'boolean',
          default: false
        },
        ctrlKey: {
          type: 'boolean',
          default: false
        },
        shiftKey: {
          type: 'boolean',
          default: true
        },
        character: {
          type: 'string',
          default: '5'
        }
      }
    },
    lossyCompression: {
      type: 'boolean',
      default: false
    },
    enableShortcuts: {
      type: 'boolean',
      default: true
    },
    shortcuts: {
      type: 'object',
      properties: Object.fromEntries(Object.keys(shortcuts).map(key => [key, shortcutSchema])),
      default: {}
    },
    version: {
      type: 'string',
      default: ''
    }
  }
});

if (settings.has('recordKeyboardShortcut')) {
  settings.set('enableShortcuts', settings.get('recordKeyboardShortcut'));
  settings.delete('recordKeyboardShortcut');
}

if (settings.has('cropperShortcut')) {
  settings.set('shortcuts.triggerCropper', shortcutToAccelerator(settings.get('cropperShortcut')));
  settings.delete('cropperShortcut');
}

settings.set('cropper' as any, {});
settings.set('actionBar' as any, {});
