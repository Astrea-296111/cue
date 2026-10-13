'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { windowLayout, initialWindowLayout, attachWindowLayout, moveWindow } = require('../src/window-layout');

// 1920x1080 physical pixels at the user's Windows 125% scale.
const primary = { id: 1, scaleFactor: 1.25,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 832 } };
const secondary = { id: 2, scaleFactor: 1,
  bounds: { x: 1536, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1536, y: 0, width: 2560, height: 1400 } };

function screens() {
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = () => primary;
  screen.getDisplayNearestPoint = ({ x }) => x >= secondary.bounds.x ? secondary : primary;
  screen.getDisplayMatching = () => { throw Error('Window width must not decide screen ownership'); };
  return screen;
}

function window(t, options = {}) {
  const screen = screens();
  const win = new EventEmitter();
  let position = [300, 0], size = [461, 416], zoom = 0.85;
  const writes = [];
  let reads = 0;
  let destroyed = false;
  win.getPosition = () => [...position];
  win.getSize = () => { reads++; return [size[0] + (options.rounding || 0), size[1]]; };
  win.isDestroyed = () => destroyed;
  win.setBounds = bounds => {
    writes.push({ ...bounds });
    size = [bounds.width, bounds.height];
    position = [bounds.x, bounds.y];
    // Windows native geometry notifications can arrive inside the write.
    win.emit('moved');
    screen.emit('display-metrics-changed', primary);
  };
  win.setPosition = () => { throw Error('Native setPosition accumulates rounded dimensions'); };
  const webContents = new EventEmitter();
  webContents.isDestroyed = () => destroyed;
  webContents.getZoomFactor = () => zoom;
  webContents.setZoomFactor = value => { zoom = value; };
  Object.defineProperty(win, 'webContents', { get() {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return webContents;
  } });
  const detach = attachWindowLayout(win, screen, primary);
  t.after(detach);
  return { win, screen, writes, webContents, detach,
    close() { destroyed = true; win.emit('closed'); },
    move(x, y = 30) { position = [x, y]; win.emit('moved'); },
    setWidth(width) { size[0] = width; },
    get reads() { return reads; },
    get size() { return [...size]; },
    get zoom() { return zoom; } };
}

test('startup at 125% halves the previously enlarged UI and keeps a previously clipped window fully visible', () => {
  const layout = initialWindowLayout(screens(), { windowX: 1500, windowY: 800 });
  assert.equal(layout.width, 461);
  assert.equal(layout.height, 416);
  assert.equal(layout.zoomFactor, 0.85);
  assert.ok(Math.abs(layout.width * 1.25 - 1920 * 0.3) <= 1);
  assert.equal(layout.x, 1075);
  assert.equal(layout.y, 416);
  assert.ok(layout.x + layout.width <= primary.workArea.width);
  assert.ok(layout.y + layout.height <= primary.workArea.height);
});

test('startup uses the saved monitor rather than the primary monitor', () => {
  const layout = initialWindowLayout(screens(), { windowX: 2200, windowY: 50 });
  assert.equal(layout.display.id, 2);
  assert.equal(layout.width, 768);
  assert.equal(layout.height, 600);
  assert.equal(layout.x, 2200);
});

test('startup without a saved position centers a fully visible 30% window', () => {
  const layout = initialWindowLayout(screens(), { windowX: null, windowY: null });
  assert.equal(layout.width, 461);
  assert.equal(layout.x, 538);
  assert.equal(layout.y, 6);
});

test('hundreds of same-screen moves never rewrite dimensions under fractional DPI', t => {
  const app = window(t, { rounding: 1 });
  app.win.webContents.emit('did-finish-load');
  assert.equal(app.writes.length, 0);
  const reads = app.reads;
  for (let i = 0; i < 500; i++) {
    app.move(500 + i % 100);
    app.screen.emit('display-metrics-changed', primary);
  }
  assert.equal(app.reads, reads, 'Moving must not keep measuring or correcting size');
  assert.equal(app.writes.length, 0);
  assert.deepEqual(app.size, [461, 416]);
});

test('one startup correction cannot recurse through synchronous moved or screen notifications', t => {
  const app = window(t);
  app.setWidth(550);
  app.win.webContents.emit('did-finish-load');
  assert.equal(app.writes.length, 1);
  assert.deepEqual(app.size, [461, 416]);
  for (let i = 0; i < 100; i++) app.move(500 + i);
  assert.equal(app.writes.length, 1);
});

test('manual movement keeps the requested width and height instead of rounded native bounds', t => {
  const app = window(t, { rounding: 2 });
  app.win.webContents.emit('did-finish-load');
  assert.equal(app.writes.length, 0, 'Native enclosure does not need repeated startup correction');
  for (let i = 0; i < 500; i++) {
    moveWindow(app.win, 500 + i % 100, 30 + i % 80);
  }
  assert.equal(app.writes.length, 500);
  for (const bounds of app.writes) {
    assert.equal(bounds.width, 461);
    assert.equal(bounds.height, 416);
  }
  assert.deepEqual(app.size, [461, 416]);
});

test('crossing a monitor boundary changes layout once after movement settles', async t => {
  const app = window(t);
  for (let i = 0; i < 20; i++) app.move(1550 + i);
  assert.equal(app.writes.length, 0);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(app.writes.length, 1);
  assert.deepEqual(app.size, [768, 600]);
  assert.equal(app.zoom, 2560 / 1920);
  for (let i = 0; i < 100; i++) app.move(1560 + i);
  assert.equal(app.writes.length, 1);
  moveWindow(app.win, 1660, 30);
  assert.equal(app.writes.at(-1).width, 768, 'Manual movement carries the new screen width');
});

test('closing the window removes every layout listener and pending screen change', async t => {
  const app = window(t);
  app.move(1600);
  app.win.emit('closed');
  for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) assert.equal(app.screen.listenerCount(event), 0);
  assert.equal(app.win.listenerCount('moved'), 0);
  assert.equal(app.win.webContents.listenerCount('did-finish-load'), 0);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(app.writes.length, 0);
});

test('closed cleanup never reads a destroyed BrowserWindow and safely runs twice', async t => {
  const app = window(t);
  app.move(1600); // A monitor transition is still pending when the user quits.
  assert.doesNotThrow(() => app.close());
  assert.doesNotThrow(() => app.detach());
  assert.equal(app.webContents.listenerCount('did-finish-load'), 0);
  assert.equal(app.win.listenerCount('moved'), 0);
  assert.equal(app.win.listenerCount('closed'), 0);
  for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
    assert.equal(app.screen.listenerCount(event), 0);
    app.screen.emit(event, secondary);
  }
  app.webContents.emit('did-finish-load');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(app.writes.length, 0);
});

test('all displays halve the enlarged zoom and native bounds, including previously screen-capped sizes', () => {
  for (const width of [1024, 1280, 1536, 1920, 2560, 3840]) {
    const display = { bounds: { width }, workArea: { width: width - 40, height: 700 } };
    const layout = windowLayout(display);
    assert.equal(layout.zoomFactor, Math.min(1.4, Math.max(0.85, width / 1920)));
    assert.ok(layout.width <= display.workArea.width);
    assert.equal(layout.height, 350);
  }
  const portrait = { bounds: { width: 600 }, workArea: { width: 320, height: 900 } };
  assert.deepEqual(windowLayout(portrait), { width: 160, height: 450, zoomFactor: 0.85 });
});

test('changing the taskbar work area updates height once and keeps movement dimensions stable', t => {
  const app = window(t);
  const reduced = { ...primary, workArea: { ...primary.workArea, y: 40, height: 700 } };
  app.screen.getDisplayNearestPoint = () => reduced;
  app.screen.emit('display-metrics-changed', reduced);
  assert.equal(app.writes.length, 1);
  assert.deepEqual(app.writes[0], { x: 300, y: 40, width: 461, height: 350 });
  app.screen.emit('display-metrics-changed', reduced);
  assert.equal(app.writes.length, 1);
  moveWindow(app.win, 320, 40);
  assert.deepEqual(app.size, [461, 350]);
});

test('layout skips native zoom access when webContents was destroyed before the window', t => {
  const app = window(t);
  app.webContents.isDestroyed = () => true;
  app.webContents.getZoomFactor = () => { throw new TypeError('Object has been destroyed'); };
  app.webContents.emit('did-finish-load');
  app.screen.getDisplayNearestPoint = () => secondary;
  assert.doesNotThrow(() => app.screen.emit('display-metrics-changed', secondary));
  assert.equal(app.writes.length, 0);
});
