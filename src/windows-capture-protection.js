'use strict';

const os = require('node:os');
const WDA_EXCLUDEFROMCAPTURE = 0x11;

// Electron 33 ignores SetWindowDisplayAffinity's BOOL result. Use the real
// HWND and read the OS state back, rather than trusting isContentProtected().
function createWindowsCaptureProtection({ loadKoffi = () => require('koffi'), release = os.release } = {}) {
  let api;
  function nativeApi() {
    if (api) return api;
    const [major, , build] = release().split('.').map(Number);
    if (major < 10 || !Number.isFinite(build) || (major === 10 && build < 19041)) {
      throw new Error('完整窗口捕获排除需要 Windows 10 内部版本 19041 或更新版本');
    }
    const koffi = loadKoffi();
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      set: user32.func('int __stdcall SetWindowDisplayAffinity(void *hwnd, uint32_t affinity)'),
      get: user32.func('int __stdcall GetWindowDisplayAffinity(void *hwnd, _Out_ uint32_t *affinity)'),
      error: kernel32.func('uint32_t __stdcall GetLastError()')
    };
    return api;
  }

  function handle(win) {
    const bytes = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(bytes) || ![4, 8].includes(bytes.length)) throw new Error('无效的 Windows 窗口句柄');
    // Passing the Buffer itself would pass its address, not the HWND it holds.
    const hwnd = bytes.length === 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
    if (hwnd === 0n) throw new Error('Windows 窗口句柄为空');
    return hwnd;
  }

  function read(hwnd, native) {
    const value = [0];
    if (!native.get(hwnd, value)) throw new Error(`GetWindowDisplayAffinity 失败，Win32=${native.error()}`);
    return value[0];
  }

  return {
    apply(win) {
      const native = nativeApi();
      const hwnd = handle(win);
      if (!native.set(hwnd, WDA_EXCLUDEFROMCAPTURE)) {
        throw new Error(`SetWindowDisplayAffinity 失败，Win32=${native.error()}`);
      }
      const affinity = read(hwnd, native);
      if (affinity !== WDA_EXCLUDEFROMCAPTURE) {
        throw new Error(`Windows 未启用窗口捕获排除，affinity=0x${affinity.toString(16)}`);
      }
      return affinity;
    },
    inspect(win) { return read(handle(win), nativeApi()); }
  };
}

module.exports = { createWindowsCaptureProtection, WDA_EXCLUDEFROMCAPTURE };
