'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestWindowProtection, showWindowWithProtection } = require('../src/window-protection');

function window() {
  const calls = [];
  let visible = false, destroyed = false, fail = false;
  const win = {
    isDestroyed: () => destroyed,
    setContentProtection(enabled) {
      calls.push(['protect', enabled]);
      if (fail) throw Error('native protection request failed');
    },
    hide() { calls.push(['hide']); visible = false; },
    show() { calls.push(['show']); visible = true; },
    showInactive() { calls.push(['showInactive']); visible = true; }
  };
  return { win, calls, fail(value) { fail = value; }, destroy() { destroyed = true; },
    get visible() { return visible; } };
}

for (const value of [undefined, '', '0', 'false', 'true', '1']) {
  test(`CUE_NO_PROTECT=${String(value)} cannot disable protection`, t => {
    const previous = process.env.CUE_NO_PROTECT;
    if (value === undefined) delete process.env.CUE_NO_PROTECT;
    else process.env.CUE_NO_PROTECT = value;
    t.after(() => {
      if (previous === undefined) delete process.env.CUE_NO_PROTECT;
      else process.env.CUE_NO_PROTECT = previous;
    });
    const fixture = window();
    assert.equal(showWindowWithProtection(fixture.win), true);
    assert.deepEqual(fixture.calls, [['protect', true], ['showInactive']]);
  });
}

test('focused consent and permission windows request protection before showing', () => {
  const fixture = window();
  assert.equal(showWindowWithProtection(fixture.win, { activate: true }), true);
  assert.deepEqual(fixture.calls, [['protect', true], ['show']]);
});

test('a rejected native request hides the window, blocks restore and logs the failure without throwing', t => {
  const error = t.mock.method(console, 'error', () => {});
  const fixture = window();
  showWindowWithProtection(fixture.win);
  fixture.fail(true);
  assert.equal(showWindowWithProtection(fixture.win), false);
  assert.equal(fixture.visible, false);
  assert.deepEqual(fixture.calls.slice(-2), [['protect', true], ['hide']]);
  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments.join(' '), /native protection request failed/);
  fixture.fail(false);
  assert.equal(showWindowWithProtection(fixture.win), true);
  assert.equal(fixture.visible, true);
  assert.deepEqual(fixture.calls.slice(-2), [['protect', true], ['showInactive']]);
});

test('every hide and restore requests protection again before displaying the window', () => {
  const fixture = window();
  for (let i = 0; i < 10; i++) {
    assert.equal(showWindowWithProtection(fixture.win), true);
    fixture.win.hide();
  }
  assert.deepEqual(fixture.calls, Array.from({ length: 10 }, () => [['protect', true], ['showInactive'], ['hide']]).flat());
});

test('destroyed windows cannot be shown and do not call native APIs during shutdown', () => {
  const fixture = window();
  fixture.destroy();
  assert.equal(requestWindowProtection(fixture.win), false);
  assert.equal(showWindowWithProtection(fixture.win), false);
  assert.equal(showWindowWithProtection(null), false);
  assert.deepEqual(fixture.calls, []);
});
