'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowProtection } = require('../src/window-protection');
const { createWindowsCaptureProtection, WDA_EXCLUDEFROMCAPTURE } = require('../src/windows-capture-protection');

function fixture({ width = 8, release = '10.0.19045', setResult = 1, getResult = 1, readback = 0x11 } = {}) {
  const calls = [], win = new EventEmitter();
  const hwnd = width === 8 ? 0x123456789abcdef0n : 0xf1234567n;
  const bytes = Buffer.alloc(width);
  if (width === 8) bytes.writeBigUInt64LE(hwnd);
  else bytes.writeUInt32LE(Number(hwnd));
  win.getNativeWindowHandle = () => bytes;
  win.isDestroyed = () => false;
  win.setContentProtection = enabled => calls.push(['electron', enabled]);
  let visible = false, affinity = readback;
  win.show = () => { calls.push(['show']); visible = true; win.emit('show'); };
  win.showInactive = win.show;
  win.hide = () => { calls.push(['hide']); visible = false; win.emit('blur'); };
  win.setIgnoreMouseEvents = ignore => { calls.push(['mouse', ignore]); affinity = 0; };
  const native = createWindowsCaptureProtection({ release: () => release, loadKoffi: () => ({
    load: name => ({ func: signature => {
      if (signature.includes('SetWindowDisplayAffinity')) return (pointer, value) => {
        calls.push(['set', pointer, value]);
        if (setResult) affinity = readback;
        return setResult;
      };
      if (signature.includes('GetWindowDisplayAffinity')) return (pointer, output) => {
        calls.push(['get', pointer]); output[0] = affinity; return getResult;
      };
      if (signature.includes('GetLastError')) return () => 5;
      throw new Error('Unexpected native function: ' + name + ':' + signature);
    } })
  }) });
  const protection = createWindowProtection({ platform: 'win32', windowsProtection: native });
  return { win, calls, hwnd, native, protection, get visible() { return visible; } };
}

for (const width of [4, 8]) {
  test(`reads the ${width * 8}-bit HWND value and verifies native capture exclusion before display`, () => {
    const f = fixture({ width });
    assert.equal(f.protection.showWindowWithProtection(f.win), true);
    assert.equal(f.visible, true);
    assert.deepEqual(f.calls, [['electron', true], ['set', f.hwnd, 0x11], ['get', f.hwnd], ['show']]);
    assert.equal(f.native.inspect(f.win), WDA_EXCLUDEFROMCAPTURE);
  });
}

for (const failure of [
  { setResult: 0, message: /SetWindowDisplayAffinity.*Win32=5/ },
  { getResult: 0, message: /GetWindowDisplayAffinity.*Win32=5/ },
  { readback: 0, message: /affinity=0x0/ },
  { readback: 1, message: /affinity=0x1/ }
]) {
  test(`blocks display when Electron silently succeeds but native protection fails: ${failure.message}`, t => {
    const log = t.mock.method(console, 'error', () => {});
    const f = fixture(failure);
    f.protection.attachWindowProtection(f.win);
    assert.equal(f.protection.showWindowWithProtection(f.win), false);
    assert.equal(f.visible, false);
    assert.equal(f.calls.some(call => call[0] === 'show'), false);
    assert.equal(log.mock.callCount(), 1, 'hide/blur must not recurse or flood logs');
    assert.match(log.mock.calls[0].arguments.join(' '), failure.message);
  });
}

test('reapplies protection after click-through changes reset the affinity', () => {
  const f = fixture();
  f.protection.showWindowWithProtection(f.win);
  for (const ignore of [true, false]) {
    assert.equal(f.protection.setProtectedMouseEvents(f.win, ignore), true);
    assert.deepEqual(f.calls.slice(-4), [['mouse', ignore], ['electron', true], ['set', f.hwnd, 0x11], ['get', f.hwnd]]);
    assert.equal(f.native.inspect(f.win), 0x11);
  }
});

test('OS show, restore, focus and resize recheck protection and listeners attach once', () => {
  const f = fixture();
  f.protection.attachWindowProtection(f.win);
  f.protection.attachWindowProtection(f.win);
  for (const event of ['show', 'restore', 'focus', 'blur', 'resize']) {
    assert.equal(f.win.listenerCount(event), 1);
    f.win.emit(event);
    assert.deepEqual(f.calls.slice(-3), [['electron', true], ['set', f.hwnd, 0x11], ['get', f.hwnd]]);
  }
});

test('hides an already visible window if its native protection is lost during restore', t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture();
  let broken = false;
  const guard = createWindowProtection({ platform: 'win32', windowsProtection: {
    apply: win => { if (broken) throw Error('lost native protection'); return f.native.apply(win); }
  } });
  guard.attachWindowProtection(f.win);
  guard.showWindowWithProtection(f.win);
  assert.equal(f.visible, true);
  broken = true;
  f.win.emit('restore');
  assert.equal(f.visible, false);
  assert.equal(guard.showWindowWithProtection(f.win), false);
  broken = false;
  assert.equal(guard.showWindowWithProtection(f.win), true);
  assert.equal(f.visible, true);
});

test('failed protection in a show event is reflected in the display result', t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture();
  let attempts = 0;
  const guard = createWindowProtection({ platform: 'win32', windowsProtection: {
    apply() { if (++attempts > 1) throw Error('lost protection on show'); }
  } });
  guard.attachWindowProtection(f.win);
  assert.equal(guard.showWindowWithProtection(f.win), false);
  assert.equal(f.visible, false);
});

test('unsupported Windows versions cannot silently downgrade to a black captured rectangle', () => {
  for (const release of ['6.1.7601', '10.0.18363', 'invalid']) {
    const f = fixture({ release });
    assert.throws(() => f.native.apply(f.win), /19041/);
    assert.equal(f.calls.length, 0);
  }
});

test('missing native dependencies fail closed rather than falling back to an unchecked Electron call', t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture();
  const native = createWindowsCaptureProtection({ release: () => '10.0.22631', loadKoffi() { throw Error('missing native module'); } });
  const guard = createWindowProtection({ platform: 'win32', windowsProtection: native });
  assert.equal(guard.showWindowWithProtection(f.win), false);
  assert.equal(f.visible, false);
});

test('rejects null and malformed native handles before calling Win32', () => {
  const f = fixture();
  for (const bytes of [Buffer.alloc(8), Buffer.alloc(3), null]) {
    f.win.getNativeWindowHandle = () => bytes;
    assert.throws(() => f.native.apply(f.win), /句柄/);
  }
  assert.equal(f.calls.length, 0);
});
