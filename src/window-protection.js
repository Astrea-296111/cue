'use strict';

function createWindowProtection({ platform = process.platform, windowsProtection } = {}) {
  const attached = new WeakSet();
  const checking = new WeakSet();
  const blocked = new WeakSet();
  // Electron's setter returns void even when the native Windows call fails.
  function requestWindowProtection(win) {
    if (!win || win.isDestroyed()) return false;
    if (checking.has(win)) return !blocked.has(win);
    checking.add(win);
    try {
      win.setContentProtection(true);
      if (platform === 'win32') {
        windowsProtection ||= require('./windows-capture-protection').createWindowsCaptureProtection();
        windowsProtection.apply(win);
      }
      blocked.delete(win);
      return true;
    } catch (error) {
      blocked.add(win);
      try { win.hide(); } catch (_) {}
      console.error('[cue] 窗口录屏保护请求失败，已隐藏窗口：', error?.message || String(error));
      return false;
    } finally {
      checking.delete(win);
    }
  }

  function showWindowWithProtection(win, { activate = false } = {}) {
    if (!requestWindowProtection(win)) return false;
    if (activate) win.show();
    else win.showInactive();
    return !blocked.has(win);
  }

  function attachWindowProtection(win) {
    if (!win || win.isDestroyed() || attached.has(win)) return;
    attached.add(win);
    // Explicit display paths verify BEFORE showing. These cover OS-initiated
    // restore/focus and window-style changes after creation as well.
    for (const event of ['show', 'restore', 'focus', 'blur', 'resize']) {
      win.on(event, () => requestWindowProtection(win));
    }
  }

  function setProtectedMouseEvents(win, ignore, options = { forward: true }) {
    if (!win || win.isDestroyed()) return false;
    win.setIgnoreMouseEvents(ignore, options);
    // Electron changes WS_EX_LAYERED / WS_EX_TRANSPARENT for click-through.
    return requestWindowProtection(win);
  }

  return { requestWindowProtection, showWindowWithProtection, attachWindowProtection, setProtectedMouseEvents };
}

module.exports = { ...createWindowProtection(), createWindowProtection };
