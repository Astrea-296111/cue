'use strict';

// Electron returns void here. Success means the OS protection was requested,
// not that every recording API honors it or that the OS cannot see the window.
function requestWindowProtection(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    win.setContentProtection(true);
    return true;
  } catch (error) {
    try { win.hide(); } catch (_) {}
    console.error('[cue] 窗口录屏保护请求失败，已阻止主动显示：', error?.message || String(error));
    return false;
  }
}

function showWindowWithProtection(win, { activate = false } = {}) {
  if (!requestWindowProtection(win)) return false;
  if (activate) win.show();
  else win.showInactive();
  return true;
}

module.exports = { requestWindowProtection, showWindowWithProtection };
