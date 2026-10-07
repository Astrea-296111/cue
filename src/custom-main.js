// custom-main.js
// Project-specific integration layer on top of bugfix-main.js.
// Adds shortcut overrides, local project RAG, and low-latency hooks.
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

let lastManualQuestion = '';
let lastManualQuestionAt = 0;

function buildRetrievalQuery(transcript) {
  const now = Date.now();
  if (lastManualQuestion && now - lastManualQuestionAt < 15000) {
    return lastManualQuestion;
  }

  const turns = Array.isArray(transcript) ? transcript : [];
  return turns
    .filter((turn) => turn && turn.channel === 'them' && turn.text)
    .slice(-2)
    .map((turn) => String(turn.text).trim())
    .filter(Boolean)
    .join('\n');
}

function inferModeTokenBudget(system, hasImage) {
  const text = String(system || '');
  if (/正在实时帮助一名中文技术求职候选人组织口述答案/.test(text)) return 800;
  if (/下面会给出面试官的一道明确问题/.test(text)) return 600;
  if (/技术面试过程中给候选人提供实时辅助/.test(text)) return 1600;
  if (/面向 Agent \/ Java \/ Go \/ 后端开发求职/.test(text)) return 800;
  if (/资深中文技术面试现场题助手/.test(text)) return 3200;
  if (/复盘本场技术面试/.test(text)) return 2400;
  if (/适合技术面试结尾的高质量反问/.test(text)) return 700;
  return hasImage ? 1600 : null;
}

function inferModeName(system, hasImage) {
  const text = String(system || '');
  if (/正在实时帮助一名中文技术求职候选人组织口述答案/.test(text)) return 'say';
  if (/下面会给出面试官的一道明确问题/.test(text)) return 'answerThis';
  if (/技术面试过程中给候选人提供实时辅助/.test(text)) return 'assist';
  if (/面向 Agent \/ Java \/ Go \/ 后端开发求职/.test(text)) return 'ask';
  if (/资深中文技术面试现场题助手/.test(text)) return 'leetcode';
  if (/复盘本场技术面试/.test(text)) return 'recap';
  if (/适合技术面试结尾的高质量反问/.test(text)) return 'followup';
  return hasImage ? 'screen' : 'unknown';
}

function installModuleHooks() {
  const interviewTarget = path.resolve(__dirname, 'interview-context.js');
  const llmTarget = path.resolve(__dirname, 'llm.js');
  const originalLoad = Module._load;

  Module._load = function cueOptimizedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    let resolved = '';
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
    const resolvedPath = path.resolve(String(resolved || ''));

    if (
      resolvedPath === interviewTarget &&
      loaded &&
      typeof loaded.buildInterviewContext === 'function' &&
      !loaded.__cueProjectRetrievalWrapped
    ) {
      const originalBuildInterviewContext = loaded.buildInterviewContext;
      const wrapped = { ...loaded };

      wrapped.buildInterviewContext = function buildProjectAwareInterviewContext(settings, mode, transcript) {
        const originalTranscript = Array.isArray(transcript) ? transcript : [];
        const hasFreshProvisional = lastManualQuestion && Date.now() - lastManualQuestionAt < 15000;
        const contextTranscript = hasFreshProvisional
          ? [...originalTranscript, { channel: 'them', text: lastManualQuestion, ts: lastManualQuestionAt, provisional: true }]
          : originalTranscript;
        const base = originalBuildInterviewContext(settings, mode, contextTranscript);
        if (mode === 'leetcode') return base;

        const query = buildRetrievalQuery(contextTranscript);
        if (!query || query.length < 4) return base;

        const category = typeof loaded.detectCategory === 'function'
          ? loaded.detectCategory(contextTranscript)
          : 'general';
        const relevantCategory = ['project', 'technical', 'situational', 'experience', 'general'].includes(category);
        if (!relevantCategory) return base;

        const fastLane = mode === 'say' || mode === 'answerThis';
        const started = Date.now();
        let results = projectKnowledge.searchProjectKnowledge(query, {
          limit: fastLane ? (category === 'project' ? 4 : 3) : (category === 'project' ? 7 : 5),
          maxChars: fastLane ? (category === 'project' ? 2800 : 2000) : (category === 'project' ? 5000 : 3200),
          minScore: category === 'project' ? 3.2 : 5.2
        });

        if (!results.length && category === 'project') {
          results = projectKnowledge.getProjectOverviewChunks({
            limit: fastLane ? 3 : 5,
            maxChars: fastLane ? 2400 : 4200
          });
        }

        const elapsed = Date.now() - started;
        if (elapsed >= 2) {
          console.log(`[latency][rag] mode=${mode} category=${category} search=${elapsed}ms hits=${results.length}`);
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
            const modeName = inferModeName(params.system, !!params.imageDataUrl);
            const inferred = params.maxTokens || inferModeTokenBudget(params.system, !!params.imageDataUrl);
            const originalOnToken = typeof params.onToken === 'function' ? params.onToken : () => {};
            let firstTokenAt = 0;
            const nextParams = {
              ...params,
              ...(inferred ? { maxTokens: inferred } : {}),
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

// NOTE: The previous Turbo build rewrote main.js/llm.js source at runtime.
// That approach was format-sensitive and could partially patch a locally modified file,
// leaving runFeature() with undefined variables. Keep optimization at exported-module
// boundaries instead: RAG/context and token-budget hooks above are stable across formatting.

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

ipcMain.on('project:prefetch', (_event, query) => {
  const text = typeof query === 'string' ? query.trim() : '';
  if (text.length < 4) return;
  setImmediate(() => {
    const started = Date.now();
    projectKnowledge.prefetchProjectKnowledge(text, {
      limit: 4,
      maxChars: 2800,
      minScore: 3.2
    });
    const elapsed = Date.now() - started;
    if (elapsed >= 2) console.log(`[latency][rag] prefetch=${elapsed}ms`);
  });
});

// Hooks must be active before bugfix-main loads ../main.js, because main.js
// destructures buildInterviewContext/createLLM at module-load time.
// No runtime source rewriting is used here.
const restoreModuleLoader = installModuleHooks();
try {
  require('./bugfix-main.js');
} finally {
  restoreModuleLoader();
}
console.log('[cue][turbo] safe hotfix active: RAG prefetch + interim fast lane + Qwen low-latency; source rewriting disabled.');

// Capture manually typed questions and provisional STT questions before main.js
// handles the same IPC event, so project retrieval can use them immediately.
ipcMain.prependListener('ask', (_event, payload = {}) => {
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    lastManualQuestion = '';
    lastManualQuestionAt = 0;
    return;
  }
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
  globalShortcut.unregister(SAY_ACCELERATOR);
  globalShortcut.unregister(OLD_SAY_ACCELERATOR);
  globalShortcut.unregister(ASSIST_ACCELERATOR);
  globalShortcut.unregister(HIDE_ACCELERATOR);

  registerShortcut('What should I say?', SAY_ACCELERATOR, () => sendMode('say'));
  registerShortcut('Assist', ASSIST_ACCELERATOR, () => sendMode('assist'));
  registerShortcut('Hide', HIDE_ACCELERATOR, toggleHide);
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
  installShortcutOverrides,
  inferModeTokenBudget
};
