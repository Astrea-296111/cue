'use strict';

const warnedDebugWindows = new WeakSet();

function debugProtectionDisabled({ isPackaged = false, env = process.env } = {}) {
  return !isPackaged && env.CUE_NO_PROTECT === '1';
}

// Electron returns void here. Success means the OS protection was requested,
// not that every recording API honors it or that the OS cannot see the window.
function requestWindowProtection(win, options = {}) {
  if (!win || win.isDestroyed()) return false;
  if (debugProtectionDisabled(options)) {
    if (!warnedDebugWindows.has(win)) {
      warnedDebugWindows.add(win);
      console.warn('[cue] 开发调试：CUE_NO_PROTECT=1，窗口录屏保护请求已跳过。打包版不允许此开关关闭保护。');
    }
    return true;
  }
  try {
    win.setContentProtection(true);
    return true;
  } catch (error) {
    try { win.hide(); } catch (_) {}
    console.error('[cue] 窗口录屏保护请求失败，已阻止主动显示：', error?.message || String(error));
    return false;
  }
}

function showWindowWithProtection(win, { activate = false, ...options } = {}) {
  if (!requestWindowProtection(win, options)) return false;
  if (activate) win.show();
  else win.showInactive();
  return true;
}

module.exports = { debugProtectionDisabled, requestWindowProtection, showWindowWithProtection };
