// custom-main.js
// Project-specific integration layer on top of bugfix-main.js.
// Adds shortcut overrides, scoped RAG prefetch, and low-latency hooks.
// This hotfix intentionally avoids runtime source rewriting of main.js/llm.js.

const path = require('path');
const Module = require('module');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  dialog
} = require('electron');
const projectKnowledge = require('./project-knowledge');
const { notifyProjectSourcesChanged } = require('./project-rag-session');
const { moveWindow } = require('./window-layout');

function installModuleHooks() {
  const llmTarget = path.resolve(__dirname, 'llm.js');
  const originalLoad = Module._load;

  Module._load = function cueOptimizedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let resolved = '';
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
    const resolvedPath = path.resolve(String(resolved || ''));

    if (
      resolvedPath === llmTarget &&
      loaded &&
      typeof loaded.createLLM === 'function' &&
      !loaded.__cueLatencyWrapped
    ) {
      const originalCreateLLM = loaded.createLLM;
      const wrapped = { ...loaded };

      wrapped.createLLM = function createLatencyAwareLLM(settings) {
        const llm = originalCreateLLM(settings);
        if (!llm || typeof llm.stream !== 'function') return llm;
        const originalStream = llm.stream.bind(llm);
        return {
          ...llm,
          async stream(params = {}) {
            const startedAt = Date.now();
            const modeName = params.mode || (params.imageDataUrl ? 'screen' : 'unknown');
            const originalOnToken = typeof params.onToken === 'function' ? params.onToken : () => {};
            let firstTokenAt = 0;
            const nextParams = {
              ...params,
              onToken(token) {
                if (!firstTokenAt) {
                  firstTokenAt = Date.now();
                  console.log(`[latency][llm] mode=${modeName} first_token=${firstTokenAt - startedAt}ms`);
                }
                originalOnToken(token);
              }
            };
            const result = await originalStream(nextParams);
            console.log(`[latency][llm] mode=${modeName} done=${Date.now() - startedAt}ms`);
            return result;
          }
        };
      };

      Object.defineProperty(wrapped, '__cueLatencyWrapped', {
        value: true,
        enumerable: false
      });
      return wrapped;
    }

    return loaded;
  };

  return () => {
    Module._load = originalLoad;
  };
}

// Observe exported-module boundaries without rewriting source or model budgets.

function focusedWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => win && !win.isDestroyed()) || null;
}

ipcMain.handle('project:index-state', () => projectKnowledge.getProjectIndexState());

ipcMain.handle('project:import-folder', async () => {
  const owner = focusedWindow();
  const options = {
    title: '导入项目文件夹',
    properties: ['openDirectory']
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const state = await projectKnowledge.importProjectFolder(result.filePaths[0]);
  notifyProjectSourcesChanged(state);
  return { canceled: false, state };
});

ipcMain.handle('project:import-zip', async () => {
  const owner = focusedWindow();
  const options = {
    title: '导入项目 ZIP',
    properties: ['openFile'],
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const state = await projectKnowledge.importProjectZip(result.filePaths[0]);
  notifyProjectSourcesChanged(state);
  return { canceled: false, state };
});

ipcMain.handle('project:index-clear', async () => {
  const state = await projectKnowledge.clearProjectIndex();
  notifyProjectSourcesChanged(state);
  return { ok: true, state };
});

// Project prefetch is owned by main.js together with its authoritative session.

// Hooks must be active before bugfix-main loads ../main.js, because main.js
// destructures createLLM at module-load time. Project RAG belongs to project-context.
// No runtime source rewriting is used here.
const restoreModuleLoader = installModuleHooks();
try {
  require('./bugfix-main.js');
} finally {
  restoreModuleLoader();
}
console.log('[cue][turbo] safe hotfix active: RAG prefetch + resolved-question fast lane + Qwen low-latency; source rewriting disabled.');

const SAY_ACCELERATOR = 'CommandOrControl+Return';
const ASSIST_ACCELERATOR = 'CommandOrControl+Shift+Return';
// On a standard keyboard, ? is Shift+/, so Ctrl+? is Ctrl+Shift+/.
const LEGACY_ASSIST_ACCELERATOR = 'CommandOrControl+Shift+/';
const HIDE_ACCELERATOR = 'CommandOrControl+Shift+H';
const VISIBILITY_ACCELERATOR = 'CommandOrControl+P';
const RECORD_ACCELERATOR = 'CommandOrControl+R';
const MOVE_STEP = 25;
const MOVE_DIRECTIONS = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };

function isCueOverlayWindow(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    const url = win.webContents && win.webContents.getURL();
    return typeof url === 'string' && /\/renderer\/index\.html(?:$|[?#])/.test(url);
  } catch (_) {
    return false;
  }
}

function forEachCueWindow(callback) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isCueOverlayWindow(win)) continue;
    try { callback(win); } catch (_) {}
  }
}

function sendMode(mode) {
  forEachCueWindow((win) => {
    win.webContents.send('shortcut:mode', { mode });
  });
}

function toggleHide() {
  forEachCueWindow((win) => {
    win.webContents.send('hide:toggle', {});
  });
}

function toggleWindowVisibility() {
  forEachCueWindow((win) => {
    if (win.isVisible()) win.hide();
    else win.showInactive();
  });
}

function registerShortcut(name, accelerator, handler) {
  const ok = globalShortcut.register(accelerator, handler);
  if (!ok) {
    console.warn(`[cue] Could not register ${name}: ${accelerator}; another app may already own it.`);
  }
  return ok;
}

function installShortcutOverrides() {
  globalShortcut.unregister(SAY_ACCELERATOR);
  globalShortcut.unregister(ASSIST_ACCELERATOR);
  globalShortcut.unregister(LEGACY_ASSIST_ACCELERATOR);
  globalShortcut.unregister(HIDE_ACCELERATOR);
  globalShortcut.unregister(VISIBILITY_ACCELERATOR);
  globalShortcut.unregister(RECORD_ACCELERATOR);

  registerShortcut('如何回答', SAY_ACCELERATOR, () => sendMode('say'));
  registerShortcut('屏幕与问题', ASSIST_ACCELERATOR, () => sendMode('assist'));
  registerShortcut('屏幕与问题（Ctrl+?）', LEGACY_ASSIST_ACCELERATOR, () => sendMode('assist'));
  registerShortcut('Hide', HIDE_ACCELERATOR, toggleHide);
  registerShortcut('隐藏/恢复整个窗口', VISIBILITY_ACCELERATOR, toggleWindowVisibility);
  registerShortcut('开始/停止录音', RECORD_ACCELERATOR, () => {
    // System-audio capture needs a browser user gesture. Reuse the button with
    // Electron's userGesture flag so background shortcuts start both streams.
    forEachCueWindow((win) => {
      win.webContents.executeJavaScript("document.getElementById('stop-btn')?.click()", true)
        .catch((error) => console.warn('[cue] 录音快捷键失败:', error.message));
    });
  });

  for (const [direction, [dx, dy]] of Object.entries(MOVE_DIRECTIONS)) {
    const accelerator = `CommandOrControl+Shift+${direction}`;
    globalShortcut.unregister(accelerator);
    registerShortcut(`Move ${direction}`, accelerator, () => {
      forEachCueWindow((win) => {
        const [x, y] = win.getPosition();
        moveWindow(win, x + dx * MOVE_STEP, y + dy * MOVE_STEP);
      });
    });
  }
}

app.whenReady().then(() => {
  installShortcutOverrides();
});

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', () => {
    if (isCueOverlayWindow(win)) installShortcutOverrides();
  });
});

module.exports = {
  SAY_ACCELERATOR,
  ASSIST_ACCELERATOR,
  HIDE_ACCELERATOR,
  installShortcutOverrides
};
