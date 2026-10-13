const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, dialog, systemPreferences,net } = require('electron');
const path = require('path');
const { performance } = require('perf_hooks');
const { withCurrentQuestion, isLikelyFollowUp } = require('./src/project-query');
const { QuestionResolver } = require('./src/question-resolver');
const { planInterviewQuestion } = require('./src/interview-question-planner');
const { formatInterviewChecklist } = require('./src/interview-checklist');
const { formatProjectInterviewState } = require('./src/project-interview-state');
const { UI_SCALE, initialWindowLayout, attachWindowLayout } = require('./src/window-layout');
const replyLatency = require('./src/reply-latency');
const os = require('os');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { parseDocumentFile } = require('./src/resume');
const { createLLM } = require('./src/llm');
const { MODES, shouldCaptureScreen, getAnswerPlan, contextCharsFor } = require('./src/prompts');
const { ConversationMemory } = require('./src/conversation-memory');
const { getProjectCatalog, getProjectIndexRevision, warmProjectIndex } = require('./src/project-knowledge');
const { rms16 } = require('./src/wav');
const { createStreamingSTT } = require('./src/stt-streaming');
const { normalizeTranscript, TranscriptDeduper } = require('./src/transcript-normalizer');
const { normalizeTechnicalVocabulary } = require('./src/technical-vocabulary');
const { isSpeechNoise } = require('./src/speech-noise-filter');
const { AdaptiveVAD, AudioRingBuffer } = require('./src/vad');
const { buildInterviewContextBundle, detectCategory } = require('./src/interview-context');
const { startAppLink, stopAppLink, recordEvent, appLinkConsentState, revokeAppLinkCaller } = require('./src/applink');

// macOS system-audio loopback (the "them" channel via getDisplayMedia) does not
// start on Electron 31–38 unless these Chromium features are enabled; without
// them getDisplayMedia rejects with "Error starting capture" and meeting audio
// silently never works. Electron 39+ wires this up itself, where this is a
// harmless no-op. Must run before app is ready.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}
const { WhisperModelManager } = require('./src/whisper-model-manager');
const { requireWhisperModel } = require('./src/whisper-model-catalog');
const { locateWhisperRuntime } = require('./src/whisper-runtime');
const { LocalWhisperTranscriber } = require('./src/local-whisper-transcriber');

let win = null;
// Which global shortcuts cue actually holds. `globalShortcut.register` returns
// false when another application already owns the combination, and nothing used
// to look at that — so the only symptom was a key that did nothing. Iris reads
// this and can say which key is taken instead of guessing from a screenshot.
const shortcutState = { assist: false, say: false, leetcode: false, quit: false };
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// -------- Windows version helpers --------
// WDA_EXCLUDEFROMCAPTURE (setContentProtection) requires Windows 10 build 19041+.
// os.release() returns the NT kernel version e.g. "10.0.19041" or "10.0.22000" (Win11).
function getWindowsBuild() {
  if (!isWindows) return 0;
  const parts = os.release().split('.').map(Number);
  return parts[2] || 0; // third segment is the build number
}
const WIN_BUILD = getWindowsBuild();
const WIN_SUPPORTS_CONTENT_PROTECTION = !isWindows || WIN_BUILD >= 19041;

let permWin = null;

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const conversation = new ConversationMemory();
const questionResolver = new QuestionResolver();
const transcriptDeduper = new TranscriptDeduper();
let activeGeneration = null;
const transcript = []; // { channel, text, ts } — capped at MAX_TRANSCRIPT_TURNS
const MAX_TRANSCRIPT_TURNS = 200; // ~30–40 minutes of conversation at normal pace
const FLUSH_MS = 900;
const STREAM_INACTIVITY_MS = 25000; // abort a stalled LLM stream so state.busy can't wedge forever
const MIN_BYTES = Math.floor(16000 * 2 * 0.12); // ~0.12s
const RMS_GATE = 180;
let flushTimer = null;
let whisperModelManager = null;
let localWhisperTranscriber = null;
let activeWhisperModelId = null;
let desiredCaptureState = false;
let captureTransition = Promise.resolve(false);

// -------- streaming STT state --------
let streamingSTT = { you: null, them: null }; // streaming STT instances per channel
let streamingMode = false; // true when using WebSocket streaming STT
const vad = {
  you: new AdaptiveVAD({
    onsetThreshold: 220,
    offsetThreshold: 130,
    silenceFrames: 18,       // ~540ms silence before end
    onSpeechStart: () => send('vad:state', { channel: 'you', speaking: true, speechStartedAt: Date.now() }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'you', speaking: false, durationMs: dur, speechEndedAt: Date.now() })
  }),
  them: new AdaptiveVAD({
    onsetThreshold: 200,
    offsetThreshold: 120,
    silenceFrames: 20,       // ~600ms for remote audio (more forgiving)
    onSpeechStart: () => send('vad:state', { channel: 'them', speaking: true, speechStartedAt: Date.now() }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'them', speaking: false, durationMs: dur, speechEndedAt: Date.now() })
  })
};
// Pre-speech ring buffers (300ms) so we never clip the start of a word
const ringBuffers = {
  you: new AudioRingBuffer(300, 16000),
  them: new AudioRingBuffer(300, 16000)
};

function pushTranscript(turn) {
  transcript.push(turn);
  if (transcript.length > MAX_TRANSCRIPT_TURNS) transcript.splice(0, transcript.length - MAX_TRANSCRIPT_TURNS);
}

function send(channel, data) {
  // Keep answer targeting in the main process so keyboard shortcuts, renderer
  // buttons and every STT provider all share exactly the same question state.
  if (channel === 'vad:state') questionResolver.speechState(data);
  if (channel === 'stt:interim') questionResolver.observe(data, false);
  if (channel === 'transcript') questionResolver.observe(data, true);
  replyLatency.observe(channel, data);
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function getWhisperRuntime() {
  // `electron .` development launches can still report app.isPackaged=true
  // in customized/rebranded Electron builds.
  // process.defaultApp is the reliable signal that the app was launched
  // through the Electron development executable.
  const runningFromSource = process.defaultApp === true;

  return locateWhisperRuntime({
    isPackaged: app.isPackaged && !runningFromSource,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    architecture: process.arch,
    environment: process.env
  });
}

function normalizeSpeechText(text, settings = store.getSettings(), recentText = '') {
  let normalized = normalizeTranscript(text, settings);
  if (!normalized) return '';
  normalized = normalizeTechnicalVocabulary(normalized, { settings, recentText });
  return normalizeTranscript(normalized, settings);
}

function recentInterviewerText(limit = 4) {
  return transcript
    .filter((turn) => turn.channel === 'them' && turn.text)
    .slice(-limit)
    .map((turn) => turn.text)
    .join('\n');
}

function publishInterim(channel, text, meta = {}) {
  const normalized = normalizeSpeechText(text, store.getSettings(), recentInterviewerText());
  if (!normalized) {
    send('stt:interim', { ...meta, channel, text: '' });
    return;
  }
  if (channel === 'them' && isSpeechNoise(normalized)) return;
  send('stt:interim', { ...meta, channel, text: normalized });
}

function publishTranscript(channel, text, meta = {}) {
  const settings = store.getSettings();
  const normalized = normalizeSpeechText(text, settings, recentInterviewerText());
  if (!normalized) return;
  if (channel === 'them' && isSpeechNoise(normalized)) {
    console.log('[stt-noise-filter]', JSON.stringify(normalized));
    return;
  }

  const ts = Date.now();
  const verdict = transcriptDeduper.accept(channel, normalized, ts);
  if (verdict.drop) {
    console.log('[stt-dedup]', channel, verdict.reason, JSON.stringify(normalized.slice(0, 120)));
    return;
  }

  if (verdict.removeEvent) {
    const i = transcript.findLastIndex((turn) =>
      turn.channel === verdict.removeEvent.channel &&
      Math.abs(turn.ts - verdict.removeEvent.ts) < 80 &&
      turn.text === verdict.removeEvent.text
    );
    if (i >= 0) transcript.splice(i, 1);
  }

  const turn = { ...meta, channel, text: verdict.text, ts };
  pushTranscript(turn);
  send('transcript', turn);
  send('stt:final', { ...meta, channel, text: turn.text });
}


async function startLocalWhisper(settings) {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const localSettings = settings.localWhisper || {};
  const model = requireWhisperModel(localSettings.modelId || 'base.en');
  const runtime = getWhisperRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  activeWhisperModelId = model.id;
  let transcriber = null;
  try {
    const modelPath = await whisperModelManager.verifyInstalledModel(model.id).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Download the ${model.id} model in Settings → Audio before listening.`);
      }
      throw error;
    });

    transcriber = new LocalWhisperTranscriber({
      sessionOptions: {
        executablePath: runtime.executablePath,
        runtimeDirectory: runtime.runtimeDirectory,
        modelPath,
        language: model.englishOnly ? 'en' : (localSettings.language || 'auto'),
        threads:
  resolveLocalWhisperThreads(
    localSettings.threads
  ),
        tinydiarize: model.tinydiarize
      },
      onTranscript: publishTranscript,
      onSpeechState: (channel, speaking, durationMs, meta = {}) => {
        send('vad:state', { ...meta, channel, speaking, durationMs,
          ...(speaking ? { speechStartedAt: meta.speechStartedAt || Date.now() } : { speechEndedAt: meta.speechEndedAt || Date.now() }) });
      },
      onInterim:
  (channel, text, meta = {}) => {
    publishInterim(channel, text, meta);
  },
  onMetrics:
  (metrics) => {
    if (
      metrics.kind ===
      'dropped-final'
    ) {
      console.log(
        '[local-whisper]',
        metrics.channel,
        'OVERLOAD',
        'dropped final',
        `audio=${metrics.audioMs}ms`
      );

      return;
    }

    console.log(
      '[local-whisper]',
      metrics.channel,
      metrics.kind,
      `audio=${metrics.audioMs}ms`,
      `queue=${metrics.queueMs}ms`,
      `inference=${metrics.inferenceMs}ms`,
      `rtf=${metrics.rtf.toFixed(2)}`,
      `pending=${metrics.pending}`
    );
  },
      onStatus: (status) => send('stt:status', { provider: 'local', ...status }),
      onError: (error) => {
        sttDisabled = true;
        console.log('[local-whisper] error', error && error.message);
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription error: ${error.message}. Audio was not sent to a cloud fallback.` });
      }
    });

    localWhisperTranscriber = transcriber;
    await transcriber.start();
  } catch (error) {
    if (localWhisperTranscriber === transcriber) localWhisperTranscriber = null;
    activeWhisperModelId = null;
    if (transcriber) await transcriber.forceStop().catch(() => {});
    throw error;
  }
}

async function getWhisperOverview() {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const runtime = getWhisperRuntime();
  const models = await whisperModelManager.listModels();
  return {
    runtime: {
      available: runtime.available,
      version: runtime.version,
      target: runtime.target,
      message: runtime.message || null
    },
    models
  };
}

// -------- window --------
function createWindow() {
  const H = 600;
  const savedSettings = store.getSettings();
  const layout = initialWindowLayout(screen, savedSettings, H);

  const winOptions = {
    width: layout.width,
    height: layout.height,
    x: layout.x,
    y: layout.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: layout.zoomFactor
    }
  };

  // Fix 1: On Windows, set type:'toolbar' which sets WS_EX_TOOLWINDOW.
  // This removes the window from Alt+Tab AND the taskbar entirely.
  // On macOS, this is not needed (dock hiding + Mission Control handle it).
  if (isWindows) {
    winOptions.type = 'toolbar';
  }

  win = new BrowserWindow(winOptions);

  // Fix 2: Only call setContentProtection if the OS supports it.
  // On Windows, WDA_EXCLUDEFROMCAPTURE requires build 19041+ (Windows 10 May 2020 Update).
  // On older builds we skip it silently to avoid a no-op and send a warning to the renderer.
  const shouldProtect = !process.env.CUE_NO_PROTECT;
  if (shouldProtect) {
    if (WIN_SUPPORTS_CONTENT_PROTECTION) {
      win.setContentProtection(true);
    } else {
      // Will notify the renderer after it loads
      console.log(`[cue] Windows build ${WIN_BUILD} < 19041 — setContentProtection not supported. Window may appear in screen shares.`);
    }
  }

  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac && typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  attachWindowLayout(win, screen, layout.display, H);

  let moveSaveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const [x, y] = win.getPosition();
        store.setSettings({ windowX: x, windowY: y });
      }
    }, 500);
  });

  win.setTitle('Microsoft Edge Update'); // set before load

  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    win.setTitle('Microsoft Edge Update');
    // Warn about missing content protection on old Windows builds
    if (isWindows && shouldProtect && !WIN_SUPPORTS_CONTENT_PROTECTION) {
      send('status', {
        message: `Heads up: your Windows version (build ${WIN_BUILD}) does not support screen-share hiding. Upgrade to Windows 10 build 19041+ or Windows 11 to enable invisibility in screen shares.`
      });
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('[cue] renderer gone', JSON.stringify(d));
    recordEvent({ level: 'fatal', event: 'renderer_gone', code: d && d.reason, msg: 'renderer process ended: ' + JSON.stringify(d), frame: 'BrowserWindow' });
  });
}

// -------- STT flushing (batch mode fallback) --------
async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: 'No transcription key set. Add an OpenAI (Whisper), Deepgram, or Gemini key in Settings to enable listening. Screen/LeetCode features work without it.' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim() && res.text.trim().length > 1 && !/^[?!.,;:\-…]+$/.test(res.text.trim())) {
      publishTranscript(channel, res.text.trim(), { sourceId: 'batch' });
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
    recordEvent({ level: 'error', event: 'stt_failed', msg: e && e.message ? e.message : String(e), frame: 'flushChannel', context: { channel } });
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  // Recorded before the early return, because the second and hundredth
  // occurrence still tell you the state cue is stuck in.
  recordEvent({
    level: 'error',
    event: 'stt_rejected',
    code: err.code || (err.status ? 'http_' + err.status : null),
    msg: err.message,
    frame: 'handleSttError',
    context: { provider: err.provider, status: err.status || null, alreadyDisabled: sttDisabled },
  });
  if (sttDisabled) return;
  const isQuota = err.status === 429 || err.code === 'RESOURCE_EXHAUSTED' || (err.message && err.message.includes('Quota exceeded'));
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found' || isQuota;
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', { message: `Transcription off: your ${err.provider} key was rejected or hit a quota limit. Update your key in Settings to resume.` });
  } else {
    send('status', { message: 'Transcription error (' + err.provider + '): ' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- streaming STT setup --------
function initStreamingSTT() {
  const settings = store.getSettings();
  streamingMode = false;

  ['you', 'them'].forEach((channel) => {
    const sttInstance = createStreamingSTT(settings, channel, {
      onTranscript: (ch, text, meta = {}) => {
        publishTranscript(ch, text, { ...meta, sourceId: meta.sourceId || 'stream' });
      },
      onInterim: (ch, text, meta = {}) => {
        publishInterim(ch, text, { ...meta, sourceId: meta.sourceId || 'stream' });
      },
      onError: (err) => {
        console.log('[streaming-stt] error', err.provider, err.message);
        const batchFallbackAvailable = createSTT(settings).available;
        stopStreamingSTT(); // close WebSockets and clear keep-alive intervals
        if (batchFallbackAvailable) {
          send('status', { message: `Streaming transcription (${err.provider}) error: ${err.message}. Falling back to batch mode.` });
          startFlushLoop();
        } else if (!sttDisabled) {
          sttDisabled = true;
          send('status', { message: `Transcription stopped (${err.provider}): ${err.message}. The selected provider has no batch fallback.` });
        }
        streamingMode = false;
      },
      onStatusChange: (ch, status) => {
        send('stt:status', { channel: ch, status });
        if (status === 'connected') {
          console.log(`[streaming-stt] ${ch} channel connected`);
        }
      }
    });

    if (sttInstance.type === 'streaming' && sttInstance.instance) {
      streamingMode = true;
      streamingSTT[channel] = sttInstance.instance;
      sttInstance.instance.connect();
    }
  });

  return streamingMode;
}

function stopStreamingSTT() {
  ['you', 'them'].forEach((channel) => {
    if (streamingSTT[channel]) {
      streamingSTT[channel].disconnect();
      streamingSTT[channel] = null;
    }
  });
  streamingMode = false;
}

// -------- audio routing (streaming or batch) --------
function resolveLocalWhisperThreads(
  configured
) {
  const explicit =
    Number.parseInt(
      configured,
      10
    );

  if (
    Number.isInteger(explicit) &&
    explicit > 0
  ) {
    return Math.min(
      explicit,
      64
    );
  }

  const logicalCpuCount =
    Math.max(
      1,
      os.cpus()?.length || 1
    );

  // Leave some CPU for Electron,
  // Zoom/Teams and the browser.
  return Math.min(
    8,
    Math.max(
      2,
      Math.floor(
        logicalCpuCount *
        0.75
      )
    )
  );
}

function routeAudio(channel, pcmBuffer) {
  const buf = Buffer.from(pcmBuffer);

  if (localWhisperTranscriber) {
    localWhisperTranscriber.push(channel, buf);
    return;
  }

  // Always run through VAD for speech state detection
  vad[channel].processChunk(buf);

  // Keep pre-speech buffer
  ringBuffers[channel].write(buf);

  if (streamingMode && streamingSTT[channel]) {
    // Streaming mode: send raw PCM directly to the WebSocket
    streamingSTT[channel].sendAudio(pcmBuffer);
  } else {
    // Batch mode: accumulate in buffers for periodic flush
    buffers[channel].push(buf);
  }
}

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside cue's own process
// and use cue's own Screen-Recording grant — no separate helper binary to authorize.
async function setCapturing(active) {
  if (active === state.capturing) return state.capturing;

  if (active) {
    sttDisabled = false; // reset on re-enable
    transcriptDeduper.reset();
    const settings = store.getSettings();
    if ((settings.sttProvider || 'auto') === 'local') {
      try {
        await startLocalWhisper(settings);
        state.capturing = true;
        console.log('[cue] capture started, mode: local');
        send('capture:state', { active: true, streaming: false, mode: 'local' });
        return true;
      } catch (error) {
        state.capturing = false;
        desiredCaptureState = false;
        if (error.code === 'STARTUP_CANCELLED') {
          send('stt:status', { provider: 'local', status: 'off' });
          send('capture:state', { active: false, streaming: false, mode: 'local' });
          return false;
        }
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription could not start: ${error.message} No audio was sent to a cloud provider.` });
        send('capture:state', { active: false, streaming: false, mode: 'local' });
        return false;
      }
    }

    state.capturing = true;
    // Try streaming first, fall back to batch
    const streaming = initStreamingSTT();
    if (!streaming) {
      startFlushLoop();
    }
    console.log('[cue] capture started, mode:', streaming ? 'streaming' : 'batch');
    send('capture:state', { active: true, streaming: streamingMode, mode: streaming ? 'streaming' : 'batch' });
    return true;
  }

  state.capturing = false;
  stopFlushLoop();
  stopStreamingSTT();
  buffers.you = []; buffers.them = [];
  vad.you.reset(); vad.them.reset();
  ringBuffers.you.clear(); ringBuffers.them.clear();
  const stoppingLocalTranscriber = localWhisperTranscriber;
  localWhisperTranscriber = null;
  send('capture:state', { active: false, streaming: false, mode: stoppingLocalTranscriber ? 'local' : 'off' });
  if (stoppingLocalTranscriber) {
    send('stt:status', { provider: 'local', status: 'stopping' });
    try {
      await stoppingLocalTranscriber.stop();
    } catch (error) {
      console.log('[local-whisper] stop error', error && error.message);
    } finally {
      activeWhisperModelId = null;
    }
  }
  return false;
}

// -------- feature runner --------
async function runFeature(mode, userText) {
  const def = MODES[mode];
  if (!def) { send('llm:error', { message: 'Unknown answer mode.' }); return; }

  const explicit = typeof userText === 'string' ? userText.trim() : '';
  const liveMode = mode === 'say' || mode === 'assist';
  const resolved = liveMode || mode === 'answerThis'
    ? questionResolver.resolveForSubmit({ allowPartial: mode === 'say' }) : null;
  const lastSpeech = transcript.filter(t => t.channel === 'them').at(-1);
  const lastQuestion = conversation.recent.at(-1)?.question || '';
  const question = mode === 'leetcode' ? '请解决当前屏幕上的技术题'
    : explicit || (mode === 'assist' ? (resolved?.text || lastQuestion || '')
      : mode === 'say' ? (resolved?.text || lastQuestion || lastSpeech?.text || '')
        : mode === 'answerThis' ? (resolved?.text || '') : (lastQuestion || lastSpeech?.text || ''));

  if (state.busy && mode !== 'say') {
    send('status', { message: '当前回答仍在生成；请等待本轮完成或清空会话后再提交。' });
    return;
  }

  if (state.busy && mode === 'say') {
    const previous = activeGeneration;
    activeGeneration = null;
    if (previous) previous.controller.abort();
    state.busy = false;
  }

  // For live answering, the resolver has already decided which interviewer
  // fragments belong to the answer target. Do not leak a trailing incomplete
  // ASR fragment back into the prompt through raw transcript history. Candidate
  // speech is kept for genuine follow-up context; the confirmed question is
  // inserted below by withCurrentQuestion().
  let freshTranscript = ['recap', 'followup'].includes(mode) ? transcript
    : transcript.filter(t => t.ts > conversation.lastStartedAt);
  if (liveMode) {
    freshTranscript = isLikelyFollowUp(question)
      ? freshTranscript.filter(t => t.channel === 'you').slice(-4)
      : [];
  }
  const contextTranscript = withCurrentQuestion(freshTranscript, question);
  const fromResolved = !explicit && resolved?.text === question;
  const partial = fromResolved && !!resolved?.partial;
  const sourceKey = fromResolved && resolved?.keys?.size === 1 ? Array.from(resolved.keys)[0] : '';
  const interviewPlan = ['say', 'answerThis', 'ask', 'assist'].includes(mode) && question
    ? planInterviewQuestion({ text: question, partial, sourceKey, mode }) : null;
  const timing = replyLatency.start(mode, question);
  const generation = { id: timing.requestId, controller: new AbortController(), epoch: conversation.epoch };
  activeGeneration = generation;
  state.busy = true;
  let streamSettled = false;
  const owned = () => activeGeneration === generation && conversation.epoch === generation.epoch;
  const emit = (channel, data) => { if (owned()) send(channel, { ...data, requestId: generation.id }); };
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings);
    const userBubble = def.userBubble !== null ? def.userBubble
      : (mode === 'ask' || mode === 'answerThis' ? question : null);
    emit('llm:start', { userBubble, small: !!def.small,
      category: mode !== 'leetcode' ? detectCategory(contextTranscript) : null });
    if (!llm.ready) throw new Error(llm.configurationError || 'Complete the model settings.');
    if (!question && ['ask', 'answerThis'].includes(mode)) throw new Error('请先输入问题或等待识别到面试官发言。');
    const request = conversation.begin({ mode, question, transcript: contextTranscript,
      settings, catalog: getProjectCatalog(), interviewPlan, evidenceRevision: getProjectIndexRevision() });
    const checklistText = interviewPlan ? formatInterviewChecklist(request.checklist, { maxChars: 2600 }) : '';
    // Only spend prompt/retrieval/output budgets on old pending items that are
    // actually shown this round. The original current question remains intact.
    if (request.checklist) {
      request.checklist = { ...request.checklist,
        questions: request.checklist.questions.filter(item => item.current || checklistText.includes(item.text)),
        pending: request.checklist.pending.filter(item => checklistText.includes(item.text)) };
    }
    const effectiveInterviewPlan = interviewPlan ? { ...interviewPlan,
      subQuestions: [...interviewPlan.subQuestions, ...(request.checklist?.pending || [])] } : null;
    const answerPlan = getAnswerPlan(question, effectiveInterviewPlan);

    let imageDataUrl = null;
    const screenStarted = performance.now();
    if (shouldCaptureScreen(mode, question)) {
      try {
        imageDataUrl = await captureScreenshot();
        if (!imageDataUrl) throw new Error('No screen source was available.');
      } catch (e) {
        if (!owned()) return;
        recordEvent({ level: 'error', event: 'screen_capture_failed', msg: e.message, frame: 'captureScreenshot', context: { mode } });
        // A screen-only question cannot be answered from an old screenshot/history.
        throw new Error('屏幕截图失败，请检查屏幕录制权限后重试。');
      }
    }
    if (!owned()) return;
    const screenMs = performance.now() - screenStarted;
    const contextStarted = performance.now();
    const contextBundle = buildInterviewContextBundle(settings, mode, contextTranscript,
      { requestId: timing.requestId, projectPlan: request.plan, smart: !!settings.smart,
        answerComplexity: answerPlan.level, interviewPlan: effectiveInterviewPlan,
        contextBudget: contextCharsFor(mode, answerPlan), projectState: request.projectInterviewState });
    request.evidenceRevision = contextBundle.evidence.find(item => item.sourceType === 'imported')?.revision || getProjectIndexRevision();
    const system = def.buildSystem ? def.buildSystem(contextBundle.context, settings.aiRules || '',
      { answerPlan, interviewPlan, projectPlan: request.plan, hasImage: !!imageDataUrl }) : (def.system || '');
    const responseContext = { transcript: contextTranscript, userText: question, answerPlan, partial, hasImage: !!imageDataUrl };
    const built = def.build(responseContext);
    const maxTokens = def.resolveMaxTokens?.(responseContext) || def.maxTokens;
    // A fresh screen task stands on its own; its answer is still available to
    // subsequent manual follow-ups. No previous screenshot bytes are retained.
    const history = mode === 'leetcode' ? [] : request.turns;
    const memory = mode === 'leetcode' ? '' : request.memory;
    const topic = mode !== 'leetcode' && request.plan.anchor && request.plan.anchor !== question
      ? '=== 当前话题起点（历史用户发言，仅用于理解指代） ===\n' + request.plan.anchor : '';
    const checklist = checklistText;
    // Discussion progress is not a source of project implementation facts.
    const projectState = request.projectInterviewState;
    const progress = formatProjectInterviewState(projectState, { maxChars: 1200 });
    const scenarioText = interviewPlan?.scenario || request.checklist?.scenario;
    const scenario = interviewPlan && scenarioText ? '=== 当前假设场景（不代表项目实际指标） ===\n' + scenarioText : '';
    const current = [topic, memory, built, scenario, checklist, progress].filter(Boolean).join('\n\n');
    const turns = [...history, { role: 'user', text: current }];
    const requestSent = performance.now();
    console.log('[latency][prompt] ' + JSON.stringify({ requestId: timing.requestId, mode,
      screenMs: +screenMs.toFixed(2), contextMs: +(requestSent - contextStarted).toFixed(2),
      promptChars: system.length + turns.reduce((n, t) => n + t.text.length, 0), systemChars: system.length,
      hasImage: !!imageDataUrl, maxTokens, answerComplexity: answerPlan.level,
      ...request.stats, prepareMs: +(requestSent - timing.started).toFixed(2) }));

    let watchdog = null;
    let deadline = null;
    let abortListener = null;
    let rearm = () => {};
    let answer = '';
    let completion = { complete: false, truncated: false, finishReason: null };
    const stopped = new Promise((_resolve, reject) => {
      const stop = message => {
        reject(new Error(message));
        generation.controller.abort();
      };
      abortListener = () => reject(new Error('回答已取消。'));
      generation.controller.signal.addEventListener('abort', abortListener, { once: true });
      rearm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => stop('模型超过 25 秒没有返回数据，请重试。'), STREAM_INACTIVITY_MS);
      };
      rearm();
      deadline = setTimeout(() => stop('本轮生成超过 180 秒，已停止；请缩小问题范围后重试。'), 180000);
    });
    try {
      const result = await Promise.race([
        llm.stream({ system, turns, imageDataUrl, signal: generation.controller.signal, mode,
          maxTokens,
          onCompletion: metadata => {
            if (owned() && !streamSettled && !generation.controller.signal.aborted) completion = metadata;
          },
          onActivity: () => { if (owned() && !streamSettled && !generation.controller.signal.aborted) rearm(); },
          onToken: text => {
            if (!owned() || streamSettled || generation.controller.signal.aborted || !text) return;
            answer += text;
            timing.firstToken(requestSent);
            rearm();
            emit('llm:token', { text });
          }
        }), stopped
      ]);
      if (!owned() || generation.controller.signal.aborted) return;
      if (!answer.trim() && typeof result === 'string' && result.trim()) {
        answer = result;
        emit('llm:token', { text: answer });
      }
      if (!answer.trim()) throw new Error('模型没有返回正文，请检查模型与思考模式设置后重试。');
      const committed = conversation.commit(request, answer, { completion, evidence: contextBundle.evidence });
      if (committed && liveMode && resolved?.text === question) questionResolver.markSubmitted(resolved);
    } finally {
      streamSettled = true;
      clearTimeout(watchdog);
      clearTimeout(deadline);
      if (abortListener) generation.controller.signal.removeEventListener('abort', abortListener);
    }
    console.log('[latency][reply] ' + JSON.stringify({ requestId: timing.requestId, mode, doneMs: +(performance.now() - timing.started).toFixed(2) }));
    emit('llm:done', {});
  } catch (e) {
    if (owned()) {
      recordEvent({ level: 'error', event: 'llm_failed', msg: e?.message || String(e), frame: 'runFeature', context: { mode, provider: store.getSettings().provider } });
      emit('llm:error', { message: e?.message || String(e) });
    }
  } finally {
    streamSettled = true;
    if (activeGeneration === generation) { activeGeneration = null; state.busy = false; }
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => { sttDisabled = false; return store.setSettings(patch); });
ipcMain.handle('capture:toggle', () => {
  const targetState = !desiredCaptureState;
  desiredCaptureState = targetState;
  if (!targetState && !state.capturing && localWhisperTranscriber) {
    localWhisperTranscriber.forceStop().catch(() => {});
  }
  captureTransition = captureTransition
    .catch(() => state.capturing)
    .then(() => setCapturing(targetState));
  return captureTransition;
});
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('whisper:models', () => getWhisperOverview());
ipcMain.handle(
  'whisper:model-download',
  async (_event, modelId) => {
    console.log(
      '[whisper] model download requested:',
      modelId
    );

    if (!whisperModelManager) {
      throw new Error(
        'The local Whisper model manager is not ready.'
      );
    }

    try {
      const result =
        await whisperModelManager.download(
          modelId,
          (progress) => {
            console.log(
              '[whisper] download progress:',
              modelId,
              `${progress.percent}%`,
              progress.receivedBytes,
              '/',
              progress.totalBytes
            );

            send(
              'whisper:download-progress',
              progress
            );
          }
        );

      console.log(
        '[whisper] model download completed:',
        modelId
      );

      send(
        'whisper:models-changed',
        { modelId }
      );

      return result;

    } catch (error) {
      console.error(
        '[whisper] model download failed:',
        modelId,
        error?.stack ||
        error?.message ||
        error
      );

      throw error;
    }
  }
);
ipcMain.handle('whisper:model-cancel', (_event, modelId) => {
  if (!whisperModelManager) return false;
  return whisperModelManager.cancelDownload(modelId);
});
ipcMain.handle('whisper:model-delete', async (_event, modelId) => {
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before deleting the active model.');
  }
  const result = await whisperModelManager.deleteModel(modelId);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-import', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before replacing the active model.');
  }
  const selection = await dialog.showOpenDialog(win, {
    title: `Import ggml-${modelId}.bin`,
    properties: ['openFile'],
    filters: [{ name: 'whisper.cpp model', extensions: ['bin'] }]
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const result = await whisperModelManager.importModel(modelId, selection.filePaths[0]);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('platform:info', () => ({
  platform: process.platform,
  winBuild: WIN_BUILD,
  winSupportsContentProtection: WIN_SUPPORTS_CONTENT_PROTECTION
}));
ipcMain.handle('transcript:clear', () => {
  const previous = activeGeneration;
  activeGeneration = null;
  if (previous) previous.controller.abort();
  state.busy = false;
  conversation.reset();
  questionResolver.reset();
  transcriptDeduper.reset();
  if (previous) send('llm:done', { requestId: previous.id, canceled: true });
  transcript.splice(0, transcript.length);
  replyLatency.reset();
  return { ok: true };
});
ipcMain.on('ask', (_e, payload) => runFeature(payload?.mode, payload?.text));
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('you', arrayBuffer); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('them', arrayBuffer); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));
// -------- resume / job-description file import --------
// The dialog runs in MAIN and is filtered to pdf/docx; the renderer never supplies a path.
// The parsed text is RETURNED to the renderer, which drops it into the existing
// #resume-text / #job-description textareas so settings keep a single source of truth.
async function pickAndParseDocument() {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Resume / Job description', extensions: ['pdf', 'docx'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const text = await parseDocumentFile(filePath);
  return { fileName: path.basename(filePath), text };
}
ipcMain.handle('profile:pickDocument', async () => {
  try {
    const picked = await pickAndParseDocument();
    if (!picked) return { canceled: true };
    return { canceled: false, fileName: picked.fileName, text: picked.text };
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.on('app:quit', () => app.quit());
ipcMain.handle('applink:state', () => appLinkConsentState());
ipcMain.handle('applink:revoke', (_e, callerId) => revokeAppLinkCaller(callerId));

// -------- permissions IPC --------
ipcMain.handle('permissions:check', () => getPermissionStatus());
ipcMain.handle('permissions:request', () => requestPermissions());
ipcMain.on('permissions:continue', async () => {
  const status = await getPermissionStatus();
  if (status.mic === 'granted' && status.screen === 'granted') {
    if (permWin) { permWin.close(); permWin = null; }
    launchApp();
  }
});

// -------- shortcuts --------
function registerShortcuts() {
  shortcutState.assist = globalShortcut.register('CommandOrControl+Shift+Return', () => runFeature('assist', ''));
  shortcutState.say = globalShortcut.register('CommandOrControl+Return', () => runFeature('say', ''));
  shortcutState.leetcode = globalShortcut.register('CommandOrControl+H', () => runFeature('leetcode', ''));
  shortcutState.hide = globalShortcut.register('CommandOrControl+Shift+/', () => send('hide:toggle', {}));
  shortcutState.quit = globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
  for (const [name, wasRegistered] of Object.entries(shortcutState)) {
    if (!wasRegistered) {
      recordEvent({ level: 'warn', event: 'shortcut_unavailable', msg: 'another application holds the ' + name + ' shortcut', frame: 'registerShortcuts', context: { shortcut: name } });
    }
  }
}

// -------- permissions --------
// systemPreferences.getMediaAccessStatus('screen') is unreliable: it can return
// 'not-determined' or 'denied' even after the user has granted Screen Recording,
// especially in dev mode (unsigned / no proper app bundle).  As a fallback we
// actually attempt a capture and inspect the thumbnail — if it contains any
// non-zero pixel data, macOS is giving us real screen content, i.e. granted.
async function verifyScreenAccess() {
  const sysStatus = systemPreferences.getMediaAccessStatus('screen');
  if (sysStatus === 'granted') return 'granted';

  // Fallback: try an actual capture and check the thumbnail for real pixels.
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16, height: 16 },
    });
    if (sources.length > 0) {
      const bmp = sources[0].thumbnail.toBitmap();
      // toBitmap() returns raw RGBA bytes; any non-zero byte means real content
      if (bmp && bmp.some(byte => byte !== 0)) return 'granted';
    }
  } catch (_) {}

  return sysStatus;  // return the original system status if fallback didn't help
}

async function getPermissionStatus() {
  if (process.platform !== 'darwin') return { mic: 'granted', screen: 'granted' };
  return {
    mic: systemPreferences.getMediaAccessStatus('microphone'),
    screen: await verifyScreenAccess(),
  };
}

async function requestPermissions() {
  if (process.platform !== 'darwin') return true;

  // Trigger the macOS microphone permission dialog (first-use only)
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  // Trigger the macOS screen-recording permission dialog (first-use only).
  // There is no askForMediaAccess('screen'), but attempting to enumerate
  // sources via desktopCapturer will cause macOS to prompt the user.
  const screenStatus = await verifyScreenAccess();
  if (screenStatus !== 'granted') {
    try { await desktopCapturer.getSources({ types: ['screen'] }); } catch (_) {}
  }

  const status = await getPermissionStatus();
  return status.mic === 'granted' && status.screen === 'granted';
}

function createPermissionsWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = Math.round(Math.min(workArea.width / 2, 500) * UI_SCALE);
  const H = Math.round(Math.min(workArea.height / 2, 540) * UI_SCALE);
  permWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: Math.round(workArea.y + (workArea.height - H) / 2),
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: UI_SCALE,
    }
  });
  permWin.loadFile(path.join(__dirname, 'renderer', 'permissions.html'));
  permWin.webContents.on('did-finish-load', () => permWin.show());
}

// -------- launch (called after permissions are confirmed) --------
function launchApp() {
  if (isMac && app.dock) app.dock.hide();
  whisperModelManager = new WhisperModelManager({
  userDataPath: app.getPath('userData'),

  // Use Electron/Chromium's network stack instead of Node's global fetch.
  // This behaves more consistently with Windows proxy/certificate settings.
  fetchImpl: (url, options) => {
    return net.fetch(url, options);
  }
});

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture' || permission === 'screen';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // System-audio loopback for getDisplayMedia: hand back a screen source with 'loopback'
  // audio so the renderer can capture what's playing (Zoom/Meet) using cue's own grant.
session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
  desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  }).then(
    (sources) => {
      if (!sources.length) {
        console.error('[cue] no screen source available');
        callback({});
        return;
      }

      const streams = {
        video: sources[0]
      };

      // Electron expects "loopback", not boolean true.
      // Windows supports system-audio loopback directly.
      if (isWindows && _request.audioRequested) {
        streams.audio = 'loopback';
      }

      // Important: call exactly once.
      callback(streams);
    },
    (error) => {
      // This is the rejection handler for getSources itself.
      // It does NOT catch exceptions thrown by callback(), preventing
      // accidental second invocation of the one-time callback.
      console.error(
        '[cue] desktopCapturer.getSources failed:',
        error && error.message ? error.message : error
      );

      callback({});
    }
  );
}, { useSystemPicker: false });

  // Started before the shortcuts so their registration failures are recorded.
  startAppLink({
    snapshot: () => ({
      state,
      transcript,
      settings: store.getSettings(),
      sttDisabled,
      shortcuts: { ...shortcutState },
      windowAlive: !!(win && !win.isDestroyed()),
    }),
    setCapturing,
    // Looked up rather than captured: the window is recreated on 'activate',
    // so a reference taken at startup goes stale.
    getWindow: () => win,
  });

  createWindow();
  registerShortcuts();
  // Prepare the existing local index in the background instead of charging its
  // complete cold build to the first interview answer after app restart.
  warmProjectIndex().catch(error => console.warn('[rag] warmup unavailable:', error?.code || error?.name || 'Error'));
}

// -------- lifecycle --------
app.whenReady().then(async () => {
  app.setName('MicrosoftEdgeUpdate');
  if (isWindows) {
    process.title = 'MicrosoftEdgeUpdate';
  }

  if (isMac) {
    const allGranted = await requestPermissions();
    if (!allGranted) {
      // Show the permissions gate — the dock stays visible so the user can find the app
      createPermissionsWindow();
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createPermissionsWindow(); });
      return;
    }
  }

  launchApp();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Best effort, deliberately not blocking the quit: the library also removes
  // the instance file from a `process.on('exit')` handler, and a file left
  // behind is harmless anyway because readers check whether the PID is alive.
  // Delaying shutdown to tidy a directory would be the wrong trade.
  stopAppLink();
  if (whisperModelManager?.activeDownload) {
    whisperModelManager.cancelDownload(whisperModelManager.activeDownload.modelId);
  }
  if (localWhisperTranscriber) localWhisperTranscriber.forceStop().catch(() => {});
});
app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', (e) => {
  // Don't quit while the permissions window is open — the user may be in System Settings
  if (permWin) { e.preventDefault(); return; }
  app.quit();
});
