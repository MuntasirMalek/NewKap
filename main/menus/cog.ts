import {app, Menu} from 'electron';
import path from 'path';
import {MenuItemId, MenuOptions} from './utils';
import {getAboutMenuItem, getExportHistoryMenuItem, getOpenFileMenuItem, getPreferencesMenuItem, getSendFeedbackMenuItem} from './common';
import {getAudioDevices, getDefaultInputDevice} from '../utils/devices';
import {settings} from '../common/settings';
import {defaultInputDeviceId} from '../common/constants';
import {hasMicrophoneAccess} from '../common/system-permissions';
import {recordingHistory} from '../recording-history';
import {windowManager} from '../windows/manager';

const menuAccelerator = (shortcut: string) => shortcut ? shortcut : undefined;

const startOrOpenRecording = () => {
  if (windowManager.cropper?.isOpen()) {
    windowManager.cropper.startRecording();
    return;
  }

  windowManager.cropper?.open();
};

const getStartRecordingItem = (): MenuOptions[number] => ({
  id: MenuItemId.startRecording,
  label: 'Start Recording',
  accelerator: menuAccelerator(settings.get('shortcuts.triggerCropper')),
  click: startOrOpenRecording
});

const getCountdownItem = (): MenuOptions[number] => ({
  label: 'Countdown',
  type: 'checkbox',
  checked: settings.get('showCountdown'),
  click: menuItem => settings.set('showCountdown', menuItem.checked)
});

const getCursorItem = (): MenuOptions[number] => ({
  label: 'Show Cursor',
  type: 'checkbox',
  checked: settings.get('showCursor'),
  click: menuItem => {
    settings.set('showCursor', menuItem.checked);
    if (!menuItem.checked) {
      settings.set('highlightClicks', false);
    }
  }
});

const getRecentRecordingsItem = (): MenuOptions[number] => {
  const recordings = recordingHistory.get('recordings', []).slice(0, 5);

  return {
    label: 'Recent Recordings',
    submenu: recordings.length > 0 ? recordings.map(recording => ({
      label: recording.name || path.basename(recording.filePath),
      click: async () => {
        windowManager.cropper?.close();
        const {Video} = require('../video');
        await Video.getOrCreate({filePath: recording.filePath, title: recording.name}).openEditorWindow();
      }
    })) : [{label: 'No Recent Recordings', enabled: false}]
  };
};

const getBasicAudioItem = (): MenuOptions[number] => ({
  id: MenuItemId.audioDevices,
  label: 'Audio Source',
  submenu: [
    {
      label: 'None',
      type: 'radio',
      checked: !settings.get('recordAudio'),
      click: () => settings.set('recordAudio', false)
    },
    {
      label: 'Choose in Preferences…',
      click: () => windowManager.preferences?.open()
    }
  ]
});

const getQuickSettings = (): MenuOptions => [
  getStartRecordingItem(),
  {type: 'separator'},
  getCountdownItem(),
  getCursorItem(),
  getBasicAudioItem(),
  getRecentRecordingsItem()
];

export const buildBasicCogMenu = (): MenuOptions => [
  ...getQuickSettings(),
  {type: 'separator'},
  getPreferencesMenuItem(),
  getOpenFileMenuItem(),
  getExportHistoryMenuItem(),
  {type: 'separator'},
  getAboutMenuItem(),
  getSendFeedbackMenuItem(),
  {type: 'separator'},
  {label: 'Quit Kap', accelerator: 'Command+Q', click: () => app.quit()}
];

const getMicrophoneItem = async (): Promise<MenuOptions[number]> => {
  const canRecordAudio = hasMicrophoneAccess();
  const devices = canRecordAudio ? await getAudioDevices() : [];
  const isRecordAudioEnabled = settings.get('recordAudio');
  const currentDefaultDevice = canRecordAudio ? getDefaultInputDevice() : undefined;

  let audioInputDeviceId = settings.get('audioInputDeviceId');
  if (!devices.some(device => device.id === audioInputDeviceId)) {
    settings.set('audioInputDeviceId', defaultInputDeviceId);
    audioInputDeviceId = defaultInputDeviceId;
  }

  return {
    id: MenuItemId.audioDevices,
    label: 'Audio Source',
    submenu: [
      {
        label: 'None',
        type: 'radio',
        checked: !isRecordAudioEnabled,
        click: () => {
          settings.set('recordAudio', false);
        }
      },
      ...[
        {name: `System Default${currentDefaultDevice ? ` (${currentDefaultDevice.name})` : ''}`, id: defaultInputDeviceId},
        ...devices
      ].map(device => ({
        label: device.name,
        type: 'radio' as const,
        checked: isRecordAudioEnabled && (audioInputDeviceId === device.id),
        click: () => {
          settings.set('recordAudio', true);
          settings.set('audioInputDeviceId', device.id);
        }
      })),
      ...(canRecordAudio ? [] : [{
        label: 'Choose in Preferences…',
        click: () => windowManager.preferences?.open()
      }])
    ],
    visible: true
  };
};

const getPluginsItem = (): MenuOptions[number] => {
  const {plugins} = require('../plugins');
  const items = plugins.recordingPlugins.flatMap((plugin: any) =>
    plugin.recordServicesWithStatus.map((service: any) => ({
      label: service.title,
      type: 'checkbox' as const,
      checked: service.isEnabled,
      click: async () => service.setEnabled(!service.isEnabled)
    }))
  );

  return {
    id: MenuItemId.plugins,
    label: 'Plugins',
    submenu: items,
    visible: items.length > 0
  };
};

const getCogMenuTemplate = async (): Promise<MenuOptions> => [
  getStartRecordingItem(),
  {type: 'separator'},
  getCountdownItem(),
  getCursorItem(),
  await getMicrophoneItem(),
  getRecentRecordingsItem(),
  {type: 'separator'},
  getPreferencesMenuItem(),
  getPluginsItem(),
  getOpenFileMenuItem(),
  getExportHistoryMenuItem(),
  {type: 'separator'},
  getAboutMenuItem(),
  getSendFeedbackMenuItem(),
  {type: 'separator'},
  {label: 'Quit Kap', accelerator: 'Command+Q', click: () => app.quit()}
];

export const getCogMenuAsync = async () => {
  return Menu.buildFromTemplate(await getCogMenuTemplate());
};
