const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');

const root = path.resolve(__dirname, '..');

test('package entry loads custom, bugfix and root main in the live runtime', t => {
  const runtime = createInterviewRuntime(t);
  const chain = ['src/custom-main.js', 'src/bugfix-main.js', 'main.js'];
  const order = chain.map(file => runtime.loaded.indexOf(file));
  assert.ok(order.every(index => index >= 0));
  assert.ok(order[0] < order[1] && order[1] < order[2]);
  assert.equal(runtime.loaded.includes('src/main.js'), false);
});

test('passthrough shortcut overrides renderer mouse state until toggled off and ignores destroyed senders', async () => {
  const code = fs.readFileSync(path.join(root, 'src', 'bugfix-main.js'), 'utf8');
  const app = new EventEmitter(), ipcMain = new EventEmitter(), shortcuts = new Map();
  const changes = [], foreignChanges = [];
  let destroyed = false;
  const win = new EventEmitter();
  win.isDestroyed = () => destroyed;
  win.webContents = { getURL: () => 'file:///cue/renderer/index.html',
    executeJavaScript: async () => {}, send() {} };
  win.setIgnoreMouseEvents = value => changes.push(value);
  win.setResizable = () => {};
  win.setContentProtection = () => {};
  const foreign = { isDestroyed: () => false, webContents: { getURL: () => 'file:///cue/renderer/permissions.html' },
    setIgnoreMouseEvents: value => foreignChanges.push(value) };
  app.whenReady = () => Promise.resolve();
  const electron = { app, ipcMain, screen: {},
    BrowserWindow: { getAllWindows: () => [win, foreign],
      fromWebContents: sender => sender === win.webContents ? win : null },
    globalShortcut: { register: (key, fn) => { shortcuts.set(key, fn); return true; } } };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, process, console,
    setTimeout, clearTimeout, require(id) {
      if (id === 'electron') return electron;
      if (id === './window-layout') return require('../src/window-layout');
      if (id === './window-protection') return require('../src/window-protection').createWindowProtection({ platform: 'linux' });
      if (id === '../main.js') {
        // Upstream listeners must be replaced, rather than accumulating.
        ipcMain.on('mouse:ignore', () => { throw Error('Old listener was not replaced'); });
        return {};
      }
      throw Error('Unexpected import: ' + id);
    } }, { filename: path.join(root, 'src/bugfix-main.js') });
  await Promise.resolve();
  assert.equal(ipcMain.listenerCount('mouse:ignore'), 1);
  const toggle = shortcuts.get('CommandOrControl+Shift+I');
  assert.equal(typeof toggle, 'function');
  const event = { sender: win.webContents };
  ipcMain.emit('mouse:ignore', event, false);
  assert.equal(changes.at(-1), false);
  toggle();
  ipcMain.emit('mouse:ignore', event, false);
  assert.equal(changes.at(-1), true, 'Renderer must not cancel forced passthrough');
  toggle();
  ipcMain.emit('mouse:ignore', event, true);
  assert.equal(changes.at(-1), true);
  ipcMain.emit('mouse:ignore', event, false);
  assert.equal(changes.at(-1), false, 'Normal renderer hover resumes after toggling off');
  const before = changes.length;
  destroyed = true;
  assert.doesNotThrow(() => ipcMain.emit('mouse:ignore', event, true));
  assert.doesNotThrow(() => ipcMain.emit('mouse:ignore', { sender: {} }, true));
  assert.equal(changes.length, before);
  assert.deepEqual(foreignChanges, []);
});

test('packaged builds bundle whisper by default', () => {
  const code = fs.readFileSync(path.join(root, 'scripts', 'after-pack.js'), 'utf8');
  assert.ok(!/process\.env\.CUE_BUNDLE_WHISPER/.test(code));
  assert.match(code, /CUE_SKIP_WHISPER/);
  assert.match(code, /prepareWhisperRuntime/);
});

test('mac source checksum includes PR53 correction', () => {
  const manifest = require('../src/whisper-runtime-manifest');
  assert.equal(
    manifest.SOURCE_ARCHIVE_SHA256,
    '98a57a88ef0e733b746544f8ea25157d3265fbf0dac5c32dbb527e6ef4dbfaac'
  );
  const win = manifest.getRuntimeTarget('win32', 'x64');
  assert.equal(win.executable, 'whisper-server.exe');
  assert.equal(win.sha256, '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539');
});
