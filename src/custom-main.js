// custom-main.js
// Project-specific integration layer on top of bugfix-main.js.
// 1) Reassigns the requested global shortcuts.
// 2) Adds local project-folder / ZIP indexing IPC.
// 3) Injects only the most relevant local project source snippets into interview context.

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

let lastManualQuestion = '';
let lastManualQuestionAt = 0;

function buildRetrievalQuery(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const interviewer = turns
    .filter((turn) => turn && turn.channel === 'them' && turn.text)
    .slice(-4)
    .map((turn) => String(turn.text).trim())
    .filter(Boolean);
  const parts = interviewer;
  if (lastManualQuestion && Date.now() - lastManualQuestionAt < 15000) {
    parts.push(lastManualQuestion);
  }
  return parts.join('\n');
}

function installInterviewContextRetrievalHook() {
  const target = path.resolve(__dirname, 'interview-context.js');
  const originalLoad = Module._load;

  Module._load = function cueProjectAwareLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let resolved = '';
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}

    if (
      path.resolve(String(resolved || '')) === target &&
      loaded &&
      typeof loaded.buildInterviewContext === 'function' &&
      !loaded.__cueProjectRetrievalWrapped
    ) {
      const originalBuildInterviewContext = loaded.buildInterviewContext;
      const wrapped = { ...loaded };

      wrapped.buildInterviewContext = function buildProjectAwareInterviewContext(settings, mode, transcript) {
        const base = originalBuildInterviewContext(settings, mode, transcript);
        if (mode === 'leetcode') return base;

        const query = buildRetrievalQuery(transcript);
        if (!query || query.length < 4) return base;

        const category = typeof loaded.detectCategory === 'function'
          ? loaded.detectCategory(transcript || [])
          : 'general';
        const relevantCategory = ['project', 'technical', 'situational', 'experience', 'general'].includes(category);
        if (!relevantCategory) return base;

        let results = projectKnowledge.searchProjectKnowledge(query, {
          limit: category === 'project' ? 7 : 5,
          maxChars: category === 'project' ? 5000 : 3200,
          minScore: category === 'project' ? 3.2 : 5.2
        });

        // Generic questions such as “介绍一下这个项目” may not contain the identifiers
        // that lexical retrieval needs. In project mode, fall back to README/build metadata
        // and the first useful source chunks instead of returning no project context.
        if (!results.length && category === 'project') {
          results = projectKnowledge.getProjectOverviewChunks({ limit: 5, maxChars: 4200 });
        }

        const retrieved = projectKnowledge.formatRetrievedProjectContext(results);
        if (!retrieved) return base;
        return [retrieved, base].filter(Boolean).join('\n\n');
      };

      Object.defineProperty(wrapped, '__cueProjectRetrievalWrapped', {
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

function focusedWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => win && !win.isDestroyed()) || null;
}

ipcMain.handle('project:index-state', () => projectKnowledge.getProjectIndexState());

ipcMain.handle('project:import-folder', async () => {
  const owner = focusedWindow();
  const options = {
    title: 'Import project folder',
    properties: ['openDirectory']
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const state = await projectKnowledge.importProjectFolder(result.filePaths[0]);
  return { canceled: false, state };
});

ipcMain.handle('project:import-zip', async () => {
  const owner = focusedWindow();
  const options = {
    title: 'Import project ZIP',
    properties: ['openFile'],
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const state = await projectKnowledge.importProjectZip(result.filePaths[0]);
  return { canceled: false, state };
});

ipcMain.handle('project:index-clear', async () => {
  const state = await projectKnowledge.clearProjectIndex();
  return { ok: true, state };
});

// The hook must be active before bugfix-main loads ../main.js, because main.js
// destructures buildInterviewContext at module-load time.
const restoreModuleLoader = installInterviewContextRetrievalHook();
try {
  // Loads the existing pointer/capture hardening, which in turn loads ../main.js.
  require('./bugfix-main.js');
} finally {
  // main.js now holds the wrapped function; restore Node's loader immediately.
  restoreModuleLoader();
}

// Capture manually typed questions before main.js handles the same IPC event, so
// local project retrieval also works for composer questions, not only STT turns.
ipcMain.prependListener('ask', (_event, payload = {}) => {
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  lastManualQuestion = text;
  lastManualQuestionAt = Date.now();
});

const SAY_ACCELERATOR = 'CommandOrControl+Return';
// On a standard keyboard, ? is Shift+/, so Ctrl+? is Ctrl+Shift+/.
const ASSIST_ACCELERATOR = 'CommandOrControl+Shift+/';
const HIDE_ACCELERATOR = 'CommandOrControl+Shift+H';
const OLD_SAY_ACCELERATOR = 'CommandOrControl+Shift+Return';

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

function registerShortcut(name, accelerator, handler) {
  const ok = globalShortcut.register(accelerator, handler);
  if (!ok) {
    console.warn(`[cue] Could not register ${name}: ${accelerator}; another app may already own it.`);
  }
  return ok;
}

function installShortcutOverrides() {
  // Remove the upstream bindings that are being reassigned.
  globalShortcut.unregister(SAY_ACCELERATOR);       // upstream Assist
  globalShortcut.unregister(OLD_SAY_ACCELERATOR);   // upstream What should I say?
  globalShortcut.unregister(ASSIST_ACCELERATOR);    // upstream Hide (Ctrl+Shift+/)
  globalShortcut.unregister(HIDE_ACCELERATOR);      // make re-install idempotent

  registerShortcut('What should I say?', SAY_ACCELERATOR, () => sendMode('say'));
  registerShortcut('Assist', ASSIST_ACCELERATOR, () => sendMode('assist'));
  registerShortcut('Hide', HIDE_ACCELERATOR, toggleHide);
}

// On Windows this runs after main.js has registered its original shortcuts.
// Re-install again after the overlay loads so macOS permission-gate startup is
// also handled correctly.
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
