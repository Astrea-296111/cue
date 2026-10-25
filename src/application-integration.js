'use strict';

// Application extensions are registered explicitly by the package bootstrap.
const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const projectKnowledge = require('./project-knowledge');
const { moveWindow } = require('./window-layout');
const { showWindowWithProtection } = require('./window-protection');

const SAY_ACCELERATOR = 'CommandOrControl+Return';
const ASSIST_ACCELERATOR = 'CommandOrControl+Shift+Return';
const TECHNICAL_ACCELERATOR = 'CommandOrControl+L';
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
    else showWindowWithProtection(win);
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
  globalShortcut.unregister(TECHNICAL_ACCELERATOR);
  globalShortcut.unregister(LEGACY_ASSIST_ACCELERATOR);
  globalShortcut.unregister(HIDE_ACCELERATOR);
  globalShortcut.unregister(VISIBILITY_ACCELERATOR);
  globalShortcut.unregister(RECORD_ACCELERATOR);

  registerShortcut('如何回答', SAY_ACCELERATOR, () => sendMode('say'));
  registerShortcut('屏幕与问题', ASSIST_ACCELERATOR, () => sendMode('assist'));
  registerShortcut('上下文解题', TECHNICAL_ACCELERATOR, () => sendMode('technical'));
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


let installed = false;
function installApplicationIntegration() {
  if (installed) return;
  installed = true;
app.on('second-instance',()=>forEachCueWindow(win=>showWindowWithProtection(win,{activate:true})));
ipcMain.handle('project:index-state', () => projectKnowledge.getProjectIndexState());

// Compatibility source imports delegate to the same material authority; the current UI uses preview/commit IPC.
ipcMain.handle('project:import-folder', async () => {
  const selected=await dialog.showOpenDialog({properties:['openDirectory']});
  if(selected.canceled)return {canceled:true};
  return {canceled:false,state:await projectKnowledge.importProjectFolder(selected.filePaths[0])};
});
ipcMain.handle('project:import-zip', async () => {
  const selected=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});
  if(selected.canceled)return {canceled:true};
  return {canceled:false,state:await projectKnowledge.importProjectZip(selected.filePaths[0])};
});
ipcMain.handle('project:index-clear',async()=>{await projectKnowledge.clearProjectIndex();return {ok:true,state:projectKnowledge.getProjectIndexState()};});

app.whenReady().then(() => {
  installShortcutOverrides();
});

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', () => {
    if (isCueOverlayWindow(win)) installShortcutOverrides();
  });
});

}

module.exports = { installApplicationIntegration, SAY_ACCELERATOR, ASSIST_ACCELERATOR, HIDE_ACCELERATOR, installShortcutOverrides };
