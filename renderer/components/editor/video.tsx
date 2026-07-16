import {useRef, useEffect} from 'react';
import VideoTimeContainer from './video-time-container';
import VideoMetadataContainer from './video-metadata-container';
import VideoControlsContainer from './video-controls-container';
import useEditorWindowState from 'hooks/editor/use-editor-window-state';
import {ipcRenderer as ipc} from 'electron-better-ipc';

const getVideoProps = (propsArray: Array<React.DetailedHTMLProps<React.VideoHTMLAttributes<HTMLVideoElement>, HTMLVideoElement>>) => {
  const handlers = new Map();

  for (const props of propsArray) {
    for (const [key, handler] of Object.entries(props)) {
      if (!handlers.has(key)) {
        handlers.set(key, []);
      }

      handlers.get(key).push(handler);
    }
  }

  // eslint-disable-next-line unicorn/no-array-reduce
  return [...handlers.entries()].reduce((acc, [key, handlerList]) => ({
    ...acc,
    [key]: () => {
      for (const handler of handlerList) {
        handler?.();
      }
    }
  }), {});
};

const Video = () => {
  const videoRef = useRef<HTMLVideoElement>();
  const {filePath} = useEditorWindowState();
  const src = `file://${filePath}`;

  const videoTimeContainer = VideoTimeContainer.useContainer();
  const videoMetadataContainer = VideoMetadataContainer.useContainer();
  const videoControlsContainer = VideoControlsContainer.useContainer();

  useEffect(() => {
    videoTimeContainer.setVideoRef(videoRef.current);
    videoMetadataContainer.setVideoRef(videoRef.current);
    videoControlsContainer.setVideoRef(videoRef.current);
  }, []);

  const videoProps = getVideoProps([
    videoTimeContainer.videoProps,
    videoMetadataContainer.videoProps,
    videoControlsContainer.videoProps
  ]);

  const onContextMenu = async () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const wasPaused = video.paused;

    if (!wasPaused) {
      await videoControlsContainer.pause();
    }

    const {Menu} = require('../../utils/electron-remote');
    const menu = Menu.buildFromTemplate([{
      label: 'Snapshot',
      click: () => {
        ipc.callMain('save-snapshot', video.currentTime);
      }
    }]);

    menu.popup({
      callback: () => {
        if (!wasPaused) {
          videoControlsContainer.play();
        }
      }
    });
  };

  return (
    <div className="video-frame" onContextMenu={onContextMenu}>
      <video ref={videoRef} preload="auto" src={src} {...videoProps}/>
      <style jsx>{`
        .video-frame {
          flex: 1;
          min-width: 0;
          min-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #000;
        }

        video {
          width: 100%;
          height: 100%;
          max-height: calc(100vh - 48px);
          object-fit: contain;
          object-position: center center;
          display: block;
        }
      `}</style>
    </div>
  );
};

export default Video;
