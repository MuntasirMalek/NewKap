import {serial as test} from 'ava';
import sinon from 'sinon';

const CropperContainer = require('../renderer/containers/cropper').default;
const CursorContainer = require('../renderer/containers/cursor').default;

const makeSynchronous = (container: any) => {
  container.setState = async (updates: Record<string, unknown>) => {
    container.state = {
      ...container.state,
      ...updates
    };
  };

  return container;
};

const setup = () => {
  const cropper = makeSynchronous(new CropperContainer());
  const cursor = makeSynchronous(new CursorContainer());
  const actionBar = {
    state: {
      ratioLocked: false
    },
    setInputValues: sinon.fake(),
    toggleRatioLock: sinon.fake()
  };

  cropper.settings = {
    get: sinon.fake((_key: string, value: unknown) => value),
    set: sinon.fake()
  };
  cropper.remote = {
    getCurrentWindow: () => ({
      close: sinon.fake()
    })
  };
  cropper.bindCursor(cursor);
  cropper.bindActionBar(actionBar);
  cropper.state = {
    ...cropper.getInteractionResetState(),
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    screenWidth: 800,
    screenHeight: 600,
    displayId: 1,
    ratio: [5, 3],
    isActive: true,
    isReady: true,
    isFullscreen: false,
    selectedApp: '',
    resizeFromCenter: false
  };

  return {cropper, cursor, actionBar};
};

test('cursor movement without a pressed button does not alter crop bounds', t => {
  const {cropper, cursor} = setup();

  cursor.addCursorObserver(cropper.move);
  cursor.addCursorObserver(cropper.resize);
  cursor.setCursor({pageX: 300, pageY: 300});

  t.like(cropper.state, {
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    isMoving: false,
    isResizing: false
  });
});

test('reopening the cropper clears stale drag state but keeps saved selection bounds', t => {
  const {cropper, cursor} = setup();

  cropper.startMoving({button: 0, pageX: 110, pageY: 110});
  t.is(cursor.state.observers.length, 1);

  cropper.setDisplay({
    id: 1,
    width: 800,
    height: 600,
    isActive: true,
    cropper: {
      x: 40,
      y: 50,
      width: 320,
      height: 180,
      ratio: [16, 9]
    }
  });

  t.like(cropper.state, {
    x: 40,
    y: 50,
    width: 320,
    height: 180,
    isMoving: false,
    isResizing: false,
    isPicking: false,
    isPointerDown: false,
    activeGesture: null,
    currentHandle: null
  });
  t.is(cursor.state.observers.length, 0);

  cursor.setCursor({pageX: 500, pageY: 500});
  t.like(cropper.state, {
    x: 40,
    y: 50,
    width: 320,
    height: 180
  });
});

test('dragging only begins after a valid press on the crop area or resize handle', t => {
  const {cropper, cursor} = setup();

  cropper.startMoving({button: 2, pageX: 110, pageY: 110});
  cursor.setCursor({pageX: 140, pageY: 140});
  t.like(cropper.state, {x: 100, y: 100});

  cropper.startMoving({button: 0, pageX: 110, pageY: 110});
  cursor.setCursor({pageX: 140, pageY: 140});
  t.like(cropper.state, {x: 130, y: 130});

  cropper.endInteraction('pointer-up');
  cropper.startResizing({right: true, left: false, top: false, bottom: false}, {button: 0});
  cursor.setCursor({pageX: 360, pageY: 250});
  t.like(cropper.state, {
    width: 230,
    isResizing: true,
    activeGesture: 'resizing'
  });
});

test('releasing outside the overlay ends the active interaction', t => {
  const {cropper, cursor} = setup();

  cropper.startMoving({button: 0, pageX: 110, pageY: 110});
  cursor.setCursor({pageX: 140, pageY: 140});
  t.like(cropper.state, {x: 130, y: 130, isMoving: true});

  cropper.endInteraction('window-blur');
  t.like(cropper.state, {
    isMoving: false,
    isPointerDown: false,
    activeGesture: null
  });
  t.is(cursor.state.observers.length, 0);

  cursor.setCursor({pageX: 300, pageY: 300});
  t.like(cropper.state, {x: 130, y: 130});
});

test('rapid close and reopen does not duplicate cursor observers', t => {
  const {cropper, cursor} = setup();

  cropper.startMoving({button: 0, pageX: 110, pageY: 110});
  cropper.startMoving({button: 0, pageX: 120, pageY: 120});
  t.is(cursor.state.observers.length, 1);

  cropper.resetInteractionState('close');
  cropper.setDisplay({id: 1, width: 800, height: 600, isActive: true, cropper: {x: 100, y: 100, width: 200, height: 120}});
  cropper.setDisplay({id: 1, width: 800, height: 600, isActive: true, cropper: {x: 100, y: 100, width: 200, height: 120}});
  t.is(cursor.state.observers.length, 0);

  cropper.startResizing({right: true, left: false, top: false, bottom: false}, {button: 0});
  cropper.startResizing({right: true, left: false, top: false, bottom: false}, {button: 0});
  t.is(cursor.state.observers.length, 1);
});
