'use strict';

// Run on a Windows desktop: npm run test:protection. No real user content is
// captured or written to disk. --native-only omits desktop capture for CI.
const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const assert = require('node:assert/strict');
const { createWindowsCaptureProtection } = require('../src/windows-capture-protection');
const { attachWindowProtection, showWindowWithProtection, setProtectedMouseEvents, requestWindowProtection } = require('../src/window-protection');

if (process.platform !== 'win32') {
  console.error('This smoke test requires Windows 10 build 19041+ and Electron.');
  app.exit(2);
} else {
  const capture = !process.argv.includes('--native-only');
  const native = createWindowsCaptureProtection();
  const windows = [];
  const timeout = setTimeout(() => { console.error('CAPTURE_PROTECTION_TIMEOUT'); app.exit(1); }, 30000);
  app.whenReady().then(async () => {
    const display = screen.getPrimaryDisplay();
    const { x, y } = display.workArea;
    async function rectangle(color, offset, width, height) {
      const win = new BrowserWindow({ show: false, x: x + offset, y: y + offset,
        width, height, frame: false, transparent: true, hasShadow: false,
        alwaysOnTop: true, skipTaskbar: true,
        webPreferences: { contextIsolation: true, sandbox: true } });
      windows.push(win);
      await win.loadURL('data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;width:100%;height:100%;background:${color}}</style>`));
      return win;
    }
    const background = await rectangle('#00ff00', 40, 400, 300);
    const overlay = await rectangle('#ff00ff', 80, 200, 150);
    async function until(check, message) {
      const deadline = Date.now() + 5000;
      do {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error(message);
    }
    async function centerColor(expected) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size });
      const source = sources.find(item => item.display_id === String(display.id));
      assert.ok(source && !source.thumbnail.isEmpty(), 'No thumbnail for the primary display');
      const image = source.thumbnail, size = image.getSize(), bounds = overlay.getBounds();
      const px = Math.floor((bounds.x + bounds.width / 2 - display.bounds.x) * size.width / display.bounds.width);
      const py = Math.floor((bounds.y + bounds.height / 2 - display.bounds.y) * size.height / display.bounds.height);
      const bitmap = image.toBitmap(), at = (py * size.width + px) * 4;
      const rgb = [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
      return rgb.every((value, index) => Math.abs(value - expected[index]) < 15);
    }
    function verified() {
      assert.equal(native.inspect(overlay), 0x11, 'Native WDA_EXCLUDEFROMCAPTURE must remain enabled');
      assert.equal(overlay.isVisible(), true, 'The local user must still see the overlay');
    }
    if (capture) {
      background.show();
      overlay.show();
      await until(() => centerColor([255, 0, 255]), 'Unprotected test rectangle was not captured; capture check is invalid');
      overlay.hide();
    }
    attachWindowProtection(overlay);
    assert.equal(showWindowWithProtection(overlay, { activate: true }), true);
    verified();
    if (capture) await until(() => centerColor([0, 255, 0]), 'Protected overlay remains visible in desktop capture');
    for (const ignore of [true, false]) {
      assert.equal(setProtectedMouseEvents(overlay, ignore), true);
      verified();
      if (capture) await until(() => centerColor([0, 255, 0]), 'Click-through exposed protected content');
    }
    overlay.setResizable(false);
    assert.equal(requestWindowProtection(overlay), true);
    overlay.hide();
    assert.equal(showWindowWithProtection(overlay), true);
    overlay.setPosition(x + 90, y + 90);
    verified();
    if (capture) await until(() => centerColor([0, 255, 0]), 'Restoring or moving exposed protected content');
    console.log('CAPTURE_PROTECTION_OK', JSON.stringify({ windows: require('node:os').release(), electron: process.versions.electron,
      affinity: '0x11', localWindowVisible: true, desktopCaptureVerified: capture, clickThroughAndRestoreVerified: true }));
  }).then(() => finish(0), error => { console.error(error.stack || error); finish(1); });

  function finish(code) {
    clearTimeout(timeout);
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    app.exit(code);
  }
}
