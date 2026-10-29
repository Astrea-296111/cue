const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, dialog, systemPreferences,net,clipboard } = require('electron');
const path = require('path');
const { requestWindowProtection, showWindowWithProtection, attachWindowProtection, setProtectedMouseEvents } = require('./src/window-protection');
const { performance } = require('perf_hooks');
const { withCurrentQuestion, planProjectRetrieval } = require('./src/project-query');
const { QuestionResolver } = require('./src/question-resolver');
const { planInterviewQuestion, stableId } = require('./src/interview-question-planner');
const { formatInterviewChecklist } = require('./src/interview-checklist');
const { formatProjectInterviewState } = require('./src/project-interview-state');
const { UI_SCALE, initialWindowLayout, attachWindowLayout } = require('./src/window-layout');
const replyLatency = require('./src/reply-latency');
const os = require('os');
const store = require('./src/store');
const fs = require('fs');
const { ProjectFactPacks, validateIndex } = require('./src/project-fact-packs');
let factPacks = new ProjectFactPacks();
const {ProjectMaterialService} = require('./src/project-material-service');
const {planProjectEvidence,sentEvidenceDiagnostics,applyFactCoverage,resolveEvidenceLimits} = require('./src/project-evidence-policy');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { parseDocumentFile } = require('./src/resume');
const { createFirstContentDeadline } = require('./src/first-content-deadline');
const { createLLM } = require('./src/llm');
const { resolveInstantPolicy } = require('./src/instant-answer-policy');
const { InstantContextCards, buildInstantContext } = require('./src/instant-answer-context');
const { peekReadyEvidence } = require('./src/instant-ready-evidence');
const { getBuildIdentity } = require('./src/build-info');
const { MODES, shouldCaptureScreen, getAnswerPlan, contextCharsFor } = require('./src/prompts');
const { ConversationMemory } = require('./src/conversation-memory');
const {buildCandidateRoleContext}=require('./src/candidate-role-context');
const { ProjectEntityIndex } = require('./src/project-entity-index');
const { DialogueStore, SPOKEN_CONTEXT_RULES, projectIds: spokenProjectIds } = require('./src/spoken-claim-ledger');
const {InterviewTranscriptRecorder}=require('./src/interview-transcript-recorder');
const personalWorkspace = require('./src/personal-workspace');
const { getProjectIndexRevision: readProjectIndexRevision,
  getProjectIndexSnapshot: readProjectIndexSnapshot, warmProjectIndex, refreshProjectIndex } = require('./src/project-knowledge');
const sourceAdapter = require('./src/project-knowledge');
const materialService = new ProjectMaterialService({directory:app.getPath('userData'),bundled:factPacks.getIndex(),legacySource:()=>sourceAdapter.readLegacyIndex(),sourceAdapter});
let projectEntityIndex=new ProjectEntityIndex(materialService.snapshot);
factPacks = materialService.snapshot.factPacks;
sourceAdapter.setMaterialProvider({getSourceIndex:()=>materialService.snapshot.sources,
  getSourceRevision:()=>materialService.snapshot.generation+':'+materialService.snapshot.sourceRevision,
  refresh:()=>materialService.refresh(),publishSource:index=>materialService.publishSource(index),
  importFolder:root=>materialService.importLegacy('folder',root),importZip:file=>materialService.importLegacy('zip',file),clearSources:()=>materialService.clearSources()});
const { activeProjectContextCache } = require('./src/project-context');
const { enabled: realtimePrefetchEnabled, adjacentNeeds } = require('./src/project-prefetch-policy');
const { getProjectEmbeddings } = require('./src/project-embeddings');
const { ProjectRagSession, sourceEvents, formatRetrievalRequirements } = require('./src/project-rag-session');
const { retrieveProjectEvidenceAsync } = require('./src/retrieval-coordinator');
const { prepareFinalRequest, visibleEvidence, estimateTokens } = require('./src/final-request-budget');
const { rms16 } = require('./src/wav');
const { createStreamingSTT } = require('./src/stt-streaming');
const { normalizeTranscript } = require('./src/transcript-normalizer');
const { normalizeTechnicalVocabulary } = require('./src/technical-vocabulary');
const { isSpeechNoise } = require('./src/speech-noise-filter');
const { AdaptiveVAD, AudioRingBuffer } = require('./src/vad');
const { buildInterviewContextBundleAsync, detectCategory } = require('./src/interview-context');
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
const shortcutState = { assist: false, say: false, technical: false, leetcode: false, quit: false };
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
const dialogue = new DialogueStore();
const transcriptRecorder=new InterviewTranscriptRecorder({directory:path.join(app.getPath('userData'),'interview-records'),
  enabled:store.getSettings().saveInterviewTranscript!==false,onStatus:value=>send('dialogue:recording',value)});
transcriptRecorder.startSession(dialogue.sessionId);
const speechDraftIds = new Map();
let speechEventSequence = 0;
const questionResolver = new QuestionResolver();
const { LiveQuestionWindow } = require('./src/live-context-policy');
const liveQuestions = new LiveQuestionWindow();
const screenTaskState = new (require('./src/screen-task-router').ScreenTaskState)();
let pendingSubmitDiagnostic = null;
const pendingSubmit = new (require('./src/pending-submit').PendingSubmit)({
  onReady: (snapshot, mode) => { const identity=speechIdentity();queueMicrotask(() => {
    const latest=questionResolver.resolveForSubmit();
    if(identity===speechIdentity() && latest.questionId===snapshot.questionId && latest.semanticStatus==='answerable')runFeature(mode, '', { submitSnapshot: latest });
  }); },
  onChange: (reason, pending) => {
    pendingSubmitDiagnostic = {reason, ...pending};
    send('status', {message:reason==='waiting'?'已记住按键，正在补全当前问题':reason==='timeout'?'仍缺少完整题意；请补全后再次按键':reason==='submitted'?'当前问题已补全，开始回答':'已取消待提交：'+reason});
    publishQuestionTarget();
  }
});
const speechIdentity = () => JSON.stringify([conversation.epoch, streamingSessionSequence]);
questionResolver.reset({ epoch: conversation.epoch });
const instantCards = new InstantContextCards(store.getSettings());
let lastFrozenSnapshot = null;
let lastScreenSnapshot = null;
let latestUiRequestId = null;
const targetModes = new Map();
let streamingSessionSequence = 0;
let activeGeneration = null;
// A safe identity of the latest actual attempt survives completion and failure.
// It contains no settings object, credentials, prompt or raw SDK response.
let lastActualRequest = null;
const diagnosticText = (value, limit=200) => typeof value==='string' ? value.slice(0,limit) : null;
function actualRequestMetrics(timing) {
  const metrics=timing?.metrics?.()||{},safe={};
  for(const key of ['prepareMs','triggerToDispatchMs','firstContentMs','triggerToFirstContentMs','triggerToFirstUsefulSentenceMs','actualInputTokens','actualOutputTokens','actualTotalTokens','cachedInputTokens','actualReasoningTokens'])safe[key]=Number.isFinite(metrics[key])?metrics[key]:null;
  safe.aborted=!!metrics.aborted;return safe;
}
const uiReplyTimings = new Map();
let semanticRetriever = null;
let formalProjectPlan = null;
const preparedReadOptions = () => ({ preparedOnly: realtimePrefetchEnabled(store.getSettings()) });
const getProjectCatalog = () => materialService.snapshot.registry.projects;
const getProjectIndexRevision = () => readProjectIndexRevision(preparedReadOptions());
const getProjectIndexSnapshot = () => readProjectIndexSnapshot(preparedReadOptions());
function getSemanticRetriever() {
  if (!semanticRetriever) semanticRetriever = getProjectEmbeddings({
    directory: path.join(app.getPath('userData'), 'project-semantic'),
    snapshotProvider: () => readProjectIndexSnapshot({ preparedOnly: true }),
    revisionProvider: () => readProjectIndexRevision({ preparedOnly: true }),
    fetchImpl: (url, options) => net.fetch(url, options)
  });
  return semanticRetriever;
}
const ragSession = new ProjectRagSession({
  retrieve: input => retrieveProjectEvidenceAsync({ ...input, includeCandidates: true,
    projectContextCache: input.realtimeEvidencePrefetch ? activeProjectContextCache : undefined,
    semanticRetriever: getSemanticRetriever() }),
  onEvent: metrics => console.log('[latency][background] ' + JSON.stringify(metrics)),
  isCurrent: input => input.epoch === conversation.epoch && input.projectRevision === readProjectIndexRevision({ preparedOnly: true }) &&
    input.modelVersion === (getSemanticRetriever().status().modelVersion || 'base')
});
function retrievalInput(question, projectPlan, interviewPlan, contextBudget, sourceKey = '', snapshot = null, mode='say') {
  const policy=resolveInstantPolicy(store.getSettings(),mode,question);
  return { question, questionId: snapshot?.questionId || undefined, questionRevision: snapshot?.questionId ? snapshot.revision : undefined,
    materialIdentity:[store.getSettings().liveContextPolicy,store.getSettings().qaAnswerDetailed,store.getSettings().answerDomain, store.getSettings().activeJobProfileId, store.getSettings().provider, store.getSettings().models, require('./src/oral-answer-policy').VERSION, materialService.snapshot.generation,projectPlan.canonicalProjectIds||[],policy.instant?'instant':'standard',policy.ragPolicy,require('./src/project-evidence-policy').VERSION],
    projectPlan, interviewPlan, contextBudget, sourceKey, hashFallback: !!store.getSettings().smart,
    realtimeEvidencePrefetch: realtimePrefetchEnabled(store.getSettings()),
    questionVersion: interviewPlan?.questionVersion || stableId(question),
    epoch: conversation.epoch, projectRevision: readProjectIndexRevision({ preparedOnly: true }),
    modelVersion: semanticRetriever?.status().modelVersion || 'base' };
}
function scheduleProjectPrefetch(payload) {
  if (activeGeneration?.policy.instant && !activeGeneration.firstContent) return;
  if (resolveInstantPolicy(store.getSettings(), 'say').ragPolicy === 'off') return;
  if (typeof payload !== 'string' && (!payload || typeof payload.text !== 'string')) return;
  const text = String(typeof payload === 'string' ? payload : payload.text).trim();
  if (text.length > 24000) return;
  if (text.length < 4) return;
  const sourceKey = typeof payload?.sourceKey === 'string' && payload.sourceKey.length <= 4096 ? payload.sourceKey : '';
  const settings = store.getSettings();
  const preview = payload?.snapshot || questionResolver.previewForPrefetch();
  if (settings.realtimeAnswerMode !== 'standard' && (!preview.text || preview.text !== text)) return;
  const interviewPlan = planInterviewQuestion({ text, mode: 'say', sourceKey });
  const projectPlan = planProjectRetrieval([{ channel: 'them', text }], 'say', {
    catalog: getProjectCatalog(), previousPlan: null,
    activeProjectPlan: null,
    manualProjectId: settings.currentProjectId, interviewPlan,
    answerHint: ''
  });
  if (!projectPlan.retrieveSources) { ragSession.pause(); return; }
  const budget = contextCharsFor('say', getAnswerPlan(text, interviewPlan));
  getSemanticRetriever();
  ragSession.schedule({ ...retrievalInput(text, projectPlan, interviewPlan, budget, sourceKey, preview),
    exactEligible: !payload?.partial },
    { immediate: payload?.final === true, origin: payload?.final === true ? 'final' : 'interim' });
  if (!projectPlan.retrieve) ragSession.pause();
}

const snapshotSourceKey = snapshot => {
  const keys = [...(snapshot?.keys || [])].sort();
  return keys.length > 1 ? JSON.stringify(keys) : keys[0] || '';
};
function currentTargetEnvelope() {
  return { snapshot: questionResolver.resolveForSubmit({ allowPartial: true, epoch: conversation.epoch }),
    frozenSnapshot: activeGeneration?.snapshot || lastFrozenSnapshot, state: state.busy ? 'answering' : 'idle',
    pendingSubmit:!!pendingSubmit.pending, requestId: activeGeneration?.id || latestUiRequestId, epoch: conversation.epoch };
}
function publishQuestionTarget() { send('question:target', currentTargetEnvelope()); }
function observeProjectPrefetch(final) {
  const preview = questionResolver.previewForPrefetch();
  if (!preview.text) return;
  scheduleProjectPrefetch({ text: preview.text, final, sourceKey: snapshotSourceKey(preview), partial: preview.partial, snapshot: preview });
}

function prepareAdjacentEvidence(retrieval, sources) {
  if (!retrieval.realtimeEvidencePrefetch || !realtimePrefetchEnabled(store.getSettings()) ||
    retrieval.epoch !== conversation.epoch || retrieval.projectRevision !== getProjectIndexRevision() ||
    formalProjectPlan !== retrieval.projectPlan || !formalProjectPlan?.retrieve) return;
  for (const hint of adjacentNeeds(retrieval, sources)) {
    const labels = { decision: '选型理由取舍', implementation: '实现源码', ownership: '个人职责', collaboration: '协作分工',
      challenge: '困难处理验证', limitation: '限制边界', performance: '测试指标', environment: '测试环境' };
    const question = hint.topics.join(' ') + ' ' + hint.types.map(type => labels[type]).join(' ');
    const sub = { id: 'adjacent', text: question, evidenceNeeds: hint.types.map(type => ({ type })) };
    ragSession.schedulePrediction({ ...retrieval, question, questionVersion: stableId(question), sourceKey: '',
      hashFallback: false, predictionSourceIds: hint.sourceIds, interviewPlan: { subQuestions: [sub] },
      projectPlan: { ...retrieval.projectPlan, subQuestionScopes: [{ questionId: sub.id, scopes: retrieval.projectPlan.scopes }] } });
  }
}
function stopGenerationForSources() {
  const previous = activeGeneration;
  activeGeneration = null;
  previous?.controller.abort();
  if(previous) dialogue.recordSuggestion({requestId:previous.id,sessionId:previous.sessionId,status:'canceled'});
  if(previous)send('llm:materials',{requestId:previous.id,epoch:previous.epoch,generation:previous.materials?.generation,canceled:true,reasons:['revision-changed']});
  state.busy = false;
  ragSession.reset();
  activeProjectContextCache.clear();
  semanticRetriever?.resetSession?.();
  uiReplyTimings.clear();
  conversation.invalidateSources();
  questionResolver.reset({ epoch: conversation.epoch });
  pendingSubmit.cancel('reset'); liveQuestions.reset(); screenTaskState.end();
  lastFrozenSnapshot = null; latestUiRequestId = null;
  lastScreenSnapshot = null;
  targetModes.clear();
  publishQuestionTarget();
  if (previous) send('llm:done', { requestId: previous.id, canceled: true });
}
materialService.on('warning',()=>send('materials:changed',materialService.state()));
materialService.on('changed', state => {
  factPacks = materialService.snapshot.factPacks;
  projectEntityIndex=new ProjectEntityIndex(materialService.snapshot);
  sourceAdapter.adoptMaterialIndex(materialService.snapshot.sources);
  dialogue.setActiveProject(dialogue.activeProjectIds,getProjectIndexRevision());
  sourceEvents.emit('changed', {generation:state.generation});
  warmProjectIndex().catch(()=>{});
  send('materials:changed',state);
});
sourceEvents.on('changed', () => {
  stopGenerationForSources();
  const semantic = getSemanticRetriever();
  semantic.invalidate?.('project-import');
  if (semantic.status().modelReady) semantic.indexSnapshot(getProjectIndexSnapshot(), { revision: getProjectIndexRevision() })
    .then(() => send('project:semantic-state', semantic.status()))
    .catch(() => send('project:semantic-state', semantic.status()));
  send('project:catalog', { projects: getProjectCatalog() });
});
const transcript = []; // { channel, text, ts } — capped at MAX_TRANSCRIPT_TURNS
const MAX_TRANSCRIPT_TURNS = 200; // ~30–40 minutes of conversation at normal pace
const FLUSH_MS = 900;
const STREAM_INACTIVITY_MS = 25000; // abort a stalled LLM stream so state.busy can't wedge forever
const MIN_BYTES = Math.floor(16000 * 2 * 0.12); // ~0.12s
const RMS_GATE = 180;
let flushTimer = null;
let whisperModelManager = null;
let localWhisperTranscriber = null;
let localWhisperStartPromise = null;
let localWhisperOwner = null;
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
  if (channel === 'stt:interim') { questionResolver.observe(data, false); if (data.channel === 'them') observeProjectPrefetch(false); }
  if (channel === 'transcript') { questionResolver.observe(data, true); if (data.channel === 'them') observeProjectPrefetch(true); }
  if (['stt:interim','transcript'].includes(channel) && data?.channel === 'them') {
    const target = questionResolver.resolveForSubmit();
    liveQuestions.observe(target);
    pendingSubmit.observe(target, speechIdentity());
  }
  replyLatency.observe(channel, data);
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  if (['vad:state', 'stt:interim', 'transcript'].includes(channel) && data?.channel === 'them') publishQuestionTarget();
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
  // Dynamic corrections from previous interview topics must not rewrite a new question.
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
  return ingestSpeechEvent({ ...meta, channel, text, isFinal:false, source:meta.source || 'asr' });
}

function publishTranscript(channel, text, meta = {}) {
  return ingestSpeechEvent({ ...meta, channel, text, isFinal:true, source:meta.source || 'asr' });
}

function dialogueChanged() { send('dialogue:changed', {sessionId:dialogue.sessionId,revision:dialogue.revision}); }
function speechTurn(event) {
  return {...event, audioSourceChannel:event.channel, ts:event.receivedAt, channel:event.speaker==='interviewer'||event.channel==='them'&&!event.roleCorrected&&store.getSettings().speechInputMode!=='single-microphone'?'them':event.speaker==='candidate'?'you':'unknown',
    utteranceKey:event.utteranceKey || event.eventId, sourceId:event.sourceId || event.source,
    sourceSessionId:event.sourceSessionId || event.sessionId};
}
function updateSpeechTranscript(event) {
  const index=transcript.findIndex(turn=>turn.eventId===event.eventId);
  if(index>=0) transcript.splice(index,1);
  const turn=speechTurn(event);
  if(event.isFinal) { pushTranscript(turn); transcript.sort((a,b)=>a.orderMs-b.orderMs || a.ingestOrder-b.ingestOrder); }
  // Echo detection can change the earlier event's role too.
  for(const old of transcript) {
    const current=dialogue.events.get(old.eventId);
    if(current?.speaker==='unknown'&&!(current.channel==='them'&&!current.roleCorrected&&store.getSettings().speechInputMode!=='single-microphone')) {old.channel='unknown';old.speaker='unknown';old.echoOf=current.echoOf;}
  }
  return turn;
}
function rebuildSpeechTarget(changedEvent) {
  const before=questionResolver.resolveForSubmit(),claims=questionResolver.claims,lastSubmitted=questionResolver.lastSubmitted,lastRetryable=questionResolver.lastRetryable;
  questionResolver.reset({epoch:conversation.epoch});
  liveQuestions.reset(); pendingSubmit.cancel('target-rebuilt');
  for (const event of dialogue.ordered()) if (event.speaker === 'interviewer' || event.channel === 'them' && !event.roleCorrected) {
    questionResolver.observe(speechTurn(event), event.isFinal);
    liveQuestions.observe(questionResolver.resolveForSubmit());
  }
  const rebuilt=questionResolver.resolveForSubmit();
  if(before.questionId&&rebuilt.sourceKeys.some(key=>before.sourceKeys.includes(key))) {
    questionResolver.currentQuestionId=before.questionId;questionResolver.revision=before.revision+(before.text===rebuilt.text?0:1);
    const last=liveQuestions.turns.at(-1);if(last){last.questionId=before.questionId;last.revision=questionResolver.revision;}
  }
  if(changedEvent?.roleCorrected&&changedEvent.speaker!=='interviewer'&&before.sourceKeys.some(key=>key.endsWith(':'+(changedEvent.utteranceKey||changedEvent.eventId)))&&!rebuilt.sourceKeys.some(key=>before.sourceKeys.includes(key)))questionResolver._clearActive('current-speaker-uncertain');
  questionResolver.claims=claims;questionResolver.lastSubmitted=lastSubmitted;questionResolver.lastRetryable=lastRetryable;
  publishQuestionTarget();
}
function ingestSpeechEvent(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('无效的对话事件');
  if(input.sessionId&&input.sessionId!==dialogue.sessionId||input.session_id&&input.session_id!==dialogue.sessionId)
    return {accepted:false,reason:'stale-session'};
  const channel=['you','them'].includes(input.channel)?input.channel:input.speaker==='candidate'?'you':input.speaker==='interviewer'?'them':null;
  const normalized=normalizeSpeechText(input.text,store.getSettings(),'');
  if(!normalized) return {accepted:false,reason:'empty'};
  if(channel==='them'&&isSpeechNoise(normalized)) return {accepted:false,reason:'speech-noise'};
  const isFinal=input.isFinal!==false&&input.is_final!==false;
  const draftKey=[input.sourceId||input.source||'asr',input.sourceSessionId||dialogue.sessionId,channel].join(':');
  let eventId=input.eventId||input.event_id;
  if(!eventId&&!input.utteranceKey) {
    if(isFinal&&!speechDraftIds.has(draftKey)) {
      const duplicate=dialogue.ordered().findLast(event=>event.isFinal&&event.channel===channel&&event.text===normalized&&Date.now()-event.receivedAt>=0&&Date.now()-event.receivedAt<6500);
      if(duplicate)return {accepted:false,reason:'duplicate',event:duplicate,sessionId:dialogue.sessionId,revision:dialogue.revision};
    }
    eventId=speechDraftIds.get(draftKey)||`speech-${++speechEventSequence}`;
    if(!isFinal) speechDraftIds.set(draftKey,eventId);
  }
  dialogue.setActiveProject(dialogue.activeProjectIds,getProjectIndexRevision());
  const sourceIdentityKey=String(input.sourceId||input.source||'stream');
  if((channel==='them'||input.speaker==='interviewer')&&input.sourceSessionId&&questionResolver.retiredSessions.has(`${sourceIdentityKey}@${input.sourceSessionId}`))return {accepted:false,reason:'stale-source-session'};
  const oldSourceSession = questionResolver.sourceSessions.get(sourceIdentityKey);
  if ((channel==='them'||input.speaker==='interviewer') && oldSourceSession && input.sourceSessionId && oldSourceSession !== input.sourceSessionId) pendingSubmit.cancel('source-changed');
  const result=dialogue.ingest({...input,channel,speechInputMode:store.getSettings().speechInputMode,eventId,text:normalized,rawText:input.rawText??input.text,isFinal});
  if(!result.accepted) return result;
  transcriptRecorder.recordEvent(result.event);
  if(result.event.echoOf)transcriptRecorder.recordEvent(dialogue.events.get(result.event.echoOf));
  for(const event of result.changedEchoEvents||[])transcriptRecorder.recordEvent(event);
  if(isFinal) speechDraftIds.delete(draftKey);
  const turn=updateSpeechTranscript(result.event);
  if(isFinal) {send('transcript',turn);send('stt:final',turn);}
  else send('stt:interim',turn);
  // Microphone echo markings never invalidate the selected system question.
  dialogueChanged();
  return result;
}


function cancelLocalWhisperStartup() {
  const owner=localWhisperOwner;
  if(!owner||owner.started||owner.canceled)return;
  owner.canceled=true;
  owner.cancel();
  if(localWhisperTranscriber===owner.transcriber)localWhisperTranscriber=null;
  if(localWhisperOwner===owner)activeWhisperModelId=null;
  if(owner.transcriber)owner.transcriber.forceStop().catch(()=>{});
}

function startLocalWhisper(settings) {
  if(localWhisperStartPromise)return localWhisperStartPromise;
  const owner={sessionId:dialogue.sessionId,canceled:false,started:false,transcriber:null};
  localWhisperOwner=owner;
  const cancelled=()=>Object.assign(new Error('本地语音启动已取消。'),{code:'STARTUP_CANCELLED'});
  const current=()=>localWhisperOwner===owner&&!owner.canceled&&owner.sessionId===dialogue.sessionId;
  const checkCurrent=()=>{if(!current()||!desiredCaptureState)throw cancelled();};
  const canceled=new Promise((_resolve,reject)=>{owner.cancel=()=>reject(cancelled());});
  const startup=(async()=>{
  const sessionId=owner.sessionId;
  if (!whisperModelManager) throw new Error('本地 Whisper 模型管理器尚未就绪。');
  const localSettings = settings.localWhisper || {};
  const model = requireWhisperModel(localSettings.modelId || 'base.en');
  const runtime = getWhisperRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  activeWhisperModelId = model.id;
  let transcriber = null;
  try {
    const modelPath = await whisperModelManager.verifyInstalledModel(model.id).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`请先在设置 → 语音中下载 ${model.id} 模型，再开启监听。`);
      }
      throw error;
    });
    checkCurrent();

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
      onTranscript: (channel,text,meta={})=>{if(current())publishTranscript(channel,text,{...meta,sessionId});},
      onSpeechState: (channel, speaking, durationMs, meta = {}) => {
        if(!current()||!desiredCaptureState)return;
        send('vad:state', { ...meta, channel, speaking, durationMs,
          ...(speaking ? { speechStartedAt: meta.speechStartedAt || Date.now() } : { speechEndedAt: meta.speechEndedAt || Date.now() }) });
      },
      onInterim:
  (channel, text, meta = {}) => {
    if(current())publishInterim(channel, text, {...meta,sessionId});
  },
  onMetrics:
  (metrics) => {
    if(!current())return;
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
      onStatus: (status) => {if(current()&&desiredCaptureState)send('stt:status', { provider: 'local', ...status });},
      onError: (error) => {
        if(!current()||!desiredCaptureState)return;
        sttDisabled = true;
        console.log('[local-whisper] error', error && error.message);
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `本地语音识别失败：${error.message}；未将音频发送到云端备用服务。` });
      }
    });

    owner.transcriber=transcriber;
    localWhisperTranscriber = transcriber;
    await transcriber.start();
    checkCurrent();
    owner.started=true;
  } catch (error) {
    if (localWhisperTranscriber === transcriber) localWhisperTranscriber = null;
    if(localWhisperOwner===owner)activeWhisperModelId = null;
    if (transcriber) await transcriber.forceStop().catch(() => {});
    throw error;
  }
  })();
  const pending=Promise.race([startup,canceled]).finally(()=>{
    if(localWhisperStartPromise===pending)localWhisperStartPromise=null;
    if(!owner.started&&localWhisperOwner===owner)localWhisperOwner=null;
  });
  localWhisperStartPromise=pending;
  return pending;
}

async function getWhisperOverview() {
  if (!whisperModelManager) throw new Error('本地 Whisper 模型管理器尚未就绪。');
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
    show: false,
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

  attachWindowProtection(win);
  requestWindowProtection(win);

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
    showWindowWithProtection(win);
    win.setTitle('Microsoft Edge Update');
    // Warn about missing content protection on old Windows builds
    if (isWindows && !WIN_SUPPORTS_CONTENT_PROTECTION) {
      send('status', {
        message: `当前 Windows 版本（内部版本 ${WIN_BUILD}）仅支持旧版窗口保护，录屏可能显示黑色区域。完整窗口排除需要 Windows 10 内部版本 19041 或更新版本；录屏软件是否遵守保护仍需实测。`
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
  const sessionId=dialogue.sessionId;
  const eventId=`batch-${++speechEventSequence}`;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: '未配置语音识别密钥。请在设置中配置 Qwen ASR、OpenAI、Deepgram 或 Gemini，或选择本地 Whisper。截图功能仍可使用。' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim() && res.text.trim().length > 1 && !/^[?!.,;:\-…]+$/.test(res.text.trim())) {
      publishTranscript(channel, res.text.trim(), { sourceId:'batch',sessionId,eventId });
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
  const isQuota = err.status === 429 || err.code === 'RESOURCE_EXHAUSTED' ||
    /Quota exceeded|请求额度或频率已达上限/i.test(err.message || '');
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found' || isQuota;
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', { message: `语音识别已停止：${err.provider} 密钥无效或请求额度已达上限。请在设置中检查密钥和额度后重试。` });
  } else {
    send('status', { message: '语音识别异常（' + err.provider + '）：' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('them'); flushChannel('you'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- streaming STT setup --------
function initStreamingSTT() {
  const settings = store.getSettings();
  streamingMode = false;

  pendingSubmit.cancel('source-reconnected');
  const sourceSessionId = `stream-session-${++streamingSessionSequence}`;
  const sessionId=dialogue.sessionId;
  ['you', 'them'].forEach((channel) => {
    const sttInstance = createStreamingSTT(settings, channel, {
      onTranscript: (ch, text, meta = {}) => {
        publishTranscript(ch, text, { ...meta,sessionId, sourceId: meta.sourceId || 'stream', sourceSessionId: meta.sourceSessionId || sourceSessionId });
      },
      onInterim: (ch, text, meta = {}) => {
        publishInterim(ch, text, { ...meta,sessionId, sourceId: meta.sourceId || 'stream', sourceSessionId: meta.sourceSessionId || sourceSessionId });
      },
      onError: (err) => {
        if(sessionId!==dialogue.sessionId)return;
        console.log('[streaming-stt] error', err.provider, err.message);
        const batchFallbackAvailable = createSTT(settings).available;
        stopStreamingSTT(); // close WebSockets and clear keep-alive intervals
        if (batchFallbackAvailable) {
          send('status', { message: `${err.provider} 流式识别异常：${err.message}；正在切换到批量识别。` });
          startFlushLoop();
        } else if (!sttDisabled) {
          sttDisabled = true;
          send('status', { message: `${err.provider} 语音识别已停止：${err.message}；当前服务不支持批量识别备用模式。` });
        }
        streamingMode = false;
      },
      onStatusChange: (ch, status) => {
        if(sessionId!==dialogue.sessionId)return;
        send('stt:status', { channel: ch, status });
        if (status === 'audio-gap') send('status', {message:`${ch === 'them' ? '面试官' : '候选人'}音频缓冲已溢出，部分语音未送达识别服务；请检查网络并核对题目。`});
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
function queueCaptureState(active) {
  desiredCaptureState=!!active;
  if(!desiredCaptureState)cancelLocalWhisperStartup();
  captureTransition=captureTransition.catch(()=>state.capturing).then(()=>setCapturing(!!active));
  return captureTransition;
}

async function setCapturing(active) {
  if(active&&!desiredCaptureState)return state.capturing;
  if (active === state.capturing && (active||!localWhisperTranscriber&&!localWhisperStartPromise)) return state.capturing;

  if (active) {
    sttDisabled = false; // reset on re-enable
    const settings = store.getSettings();
    if ((settings.sttProvider || 'auto') === 'local') {
      const sessionId=dialogue.sessionId;
      try {
        await startLocalWhisper(settings);
        if(!desiredCaptureState||sessionId!==dialogue.sessionId)return false;
        state.capturing = true;
        console.log('[cue] capture started, mode: local');
        send('capture:state', { active: true, streaming: false, mode: 'local' });
        return true;
      } catch (error) {
        state.capturing = false;
        if (error.code === 'STARTUP_CANCELLED') {
          if(!desiredCaptureState) {
            send('stt:status', { provider: 'local', status: 'off' });
            send('capture:state', { active: false, streaming: false, mode: 'local' });
          }
          return false;
        }
        if(sessionId!==dialogue.sessionId||!desiredCaptureState)return false;
        desiredCaptureState = false;
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `本地语音识别无法启动：${error.message}；未向云端服务发送音频。` });
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
  cancelLocalWhisperStartup();
  stopFlushLoop();
  stopStreamingSTT();
  buffers.you = []; buffers.them = [];
  vad.you.reset(); vad.them.reset();
  ringBuffers.you.clear(); ringBuffers.them.clear();
  const stoppingLocalTranscriber = localWhisperTranscriber;
  const stoppingOwner=localWhisperOwner;
  localWhisperTranscriber = null;
  send('capture:state', { active: false, streaming: false, mode: stoppingLocalTranscriber ? 'local' : 'off' });
  if (stoppingLocalTranscriber) {
    send('stt:status', { provider: 'local', status: 'stopping' });
    try {
      await stoppingLocalTranscriber.stop();
    } catch (error) {
      console.log('[local-whisper] stop error', error && error.message);
    } finally {
      if(localWhisperOwner===stoppingOwner) {
        localWhisperOwner=null;
        activeWhisperModelId = null;
        send('stt:status',{provider:'local',status:'off'});
      }
    }
  }
  return false;
}

// -------- feature runner --------
async function runFeature(mode, userText, { retrySnapshot = null, submitSnapshot = null } = {}) {
  if(submitSnapshot&&(submitSnapshot.epoch!==conversation.epoch||submitSnapshot.questionId!==questionResolver.currentQuestionId))return;
  const triggerAt = performance.now();
  const def = MODES[mode];
  if (!def) { send('llm:error', { message: '未知的回答模式。' }); return; }
  const settings = JSON.parse(JSON.stringify({...store.getSettings(),...personalWorkspace.getSelectedJobProfileContext({store,materialService})}));
  const explicit = typeof userText === 'string' ? userText.trim() : '';
  const screenRequest = ['assist','leetcode'].includes(mode);
  const voiceAnswer = ['say', 'answerThis', 'ask', 'assist', 'technical'].includes(mode);
  let resolved = explicit ? questionResolver.manualSnapshot(explicit, { epoch: conversation.epoch })
    : retrySnapshot || submitSnapshot || (voiceAnswer ? questionResolver.resolveForSubmit({ allowPartial: true, epoch: conversation.epoch }) : null);
  if (explicit && resolved) liveQuestions.observe(resolved);
  const liveContext = liveQuestions.select(resolved || {text:explicit}, settings.liveContextPolicy);
  if (resolved) resolved = {...resolved, referenceContext: liveContext.referenceContext || undefined, referenceSpeaker: liveContext.referenceContext?'interviewer':undefined};
  const question = screenRequest ? explicit || resolved?.text || '识别当前屏幕任务并给出解题帮助'
    : explicit || resolved?.text || (voiceAnswer ? '' : conversation.recent.at(-1)?.question || '');
  if (screenRequest) resolved = {...questionResolver.manualSnapshot(question,{epoch:conversation.epoch}),screenSourceQuestionId:resolved?.source==='manual'?undefined:resolved?.questionId};
  if (!resolved && question) resolved = questionResolver.manualSnapshot(question, {epoch:conversation.epoch});
  if (voiceAnswer && !screenRequest && !question) {
    if (state.capturing || state.transcribing.them || resolved?.pendingText || resolved?.interimText) {
      pendingSubmit.arm(resolved, speechIdentity(), mode);
    } else send('status', {message:'请开启监听或输入问题。'});
    publishQuestionTarget();
    return;
  }
  pendingSubmit.cancel('explicit-submit');
  if (!retrySnapshot && resolved && questionResolver.claims.has(`${resolved.epoch}:${resolved.questionId}:${resolved.revision}`)) return;
  const policy = resolveInstantPolicy(settings, mode, question);
  if (state.busy) {
    if (activeGeneration?.snapshot?.questionId === resolved?.questionId && activeGeneration?.snapshot?.revision === resolved?.revision && activeGeneration.mode === mode && !retrySnapshot) return;
    if (!voiceAnswer && mode !== 'leetcode') { send('status', { message: '当前回答仍在生成。' }); return; }
    const previous = activeGeneration;
    activeGeneration = null;
    previous?.controller.abort();
    if(previous) dialogue.recordSuggestion({requestId:previous.id,sessionId:previous.sessionId,status:'canceled'});
    if (previous?.snapshot) questionResolver.settle(previous.snapshot, 'canceled');
    state.busy = false;
  }

  // For live answering, the resolver has already decided which interviewer
  // fragments belong to the answer target. Do not leak a trailing incomplete
  // ASR fragment back into the prompt through raw transcript history. Candidate
  // speech is kept for genuine follow-up context; the confirmed question is
  // inserted below by withCurrentQuestion().
  // Freeze real speech separately from suggestions and from request timestamps.
  // An explicit topic exit is handled by the speech selector, not by dropping
  // all candidate speech whenever the question lacks a follow-up keyword.
  const spokenState = liveContext.policy.includeCandidateSpeech && !screenRequest
    ? dialogue.selectContext({question,projectIds:spokenProjectIds(question),maxEvents:10,maxChars:3600,
        since:liveQuestions.turns.slice(-(liveContext.policy.historyWindowTurns+1))[0]?.startedAt || dialogue.ordered().slice(-10)[0]?.receivedAt || Date.now()})
    : {eventIds:[],claims:[],projectIds:[],text:'',revision:dialogue.revision};
  const speechIds = new Set(spokenState.eventIds);
  const freshTranscript = ['recap','followup'].includes(mode) ? transcript.slice()
    : transcript.filter(turn => turn.channel === 'you' && speechIds.has(turn.eventId));
  const contextTranscript = withCurrentQuestion(freshTranscript, question);
  const fromResolved = !explicit && resolved?.text === question;
  const partial = fromResolved && resolved?.semanticStatus === 'incomplete';
  const sourceKey = fromResolved ? snapshotSourceKey(resolved) : '';
  const interviewPlan = ['say', 'answerThis', 'ask', 'assist', 'technical'].includes(mode) && question
    ? planInterviewQuestion({ text: question, partial, sourceKey, mode }) : null;
  const timing = replyLatency.start(mode, question, { sourceKeys: resolved?.sourceKeys || resolved?.keys || [],
    triggerAt, questionSnapshot: resolved, questionSource: explicit ? 'manual' : retrySnapshot ? 'retry' : resolved?.provisional ? 'stt-interim' : 'stt-final',
    epoch: conversation.epoch, executionProfile: policy.instant ? 'instant' : 'standard', ...getBuildIdentity() });
  const frozen = voiceAnswer || mode === 'leetcode' ? questionResolver.claim(resolved, timing.requestId) || resolved : resolved;
  const generation = { id: timing.requestId, sessionId:dialogue.sessionId, spokenRevision:spokenState.revision, entityIndex:projectEntityIndex, controller: new AbortController(), epoch: conversation.epoch, snapshot: frozen, mode, policy, timing, materials:materialService.snapshot };
  generation.diagnostic={requestId:generation.id,sessionId:generation.sessionId,epoch:generation.epoch,mode,
    executionProfile:policy.executionProfile,startedAt:new Date().toISOString(),status:'preparing',dispatched:false,
    answerDomain:settings.answerDomain,styleVersion:require('./src/oral-answer-policy').VERSION,questionRevision:frozen?.revision,triggerId:timing.requestId,triggerClockDomain:'process-performance-ms',triggerWallAt:new Date().toISOString(),liveContext:{...liveContext,turns:liveContext.turns.map(t=>({questionId:t.questionId,revision:t.revision}))},triggerAt,questionId:frozen?.questionId,pendingSubmit:pendingSubmitDiagnostic,
    provider:null,model:null,modelIdentitySource:'not-created',servedModel:null,build:{...getBuildIdentity()},
    materials:{generation:generation.materials.generation,factRevision:generation.materials.factRevision,sourceRevision:generation.materials.sourceRevision,registryRevision:generation.materials.registryRevision},
    evidenceRevision:null,jobProfileId:diagnosticText(settings.jobProfileId||settings.activeJobProfileId||'',80)};
  lastActualRequest=generation.diagnostic;
  lastFrozenSnapshot = frozen; latestUiRequestId = generation.id;
  if (frozen?.status === 'claimed') {
    targetModes.set(frozen.questionId, mode);
    while (targetModes.size > 8) targetModes.delete(targetModes.keys().next().value);
  }
  if (mode === 'assist') lastScreenSnapshot = frozen;
  activeGeneration = generation;
  state.busy = true;
  let streamSettled = false;
  const owned = () => activeGeneration === generation && conversation.epoch === generation.epoch;
  const emit = (channel, data) => { if (owned()) send(channel, { ...data, requestId: generation.id, epoch: generation.epoch,
    questionId: frozen?.questionId, questionRevision: frozen?.revision }); };
  publishQuestionTarget();
  if (policy.instant) ragSession.suspend(generation.id);
  try {
    // Local verbatim answers are available before adapter creation or API-key checks.
    const qa = !screenRequest ? generation.materials.qaIndex.match(question, {projectId:settings.currentProjectId,referenceContext:liveContext.referenceContext,detailed:settings.qaAnswerDetailed}) : null;
    generation.diagnostic.qa = qa ? {...qa,answer:undefined} : null;
    if (qa?.direct) {
      generation.diagnostic.status='completed'; generation.diagnostic.delivery='qa-verbatim'; generation.diagnostic.modelCalls=0;
      emit('llm:start',{mode,userBubble:question,snapshot:frozen}); emit('qa:hit',qa);
      emit('llm:token',{text:qa.answer}); emit('llm:done',{delivery:'qa-verbatim'});
      dialogue.recordSuggestion({requestId:generation.id,sessionId:generation.sessionId,status:'completed',text:qa.answer,question,eventIds:[]});
      transcriptRecorder.recordAnswer({sessionId:generation.sessionId,requestId:generation.id,question,answer:qa.answer});
      questionResolver.settle(frozen,'completed'); return;
    }
    const llm = createLLM(settings, { executionProfile: policy.executionProfile });
    generation.provider = llm.provider;
    Object.assign(generation.diagnostic,{provider:diagnosticText(llm.provider),model:diagnosticText(llm.model),modelIdentitySource:'selected-adapter'});
    const effectiveSettings = {...settings,...(policy.executionProfile === 'instant'?{smart:false}:{}),...(settings.manualProjectKnowledgeEnabled===false?{projectKnowledge:''}:{})};
    timing.configure?.({ ...llm.diagnostics, model: llm.model });
    const userBubble = def.userBubble !== null ? def.userBubble
      : (mode === 'ask' || mode === 'answerThis' ? question : null);
    emit('llm:start', { userBubble, small: !!def.small, mode,
      category: mode !== 'leetcode' ? detectCategory(contextTranscript) : null,
      snapshot: frozen, executionProfile: policy.instant ? 'instant' : 'standard' });
    emit('llm:profile', { ...llm.diagnostics, executionProfile: policy.instant ? 'instant' : 'standard', referenceDraft: policy.instant });
    if (!llm.ready) throw new Error(llm.configurationError || '请先完成模型设置。');
    if (!question && ['ask', 'answerThis'].includes(mode)) throw new Error('请先输入问题或等待识别到面试官发言。');
    if (screenRequest) {
      const result = await require('./src/screen-task-runner').runScreenTask({llm,settings,requirement:explicit || resolved?.text || '',taskState:screenTaskState,
        questionId:resolved?.screenSourceQuestionId,capture:captureScreenshot,signal:generation.controller.signal,emit,timing,diagnostic:generation.diagnostic});
      if (!owned()) return;
      const screenSnapshot=Object.freeze({...frozen,text:result.route.title,screenType:result.route.type,taskId:result.task.taskId});
      generation.snapshot=screenSnapshot; lastFrozenSnapshot=screenSnapshot;
      generation.diagnostic.rawAnswer=result.answer;
      emit('screen:task',{...result.task,override:screenTaskState.override});
      transcriptRecorder.recordAnswer({sessionId:generation.sessionId,requestId:generation.id,question:result.route.title,answer:result.answer});
      dialogue.recordSuggestion({requestId:generation.id,sessionId:generation.sessionId,status:'completed',text:result.answer,question:result.route.title,eventIds:[]});
      questionResolver.settle(frozen,'completed'); timing.finish({aborted:false}); emit('llm:done',{}); return;
    }
    const request = conversation.begin({ mode, question, transcript: contextTranscript,
      settings: effectiveSettings, catalog: generation.materials.registry.projects,
      executionProfile: policy.instant ? 'instant' : 'standard', questionSnapshot: frozen,
      manualFingerprint: policy.instant ? instantCards.manualFingerprint : undefined,
      interviewPlan, spokenState:liveContext.policy.includeCandidateSpeech?spokenState:null,liveContext,projectEntityHint:generation.entityIndex.infer(question), evidenceRevision: readProjectIndexRevision({ preparedOnly: true }) });
    generation.diagnostic.evidenceRevision=diagnosticText(request.evidenceRevision,128);
    dialogue.setActiveProject(request.plan.canonicalProjectIds || [], request.evidenceRevision);
    dialogue.recordSuggestion({requestId:generation.id,sessionId:generation.sessionId,status:'generating',question,eventIds:spokenState.eventIds});
    if(explicit)transcriptRecorder.recordManualQuestion({sessionId:generation.sessionId,requestId:generation.id,question});
    request.plan.preparedOnly = realtimePrefetchEnabled(settings) && !settings.smart;
    if (!request.plan.retrieve) ragSession.pause();
    if (request.plan.projectSwitched) ragSession.retainScopes(request.plan.scopes);
    formalProjectPlan = request.plan;
    emit('project:active', { answerDomain: settings.answerDomain, switchHint: request.plan.switchHint, projectId: request.plan.projectIds?.length === 1 ? request.plan.projectIds[0] : '',
      label: request.plan.projectLabel || '', reason: request.plan.reason, retrieve: request.plan.retrieve });
    const checklistText = !policy.instant && interviewPlan ? formatInterviewChecklist(request.checklist, { maxChars: 2600, includeCurrent: !!settings.smart }) : '';
    // Only spend prompt/retrieval/output budgets on old pending items that are
    // actually shown this round. The original current question remains intact.
    if (request.checklist) {
      request.checklist = { ...request.checklist,
        questions: request.checklist.questions.filter(item => item.current || checklistText.includes(item.text)),
        pending: request.checklist.pending.filter(item => checklistText.includes(item.text)) };
    }
    const effectiveInterviewPlan = interviewPlan ? { ...interviewPlan,
      scenario: interviewPlan.scenario || (!policy.instant && request.checklist?.scenario) || '',
      subQuestions: [...interviewPlan.subQuestions, ...(!policy.instant ? request.checklist?.pending || [] : [])] } : null;
    const answerPlan = getAnswerPlan(question, effectiveInterviewPlan);
    if (typeof settings.aiRules === 'string' && settings.aiRules.trim()) {
      answerPlan.customStyle = true;
      answerPlan.maxTokens = Math.max(answerPlan.maxTokens, 1000);
    }

    let imageDataUrl = null;
    const screenStarted = performance.now();
    const needsScreen = shouldCaptureScreen(mode, question);
    // Screen capture and local context preparation are independent. Start the
    // capture now; await its handled result after context, with no abandoned
    // rejecting promise when the request is cancelled.
    const screenPromise = needsScreen ? captureScreenshot().then(image => ({ image, ms: performance.now() - screenStarted }), error => ({ error })) : null;
    const contextStarted = performance.now();
    const fast = !effectiveSettings.smart && ['say', 'answerThis', 'ask', 'assist', 'technical', 'leetcode'].includes(mode);
    const retrieval = { ...retrievalInput(question, request.plan, effectiveInterviewPlan, contextCharsFor(mode, answerPlan), sourceKey,
      policy.instant || fromResolved ? frozen : null,mode),
      requestId: timing.requestId, hashFallback: !fast };
    const materialIdentity = {generation:generation.materials.generation,factRevision:generation.materials.factRevision,sourceRevision:generation.materials.sourceRevision,registryRevision:generation.materials.registryRevision};
    request.materials=materialIdentity;
    const relatedSpeech=(request.spokenState?.claims||[]).filter(claim=>claim.status!=='uncertain').map(claim=>claim.text).join('\n');
    const topicContext=liveContext.referenceContext || '';
    retrieval.topicContext=topicContext;
    const contextualQuestion=topicContext?question+'\n被指代的上一真人问题（仅用于检索，不作为本轮待答）：'+topicContext:question;
    const factQuery=relatedSpeech?contextualQuestion+'\n当前相关真人发言（用于检索，不是事实依据）：'+relatedSpeech:contextualQuestion;
    const factSelection = policy.factsEnabled ? generation.materials.factPacks.select(factQuery, {resolution:{...request.plan,metricContext:topicContext},primaryQuestion:question,maxCards:12}) : null;
    // Citations guide bounded lookups in the current prepared source index.
    // The returned original source chunks, rather than the card prose, remain
    // the implementation evidence for this request's frozen material version.
    const topicFacts=topicContext?generation.materials.factPacks.select(topicContext,{resolution:request.plan,primaryQuestion:topicContext,maxCards:4}):null;
    retrieval.sourceHints=[...(factSelection?.evidence||[]),...(topicFacts?.evidence||[])].flatMap(card=>(card.sources||[]).slice(0,3)
      .map(ref=>({projectId:card.projectId,path:ref.repositoryPath||ref.path,symbol:ref.symbol})))
      .filter(ref=>ref.path&&!ref.path.startsWith('handoff/')).slice(0,12);
    if(factSelection?.evidence.some(c=>c.cardId==='metric.cae.replay')) retrieval.sourceHints.unshift({projectId:'cae',path:'worker/agents/execution_manager.py',symbol:'submit'},{projectId:'cae',path:'worker/agents/process_registry.py',symbol:'claim'});
    const evidenceLimits=resolveEvidenceLimits({question,answerPlan,instant:policy.instant});
    const canRetrieveSources = policy.ragPolicy !== 'off' && request.plan.retrieveSources;
    const preparedSources = peekReadyEvidence({ snapshot: frozen,
      projectPlan: request.plan, epoch: conversation.epoch, projectRevision: retrieval.projectRevision,
      sourceHints:retrieval.sourceHints,
      modelVersion: retrieval.modelVersion, projectIndexSnapshot: readProjectIndexSnapshot({ preparedOnly: true }),
      cache: activeProjectContextCache, ragSession, retrievalInput: retrieval, policy: canRetrieveSources ? 'ready-only' : 'off',
      maxSources:evidenceLimits.mechanismDetail?6:evidenceLimits.longScenario?4:3,
      maxChars:evidenceLimits.longScenario?4800:evidenceLimits.mechanismDetail?4200:2400 });
    const ready = policy.ragPolicy !== 'standard' || !canRetrieveSources ? preparedSources : null;
    const contextBundle = policy.instant ? {context:'',evidence:ready?.evidence||[],missing:[],byQuestion:[],stats:ready?.stats||{}}
      : await buildInterviewContextBundleAsync(effectiveSettings, mode, contextTranscript,
      { ...retrieval, skipSourceRetrieval:!!ready,readySources:ready?.evidence||[],readyStats:ready?.stats||{}, requestId: timing.requestId, projectPlan: request.plan, smart: !!settings.smart,
        answerComplexity: answerPlan.level, interviewPlan: effectiveInterviewPlan,
        contextBudget: Math.max(contextCharsFor(mode, answerPlan),evidenceLimits.longScenario?8000:evidenceLimits.mechanismDetail?5200:0), projectState: request.projectInterviewState,
        signal: generation.controller.signal, deadlineAt: Date.now() + (fast ? 0 : 100), semanticWaitMs: fast ? 0 : 100,
        execution: fast ? 'fast' : 'deep', realtimeEvidencePrefetch: realtimePrefetchEnabled(settings),
        hashFallback: !fast, semanticRetriever: getSemanticRetriever(),prefetchedRetrieval:ragSession.take(retrieval,{metadata:true}) });
    if(!ready&&preparedSources.evidence.length)contextBundle.evidence=[...preparedSources.evidence,...contextBundle.evidence]
      .filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index);
    const evidencePlan=planProjectEvidence({question,resolution:request.plan,facts:factSelection?.evidence||[],sources:contextBundle.evidence,
      factsEnabled:policy.factsEnabled,sourcePolicy:policy.ragPolicy,...evidenceLimits});
    // General reference cards use the same finite request budget, but never
    // become another resume project or evidence of personal implementation.
    const candidateRole=buildCandidateRoleContext(settings,question,{project:request.plan.retrieve});
    const knowledge=policy.factsEnabled&&!candidateRole.personal&&!answerPlan.confirmation&&request.plan.kind!=='unresolved'
      ? generation.materials.factPacks.selectKnowledge(question,{jobProfileId:settings.jobProfileId,maxCards:policy.instant?2:3}):null;
    evidencePlan.contextKnowledgeIds=[];
    for(const item of knowledge?.evidence||[]) {
      const reference={...item,sourceType:'knowledge-reference',text:'通用知识参考，不证明候选人经历或项目已采用。\n'+item.text};
      const size=estimateTokens(require('./src/evidence-selector').formatEvidenceBlock(reference));
      if(evidencePlan.evidence.length>=evidenceLimits.maxSources||evidencePlan.estimatedTokens+size>evidenceLimits.evidenceTokens)continue;
      evidencePlan.evidence.push(reference);evidencePlan.contextKnowledgeIds.push(reference.id);evidencePlan.estimatedTokens+=size;
    }
    contextBundle.evidence=evidencePlan.evidence;
    applyFactCoverage(contextBundle,request.plan);
    if(request.plan.kind==='unresolved')contextBundle.missing.push({reason:'unresolved-project',message:'项目不明确，请确认项目身份。'});
    // Standard prompts and instant prompts share the same typed facts; full embedded documents stay out.
    if(!policy.instant) contextBundle.context=[...contextBundle.evidence.map(require('./src/evidence-selector').formatEvidenceBlock),contextBundle.candidateContext||''].filter(Boolean).join('\n\n');
    timing.configure({...materialIdentity,selectedCardCount:factSelection?.evidence.length||0,packRevision:materialIdentity.factRevision});
    const contextMs = performance.now() - contextStarted;
    let screenMs = 0;
    if (needsScreen) {
      try {
        const capture = await screenPromise;
        if (capture.error) throw capture.error;
        imageDataUrl = capture.image;
        screenMs = capture.ms;
        if (!imageDataUrl) throw new Error('未找到可用的屏幕来源。');
      } catch (e) {
        if (!owned()) return;
        recordEvent({ level: 'error', event: 'screen_capture_failed', msg: e.message, frame: 'captureScreenshot', context: { mode } });
        // A screen-only question cannot be answered from an old screenshot/history.
        throw new Error('屏幕截图失败，请检查屏幕录制权限后重试。');
      }
    }
    if (!owned()) return;
    if (!owned() || generation.controller.signal.aborted) return;
    request.evidenceRevision = contextBundle.evidence.find(item => item.sourceType === 'imported')?.revision ||
      (policy.instant ? readProjectIndexRevision({ preparedOnly: true }) : getProjectIndexRevision());
    generation.diagnostic.evidenceRevision=diagnosticText(request.evidenceRevision,128);
    const instantContext = policy.instant ? buildInstantContext({ settings, question, snapshot: frozen, request,
      readyEvidence: {evidence:contextBundle.evidence}, answerPlan, evidenceLimits, cards: instantCards }) : null;
    if (instantContext) {
      contextBundle.evidence = instantContext.evidence;
      contextBundle.stats.readyEvidenceHit = instantContext.evidence.length > 0;
      if (ready?.evidence.length && !instantContext.evidence.length) {
        ready.skippedReason = 'optional-context-budget'; contextBundle.stats.skippedReason = ready.skippedReason;
      }
    }
    const builtSystem = instantContext ? instantContext.system : def.buildSystem ? def.buildSystem(contextBundle.context, settings.aiRules || '',
      { answerPlan, interviewPlan, projectPlan: request.plan, hasImage: !!imageDataUrl,
        projectContextLimit:Math.min(14000,contextBundle.context.length) }) : (def.system || '');
    const narrativeRule='\nUSER/source-claim 是用户指定的口述资料，可按范围直接回答既有职责，不复述资料编辑历史；没有材料才简短说明缺口。';
    const oralRule=require('./src/oral-answer-policy').instruction({...answerPlan,code:answerPlan.code||!!imageDataUrl||mode==='leetcode'});
    const legacyNarrative='不要编造项目结果。';
    const resolvedSystem = builtSystem + (instantContext?'':'\n' + oralRule + narrativeRule + (liveContext.policy.includeCandidateSpeech?SPOKEN_CONTEXT_RULES:'')) + (request.plan.kind==='unresolved'?'\n当前未定位到对应项目资料，直接给出可落地的通用方案或小例子，不猜测具体项目身份或职责。':'');
    const initialSystem = llm.prepareSystem ? llm.prepareSystem(resolvedSystem) : resolvedSystem;
    const questionReferenceSection={id:'question-reference',text:frozen?.referenceContext ? '最近真人提问实体（仅消解指代；面试官的公司、规模、假设不属于候选人经历）：\n'+JSON.stringify({speaker:frozen.referenceSpeaker||'unspecified-question',text:frozen.referenceContext}):'',protected:true};
    const candidateRoleSection={id:'candidate-role',text:candidateRole.text,protected:candidateRole.required,priority:2};
    const responseContext = { transcript: contextTranscript, userText: question, answerPlan, partial, hasImage: !!imageDataUrl };
    const built = def.build(responseContext);
    const codeRequest=!!imageDataUrl||mode==='leetcode'||require('./src/oral-answer-policy').isCode(question);
    const responseBudgets={oral:600,code:Math.min(16384,Number(settings.responseBudgets?.code)||6000)};
    const maxTokens=codeRequest?responseBudgets.code:answerPlan.maxTokens;
    request.responseBudget={kind:codeRequest?'code':'oral',maxTokens,maxVisibleCharacters:answerPlan.maxVisibleCharacters,styleVersion:answerPlan.version};
    request.settingsSnapshot={liveContextPolicy:liveContext.policy,qaAnswerDetailed:!!settings.qaAnswerDetailed,answerDomain:settings.answerDomain,workspaceRevision:settings.personalWorkspaceRevision,sourceRevision:generation.materials.sourceRevision,styleVersion:answerPlan.version,questionRevision:frozen?.revision,provider:settings.provider,model:llm.model,smart:!!settings.smart,jobProfileId:settings.jobProfileId,
      contextWindowTokens:settings.contextWindowTokens||16384,responseBudgets};
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
    const scenario = interviewPlan && scenarioText && !built.includes(scenarioText)
      ? '=== 当前假设场景（不代表项目实际指标） ===\n' + scenarioText : '';
    const prepared = prepareFinalRequest({ system: initialSystem, history: instantContext ? instantContext.history : history, maxTokens,
      contextWindow: settings.contextWindowTokens || 16384, imageDataUrl, evidence: contextBundle.evidence,
      evidenceGapNote: policy.instant ? '资料仅供参考；未附全时仍按当前条件给可采用方案，不编造实际经历或指标。' : undefined,
      currentSections: instantContext ? [...instantContext.currentSections,candidateRoleSection,questionReferenceSection,...evidencePlan.evidence.filter(c=>(c.protectedMetric||c.protectedMechanism)).map(c=>({id:'metric:'+c.id,text:require('./src/evidence-selector').formatEvidenceBlock(c),protected:true}))] : [
        ...evidencePlan.evidence.filter(c=>(c.protectedMetric||c.protectedMechanism)).map(c=>({id:'metric:'+c.id,text:require('./src/evidence-selector').formatEvidenceBlock(c),protected:true})),
        candidateRoleSection,questionReferenceSection,
        { id: 'topic', text: topic, priority: 1 }, { id: 'memory', text: memory, priority: 0 },
        { id: 'spoken-state', text: request.spokenContext ? 'SPOKEN_STATE（真人实际发言，仅用于承接和纠正）\n'+request.spokenContext : '', protected:true },
        { id: 'question', text: built, protected: true }, { id: 'scenario', text: scenario, protected: true },
        { id: 'evidence-needs', text: formatRetrievalRequirements(contextBundle), protected: true },
        { id: 'checklist', text: checklist, priority: 3 }, { id: 'progress', text: progress, priority: 2 }
      ] });
    const { system, turns } = prepared;
    if (!prepared.fits) throw new Error('完整问题与必要约束超过当前模型窗口，请在设置中填写正确的模型窗口，或分批提交问题。');
    if (prepared.stats.droppedEvidence) {
      // A pool hit is sufficient only for the evidence that actually survives
      // the final model window, not just the earlier source character budget.
      contextBundle.stats.poolSufficientHit = false;
      if (contextBundle.stats.retrievalPath === 'pool-covered') contextBundle.stats.retrievalPath = 'pool-partial';
      contextBundle.stats.finalBudgetDroppedSources = prepared.stats.droppedEvidence;
    }
    let sentEvidence = prepared.evidence;
    if ((evidencePlan.evidence || []).some(item => (item.protectedMetric||item.protectedMechanism) && !sentEvidence.some(e => e.id === item.id))) throw new Error('模型窗口不足以保留完整指标卡，请增加上下文窗口。');
    if (policy.instant) contextBundle.stats.readyEvidenceHit = sentEvidence.length > 0;
    const localFacts = sentEvidence.filter(item=>item.sourceType==='project-pack'&&item.provenance==='CODE'&&item.status==='verified').slice(0,2).map(item=>({cardId:item.cardId,projectName:item.projectName,text:item.text}));
    if (localFacts.length) { timing.configure({ timeToLocalFacts: +(performance.now()-timing.started).toFixed(2) }); emit('llm:local-facts', {facts:localFacts}); }
    let materialDiagnostics={...materialIdentity,projectIds:request.plan.canonicalProjectIds||[],resolutionReason:request.plan.resolutionReason, ...sentEvidenceDiagnostics(evidencePlan,sentEvidence),factSelectionMs:factSelection?.stats.selectionMs||0,contextBuildMs:performance.now()-contextStarted};
    emit('llm:materials',materialDiagnostics);
    emit('llm:evidence', { sources: sentEvidence.map(item => ({ id: item.id, projectName: item.projectName,
      path: item.path, startLine: item.startLine, endLine: item.endLine, text: item.text,
      docType: item.docType, truthScope: item.truthScope, status: item.status, partial: item.partial })),
      missing: [...(contextBundle.missing || []), ...(prepared.missing || [])] });
    const qaEvidence=sentEvidence.filter(item=>item.qa);
    if(qaEvidence.length)emit('qa:generated',{cardIds:qaEvidence.map(item=>item.cardId),revision:generation.materials.factRevision});
    let requestSent = performance.now();
    generation.timing = timing;
    generation.requestSent = requestSent;
    uiReplyTimings.clear();
    uiReplyTimings.set(generation.id, { epoch: generation.epoch, started: timing.started, timing });
    while (uiReplyTimings.size > 32) uiReplyTimings.delete(uiReplyTimings.keys().next().value);
    console.log('[latency][prompt] ' + JSON.stringify({ requestId: timing.requestId, mode, epoch: generation.epoch, questionId: frozen?.questionId, questionRevision: frozen?.revision,
      executionProfile: policy.instant ? 'instant' : 'standard', modelProfile: policy.executionProfile, ...getBuildIdentity(),
      ragPolicy: policy.ragPolicy, readyEvidenceHit: !!ready?.stats.readyEvidenceHit, skippedReason: ready?.skippedReason,
      optionalContextTokensEstimate: instantContext?.stats.optionalContextTokensEstimate ?? null,
      instantContext: instantContext?.stats, queueDelayMs: 0,
      screenMs: +screenMs.toFixed(2), contextMs: +contextMs.toFixed(2),
      provider: llm.provider, model: llm.model, smart: !!settings.smart,
      promptChars: system.length + turns.reduce((n, t) => n + t.text.length, 0), systemChars: system.length,
      hasImage: !!imageDataUrl, maxTokens, answerComplexity: answerPlan.level,
      questionVersion: retrieval.questionVersion, projectRevision: retrieval.projectRevision,
      retrieval: contextBundle.stats || {}, finalBudget: prepared.stats,
      ...request.stats, prepareMs: +(requestSent - timing.started).toFixed(2) }));

    let contentDeadline = null;
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
      if (policy.instant) contentDeadline = createFirstContentDeadline({ ms: Math.max(100, Math.min(30000, Number(settings.firstContentDeadlineMs) || 6000)),
        onTimeout: () => { generation.firstContentTimedOut = true; timing.configure?.({ outcome: 'first-content-timeout' }); stop('模型未在首正文期限内返回答案，已停止。' + (sentEvidence.length ? '可参考下方已核对的项目要点，或切换服务后重答。' : '当前没有可用的本地项目资料，请补充资料或切换服务后重答。')); } });
      rearm();
      deadline = setTimeout(() => stop('本轮生成超过 180 秒，已停止；请缩小问题范围后重试。'), 180000);
    });
    try {
      const result = await Promise.race([
        llm.stream({ system, turns, imageDataUrl, signal: generation.controller.signal, mode,
          maxTokens,
          onDiagnostics: metadata => { if (owned()) { generation.modelDiagnostics = metadata; emit('llm:profile', { ...metadata,
            executionProfile: policy.instant ? 'instant' : 'standard', referenceDraft: policy.instant && !sentEvidence.length }); } },
          onRequest: serialized => {
            if (!owned()) return;
            Object.assign(generation.diagnostic,{status:'dispatched',dispatched:true,model:diagnosticText(serialized?.model)||generation.diagnostic.model,
              modelIdentitySource:typeof serialized?.model==='string'?'serialized-request':'selected-adapter'});
            requestSent = performance.now(); generation.requestSent = requestSent;
            contentDeadline?.dispatch();
            sentEvidence = visibleEvidence(prepared.evidence, serialized);
            materialDiagnostics={...materialDiagnostics,...sentEvidenceDiagnostics(evidencePlan,sentEvidence)};
            emit('llm:materials',materialDiagnostics);
            timing.dispatched({ ...generation.modelDiagnostics, ragPolicy: policy.ragPolicy,
              readyEvidenceHit: policy.instant ? sentEvidence.length > 0 : !!ready?.stats.readyEvidenceHit,
              skippedReason: ready?.skippedReason, optionalContextTokensEstimate: instantContext?.stats.optionalContextTokensEstimate,
              sourceCount: sentEvidence.length, queueDelayMs: 0 });
            emit('llm:metrics', timing.metrics());
            console.log('[latency][model] ' + JSON.stringify({ requestId: timing.requestId,
              ...timing.metrics(), provider: llm.provider, model: llm.model, smart: !!effectiveSettings.smart,
              enableThinking: serialized.enable_thinking ?? null,
              reasoningEffort: serialized.reasoning_effort ?? null,
              thinkingBudget: serialized.config?.thinkingConfig?.thinkingBudget ?? null,
              automaticRetriesDisabled: generation.modelDiagnostics?.automaticRetriesDisabled ?? llm.diagnostics?.automaticRetriesDisabled ?? false }));
          },
          onUsage: usage => {
            if (owned()) { timing.usage(usage); console.log('[latency][usage] ' + JSON.stringify({ ...timing.metrics(), ...usage })); }
          },
          onCompletion: metadata => {
            if (owned() && !streamSettled && !generation.controller.signal.aborted) completion = metadata;
          },
          onActivity: event => {
            if (!owned() || streamSettled || generation.controller.signal.aborted) return;
            timing.activity(event);
            if (event?.phase === 'reasoning' && !generation.modelDiagnostics?.reasoningObserved) {
              generation.modelDiagnostics = { ...generation.modelDiagnostics, reasoningObserved: true,
                thinkingStatus: generation.modelDiagnostics?.thinkingStatus === 'disabled' ? 'anomaly' : generation.modelDiagnostics?.thinkingStatus || 'unknown' };
              timing.configure(generation.modelDiagnostics);
              emit('llm:profile', generation.modelDiagnostics);
              emit('llm:metrics', timing.metrics());
            }
            rearm();
          },
          onToken: text => {
            if (!owned() || streamSettled || generation.controller.signal.aborted || !text) return;
            answer += text;
            const uiTiming = uiReplyTimings.get(generation.id);
            if (uiTiming && uiTiming.firstTokenAt == null) uiTiming.firstTokenAt = performance.now();
            if (text.trim()) {
              contentDeadline?.content(text);
              timing.content(text, requestSent); generation.firstContent = true;
              ragSession.resume(generation.id); emit('llm:metrics', timing.metrics());
            }
            rearm();
            emit('llm:token', { text });
            if (canRetrieveSources && text.trim() && !generation.adjacentQueued) {
              generation.adjacentQueued = true;
              setImmediate(() => prepareAdjacentEvidence(retrieval, sentEvidence));
            }
          }
        }), stopped
      ]);
      if (!owned() || generation.controller.signal.aborted) return;
      if (!answer.trim() && typeof result === 'string' && result.trim()) {
        answer = result;
        timing.content(answer, requestSent); generation.firstContent = true; ragSession.resume(generation.id);
        emit('llm:metrics', timing.metrics());
        emit('llm:token', { text: answer });
      }
      if (!answer.trim()) throw new Error('模型没有返回正文，请检查模型与思考模式设置后重试。');
      const visibleIds = new Set(sentEvidence.map(item => item.id));
      request.unavailableEvidenceQuestionIds = (contextBundle.byQuestion || []).filter(item => {
        if (!item.scopes?.length) return false;
        if (item.sourceRefs?.some(id => !visibleIds.has(id))) return true;
        const hypothetical = item.evidenceNeeds?.some(need => need.type === 'hypothetical' || need.hypothetical === true);
        return (item.missing || []).some(gap => !hypothetical || ['ownership', 'collaboration', 'performance'].includes(gap.type) ||
          gap.type === 'incident' && item.evidenceNeeds?.some(need => need.type === 'incident' && !need.hypothetical));
      }).map(item => item.id);
      if (contextBundle.missing?.some(gap => ['index-not-ready', 'unresolved-project'].includes(gap.reason))) {
        request.unavailableEvidenceQuestionIds.push(...(effectiveInterviewPlan?.subQuestions || []).map(item => item.id));
      }
      Object.assign(generation.diagnostic,{status:'completed',finishReason:diagnosticText(completion.finishReason,80),truncated:!!completion.truncated,metrics:actualRequestMetrics(timing)});
      request.actualRequest=JSON.parse(JSON.stringify(generation.diagnostic));
      generation.diagnostic.rawAnswer=answer;
      generation.diagnostic.presentation=require('./src/oral-answer-policy').presentation(answer,{...answerPlan,code:codeRequest});
      emit('llm:presentation', generation.diagnostic.presentation);
      const committed = conversation.commit(request, answer, { completion, evidence: sentEvidence });
      generation.diagnostic.status=committed?'completed':'uncommitted';
      dialogue.recordSuggestion({requestId:generation.id,sessionId:generation.sessionId,status:committed?'completed':'uncommitted',text:answer,question,eventIds:spokenState.eventIds});
      if(committed)transcriptRecorder.recordAnswer({sessionId:generation.sessionId,requestId:generation.id,question,answer});
      if (committed && frozen) questionResolver.settle(frozen, 'completed');
    } finally {
      streamSettled = true;
      contentDeadline?.dispose();
      clearTimeout(watchdog);
      clearTimeout(deadline);
      if (abortListener) generation.controller.signal.removeEventListener('abort', abortListener);
    }
    timing.finish({ aborted: false }); emit('llm:metrics', timing.metrics());
    emit('llm:done', {});
  } catch (e) {
    Object.assign(generation.diagnostic,{status:generation.controller.signal.aborted?'canceled':'failed',errorClass:diagnosticText(e?.name||'Error',80),firstContentTimeout:!!generation.firstContentTimedOut});
    dialogue.recordSuggestion({requestId:generation.id,sessionId:generation.sessionId,status:generation.controller.signal.aborted?'canceled':'failed',question,eventIds:spokenState.eventIds});
    if (frozen) questionResolver.settle(frozen, generation.controller.signal.aborted ? 'canceled' : 'failed');
    if (owned()) {
      recordEvent({ level: 'error', event: 'llm_failed', msg: e?.message || String(e), frame: 'runFeature', context: { mode, provider: generation.provider } });
      emit('llm:metrics', timing.finish({ aborted: generation.controller.signal.aborted }));
      emit('llm:error', { message: e?.message || String(e), timeout: !!generation.firstContentTimedOut });
    }
  } finally {
    streamSettled = true;
    ragSession.resume(generation.id);
    timing.finish({ aborted: generation.controller.signal.aborted });
    if(['preparing','dispatched'].includes(generation.diagnostic.status))generation.diagnostic.status=generation.controller.signal.aborted||!owned()?'canceled':'failed';
    generation.diagnostic.metrics=actualRequestMetrics(timing);
    if (activeGeneration === generation) { activeGeneration = null; state.busy = false; publishQuestionTarget(); }
  }
}

require('./src/application-integration').setFeatureDispatcher(mode => runFeature(mode, ''), shortcutState);
// -------- IPC --------
function cancelCurrentGeneration(reason='user') {
  pendingSubmit.cancel(reason);
  const previous=activeGeneration;
  activeGeneration=null;
  previous?.controller.abort();
  state.busy=false;
  if(previous) {
    dialogue.recordSuggestion({requestId:previous.id,sessionId:previous.sessionId,status:'canceled'});
    if(previous.snapshot) questionResolver.settle(previous.snapshot,'canceled');
    ragSession.resume(previous.id);
    send('llm:done',{requestId:previous.id,epoch:previous.epoch,canceled:true,reason});
  }
  publishQuestionTarget();
  return {ok:true,canceled:!!previous,sessionId:dialogue.sessionId};
}
ipcMain.on('shortcut:action', (_event, mode) => require('./src/application-integration').dispatchFeature(mode,'renderer'));
ipcMain.handle('llm:cancel',()=>cancelCurrentGeneration());
ipcMain.handle('clipboard:write',(_event,value)=>{
  if(typeof value!=='string'||value.length>256*1024)throw new Error('待复制内容无效或过长，请分段复制。');
  clipboard.writeText(value);return {ok:true};
});
ipcMain.on('llm:cancel',()=>cancelCurrentGeneration());
ipcMain.handle('dialogue:event',(_event,input)=>ingestSpeechEvent(input));
ipcMain.handle('dialogue:snapshot',(_event,options={})=>dialogue.snapshot(options));
ipcMain.handle('dialogue:recording:state',()=>transcriptRecorder.status());
ipcMain.handle('dialogue:recording:flush',()=>transcriptRecorder.flush());
ipcMain.handle('dialogue:recording:folder',async()=>{
  await transcriptRecorder.flush();await fs.promises.mkdir(transcriptRecorder.directory,{recursive:true,mode:0o700});
  const error=await shell.openPath(transcriptRecorder.directory);
  if(error)throw new Error('无法打开面试记录目录，请检查系统文件管理器。');
  return {ok:true};
});
ipcMain.handle('dialogue:correct',(_event,input={})=>{
  const result=dialogue.correct(input);
  if(result.accepted) {
    transcriptRecorder.recordEvent(result.event);
    cancelCurrentGeneration('dialogue-corrected');
    const turn=updateSpeechTranscript(result.event);
    send('transcript',turn);
    rebuildSpeechTarget(result.event);
    dialogueChanged();
  }
  return result;
});
const qaService = require('./src/qa-service');
ipcMain.handle('qa:state',()=>qaService.state(materialService));
ipcMain.handle('qa:prepare',async(_event,input={})=>{
  if (!input.text && !input.filePath) {
    const selected=await dialog.showOpenDialog(win,{title:'导入项目问答 JSON / 标准 Markdown',properties:['openFile'],filters:[{name:'问答',extensions:['json','md']}]});
    if(selected.canceled)return {canceled:true};
    input={filePath:selected.filePaths[0]};
  }
  return qaService.prepare(materialService,input);
});
ipcMain.handle('qa:commit',(_event,input)=>materialService.commitImport(input));
ipcMain.handle('qa:discard',(_event,token)=>typeof token==='string'&&materialService.previews.delete(token));
ipcMain.handle('qa:try',(_event,input={})=>materialService.snapshot.qaIndex.match(String(input.question||''),{projectId:input.projectId||store.getSettings().currentProjectId,detailed:!!input.detailed}));
ipcMain.handle('qa:edit',(_event,input)=>qaService.edit(materialService,input));
ipcMain.handle('qa:export',async()=>{
  const selected=await dialog.showSaveDialog(win,{title:'导出项目问答库',defaultPath:'cue-qa.json',filters:[{name:'JSON',extensions:['json']}]});
  if(selected.canceled)return {canceled:true};
  fs.writeFileSync(selected.filePath,JSON.stringify(qaService.state(materialService).library,null,2),{mode:0o600});return {ok:true};
});
ipcMain.handle('screen:attachment',(_event,input={})=>screenTaskState.attach(input.name||'题面与DDL',input.text));
ipcMain.handle('screen:accept',(_event,input={})=>screenTaskState.accept(input.label));
ipcMain.handle('screen:mode',(_event,input={})=>{
  if(input.end){cancelCurrentGeneration('screen-task-ended');screenTaskState.end();}
  if(input.continue)screenTaskState.continueNext=true;
  if(input.mode){if(!['auto','solve','vibe-coding'].includes(input.mode))throw new Error('无效屏幕模式');screenTaskState.overrideNext=input.mode;screenTaskState.continueNext=!!screenTaskState.task;}
  return {mode:screenTaskState.overrideNext||screenTaskState.override,task:screenTaskState.task};
});
ipcMain.handle('materials:personal:state',()=>personalWorkspace.getPersonalWorkspaceState({materialService,store}));
ipcMain.handle('materials:personal:prepare',async(_event,input={})=>{
  let filePath=input.filePath;
  if(!filePath&&!input.workspace) {
    const selected=await dialog.showOpenDialog(win,{title:'导入个人资料工作区',properties:['openFile'],filters:[{name:'CUE 个人资料',extensions:['json']}]});
    if(selected.canceled||!selected.filePaths?.length) return {canceled:true};
    filePath=selected.filePaths[0];
  }
  return personalWorkspace.preparePersonalWorkspaceImport({filePath,workspace:input.workspace,materialService,store});
});
ipcMain.handle('materials:personal:commit',async(_event,input={})=>{
  const result=await personalWorkspace.commitPersonalWorkspaceImport({token:input.token,baseGeneration:input.baseGeneration,materialService,store});
  instantCards.update(store.getSettings());
  send('materials:personal:changed',result);
  return result;
});
ipcMain.handle('materials:personal:job',(_event,input={})=>{
  cancelCurrentGeneration('job-profile-changed');
  const result=personalWorkspace.selectJobProfile({jobProfileId:typeof input==='string'?input:input.jobProfileId,materialService,store});
  send('materials:personal:changed',result);
  return result;
});
function redactedDiagnostics() {
  const settings=store.getSettings();
  const secrets=[];
  const collect=(value,key='')=>{
    if(typeof value==='string'&&/key|secret|password|token/i.test(key)&&value.length>=6) secrets.push(value);
    else if(value&&typeof value==='object') for(const [name,item] of Object.entries(value)) collect(item,key+':'+name);
  };
  collect(settings);
  const scrub=value=>{
    if(typeof value==='string') {
      let text=personalWorkspace.sanitizeResumeForPrompt(value);
      for(const secret of secrets) text=text.split(secret).join('[密钥已省略]');
      return text.replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g,'[密钥已省略]').replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi,'$1[密钥已省略]');
    }
    if(Array.isArray(value))return value.map(scrub);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/api.?key|secret|password|authorization|access.?token/i.test(key)).map(([key,item])=>[key,scrub(item)]));
    return value;
  };
  return scrub({schemaVersion:2,exportedAt:new Date().toISOString(),build:getBuildIdentity(),platform:process.platform,
    materials:{generation:materialService.snapshot.generation,factRevision:materialService.snapshot.factRevision,sourceRevision:materialService.snapshot.sourceRevision},
    jobProfileId:settings.activeJobProfileId||'',model:{provider:lastActualRequest?.provider||null,model:lastActualRequest?.model||null},
    configuredModel:{provider:diagnosticText(settings.provider),fast:diagnosticText(settings.models?.[settings.provider]?.fast),smart:diagnosticText(settings.models?.[settings.provider]?.smart),smartEnabled:!!settings.smart},
    liveContextPolicy:require('./src/live-context-policy').normalize(settings.liveContextPolicy),pendingSubmit:pendingSubmitDiagnostic,screenTask:screenTaskState.task,
    lastActualRequest,
    dialogue:dialogue.snapshot(),question:currentTargetEnvelope(),lastRequest:conversation.recent.at(-1)||null});
}
ipcMain.handle('diagnostics:export',async()=>{
  const selected=await dialog.showSaveDialog(win,{title:'导出本地脱敏会话诊断',defaultPath:`cue-diagnostics-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'JSON',extensions:['json']}]});
  if(selected.canceled||!selected.filePath)return {canceled:true};
  await fs.promises.writeFile(selected.filePath,JSON.stringify(redactedDiagnostics(),null,2),{encoding:'utf8',mode:0o600});
  return {canceled:false,fileName:path.basename(selected.filePath),sessionId:dialogue.sessionId};
});
ipcMain.handle('question:get-target', () => currentTargetEnvelope());
ipcMain.handle('question:mark-answered', (_event, input = {}) => {
  questionResolver.markAnswered(input);
  publishQuestionTarget();
  return currentTargetEnvelope();
});
ipcMain.handle('question:retry', (_event, questionId) => {
  const snapshot = questionResolver.retrySnapshot(typeof questionId === 'string' ? questionId : lastFrozenSnapshot?.questionId);
  if (!snapshot?.text || snapshot.epoch !== conversation.epoch) return { ok: false, reason: 'no-retry-target' };
  return runFeature(targetModes.get(snapshot.questionId) || 'say', '', { retrySnapshot: snapshot });
});
ipcMain.handle('provider:capabilities', (_event, config = {}) => {
  const draft = { ...store.getSettings(), ...config };
  return require('./src/openai-compatible').resolveProviderCapabilities({provider:draft.provider,model:draft.models?.[draft.provider]?.fast,protocolPreset:draft.providerProtocolPresets?.[draft.provider],baseURL:draft.provider === 'deepseek' ? draft.deepseekBaseUrl : draft.baseUrl});
});
ipcMain.handle('provider:test', async (_event, config = {}) => {
  const draft = { ...store.getSettings(), ...config };
  const llm = createLLM(draft, {executionProfile:'instant'});
  if (!llm.ready) throw new Error(llm.configurationError);
  const start = performance.now(), controller=new AbortController();
  let firstContentMs=null, body=''; const timer=setTimeout(()=>controller.abort(),15000);
  try {
    await llm.stream({system:'只回答“连接成功”。',turns:[{role:'user',text:'请回答连接成功'}],mode:'ask',maxTokens:32,signal:controller.signal,
      onToken:text=>{if(text.trim()&&firstContentMs===null) firstContentMs=performance.now()-start;body+=text;}});
    if(!body.trim()) throw new Error('模型未返回正文');
    return {provider:llm.provider,model:llm.model,firstContentMs,totalMs:performance.now()-start,effectiveThinking:llm.diagnostics.thinkingStatus,content:body.slice(0,120)};
  } catch(error) { throw new Error(controller.signal.aborted?'连接测试超时':error.status ? `连接失败 HTTP ${error.status}` : '连接测试失败，请检查地址、密钥、模型及网络权限。'); }
  finally { clearTimeout(timer); }
});
const factStatus = () => {const snap=materialService.snapshot;return {...materialService.state(),revision:snap.factRevision,updatedAt:snap.facts.updatedAt,coverage:snap.factPacks.index.coverage,index:snap.factPacks.getIndex()};};
ipcMain.handle('materials:state',()=>materialService.state());
ipcMain.handle('materials:prepare',async(event,input={})=>{
  const operationId=typeof input.operationId==='string'?input.operationId.slice(0,100):'';
  const onProgress=progress=>{if(operationId&&!event.sender.isDestroyed())event.sender.send('materials:progress',{operationId,...progress});};
  if(input.index)return materialService.prepareImport({kind:'json',index:input.index,mode:input.mode||'merge',onProgress});
  const kind=['json','folder','zip'].includes(input.kind)?input.kind:'json';
  onProgress({phase:'select'});
  const selected=await dialog.showOpenDialog(win,{title:'选择项目材料',properties:[kind==='folder'?'openDirectory':'openFile'],...(kind==='folder'?{}:{filters:[{name:'项目材料',extensions:[kind==='zip'?'zip':'json']}]})});
  if(selected.canceled||!selected.filePaths?.length)return {canceled:true};
  return materialService.prepareImport({kind,path:selected.filePaths[0],mode:input.mode||'merge',factPaths:input.factPaths||[],onProgress});
});
ipcMain.handle('materials:commit',async(_event,preview)=>{
  const result=await materialService.commitImport(preview);
  const persisted=materialService.verifyPersisted();
  const sourced=result.projects.filter(p=>p.sourceProjectIds.length);
  if(!store.getSettings().currentProjectId&&sourced.length===1)store.setSettings({currentProjectId:sourced[0].id});
  return {...result,persisted};
});
ipcMain.handle('materials:rollback',(_e,input)=>materialService.rollbackMaterials(input));
ipcMain.handle('facts:status',()=>factStatus());
ipcMain.handle('facts:save',async(_e,payload)=>{const p=await materialService.prepareImport({kind:'json',index:payload?.index});await materialService.commitImport(p);return factStatus();});
ipcMain.handle('facts:rebuild',()=>{const result=materialService.refresh();if(result?.error)throw new Error(result.error);materialService.verifyPersisted();return factStatus();});
ipcMain.handle('facts:import',async()=>{const selected=await dialog.showOpenDialog(win,{title:'导入本地事实包',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(selected.canceled)return {canceled:true};return materialService.prepareImport({kind:'json',path:selected.filePaths[0]});});
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  sttDisabled = false;
  const before = store.getSettings();
  const next = store.setSettings(patch);
  transcriptRecorder.configure(next.saveInterviewTranscript!==false);
  if (['resumeText', 'projectKnowledge', 'starStories', 'whyCompany', 'whyLeaving', 'workStyle', 'salaryTarget'].some(key => before[key] !== next[key])) instantCards.update(next);
  const identity = settings => JSON.stringify([settings.liveContextPolicy,settings.qaAnswerDetailed,settings.speechInputMode,settings.realtimeAnswerMode, settings.instantRagPolicy, settings.realtimeEvidencePrefetch, settings.smart, settings.provider,
    settings.models, settings.liveContextPolicy, settings.answerDomain, settings.activeJobProfileId, settings.personalWorkspaceRevision, settings.aiRules, settings.projectFactsEnabled,settings.sourceRagPolicies,settings.manualProjectKnowledgeEnabled, settings.currentProjectId, settings.baseUrl, settings.projectKnowledge, settings.starStories]);
  if (identity(before) !== identity(next)) {
    ragSession.reset(); semanticRetriever?.resetSession?.();
    if (activeGeneration?.policy.instant && !activeGeneration.firstContent) ragSession.suspend(activeGeneration.id);
    if (before.realtimeEvidencePrefetch !== next.realtimeEvidencePrefetch || before.projectKnowledge !== next.projectKnowledge ||
      before.starStories !== next.starStories) activeProjectContextCache.clear();
    if (!realtimePrefetchEnabled(before) && realtimePrefetchEnabled(next)) warmProjectIndex().catch(() => {});
  }
  return next;
});
ipcMain.on('project:prefetch', (_event, payload) => scheduleProjectPrefetch(payload));
ipcMain.handle('project:semantic-state', () => getSemanticRetriever().status());
ipcMain.handle('project:semantic-prepare', async (_event, payload = {}) => {
  let directory;
  if (payload.importLocal) {
    const selection = await dialog.showOpenDialog(win, { title: '选择已校验的本地语义模型目录', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    directory = selection.filePaths[0];
  }
  const semantic = getSemanticRetriever();
  stopGenerationForSources();
  await semantic.prepare({ directory, onProgress: progress => send('project:semantic-progress', progress) });
  await semantic.indexSnapshot(getProjectIndexSnapshot(), { revision: getProjectIndexRevision(),
    onProgress: progress => send('project:semantic-progress', progress) });
  send('project:semantic-state', semantic.status());
  return { canceled: false, state: semantic.status() };
});
ipcMain.handle('answer:domain', (_event, domain) => {
  if (!require('./src/answer-domain').DOMAINS.includes(domain)) throw new Error('无效的回答范围');
  stopGenerationForSources(); formalProjectPlan = null;
  dialogue.setActiveProject(domain === 'general' ? [] : [domain], getProjectIndexRevision());
  const next=store.setSettings({answerDomain:domain,currentProjectId:domain==='general'?'':domain});
  send('settings:changed',next); return next;
});
ipcMain.handle('project:current', (_event, projectId) => {
  const id = String(projectId || '');
  if (id && !getProjectCatalog().some(project => (project.id || project.projectId) === id)) throw new Error('此项目已不在当前索引中，请重新选择。');
  stopGenerationForSources();
  formalProjectPlan = null;
  dialogue.setActiveProject(id?[id]:[],getProjectIndexRevision());
  return store.setSettings({ currentProjectId: id, answerDomain: ['cae','arclight'].includes(id)?id:id?null:'general' });
});
ipcMain.handle('capture:toggle', () => {
  return queueCaptureState(!desiredCaptureState);
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
        '本地 Whisper 模型管理器尚未就绪。'
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
    throw new Error('请先停止监听，再删除当前使用的模型。');
  }
  const result = await whisperModelManager.deleteModel(modelId);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-import', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('本地 Whisper 模型管理器尚未就绪。');
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('请先停止监听，再替换当前使用的模型。');
  }
  const selection = await dialog.showOpenDialog(win, {
    title: `导入 ggml-${modelId}.bin`,
    properties: ['openFile'],
    filters: [{ name: 'whisper.cpp 模型', extensions: ['bin'] }]
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
  dialogue.reset();
  transcriptRecorder.startSession(dialogue.sessionId);
  speechDraftIds.clear();

  uiReplyTimings.clear();
  formalProjectPlan = null;
  ragSession.reset();
  activeProjectContextCache.clear();
  semanticRetriever?.resetSession?.();
  questionResolver.reset({ epoch: conversation.epoch });
  pendingSubmit.cancel('session-reset'); liveQuestions.reset(); screenTaskState.end();
  pendingSubmit.cancel('reset'); liveQuestions.reset(); screenTaskState.end();
  lastFrozenSnapshot = null; latestUiRequestId = null;
  lastScreenSnapshot = null;
  targetModes.clear();
  publishQuestionTarget();
  if (previous) send('llm:done', { requestId: previous.id, canceled: true });
  transcript.splice(0, transcript.length);
  dialogueChanged();
  replyLatency.reset();
  const restartCapture=desiredCaptureState||state.capturing||!!localWhisperStartPromise||!!localWhisperTranscriber;
  cancelLocalWhisperStartup();
  if(restartCapture) captureTransition=captureTransition.catch(()=>{}).then(()=>setCapturing(false)).then(()=>desiredCaptureState?setCapturing(true):false);
  return { ok: true,sessionId:dialogue.sessionId };
});
ipcMain.on('ask', (_e, payload) => runFeature(payload?.mode, payload?.text));
ipcMain.on('llm:rendered', (_event, payload) => {
  const details = typeof payload === 'string' ? { requestId: payload, stage: 'dom' } : payload || {};
  const { requestId } = details;
  const record = uiReplyTimings.get(requestId);
  if (!record || requestId !== latestUiRequestId || record.epoch !== conversation.epoch ||
    details.epoch != null && details.epoch !== record.epoch || performance.now() - record.started > 60000) return;
  const stage = details.stage === 'paint-approx' ? 'paint-approx' : 'dom';
  if (record[stage] || record.timing.metrics().firstContentMs == null) return;
  record[stage] = true;
  const metrics = { ...record.timing.renderAck({ ...details, stage }), stage };
  send('llm:metrics', metrics);
  if (stage === 'paint-approx') uiReplyTimings.delete(requestId);
});
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('you', arrayBuffer); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('them', arrayBuffer); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) setProtectedMouseEvents(win, typeof v === 'boolean' ? v : false); });
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
    filters: [{ name: '简历 / 岗位描述', extensions: ['pdf', 'docx'] }]
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
  require('./src/application-integration').installFeatureShortcuts();
  shortcutState.quit = globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
  for (const [name, wasRegistered] of Object.entries(shortcutState)) {
    if (!wasRegistered) {
      recordEvent({ level: 'warn', event: 'shortcut_unavailable', msg: '其他程序已占用快捷键：' + name + ' shortcut', frame: 'registerShortcuts', context: { shortcut: name } });
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
    show: false,
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
  attachWindowProtection(permWin);
  requestWindowProtection(permWin);
  permWin.loadFile(path.join(__dirname, 'renderer', 'permissions.html'));
  permWin.webContents.on('did-finish-load', () => showWindowWithProtection(permWin, { activate: true }));
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
    setCapturing:queueCaptureState,
    // Looked up rather than captured: the window is recreated on 'activate',
    // so a reference taken at startup goes stale.
    getWindow: () => win,
  });

  createWindow();
  registerShortcuts();
  // Prepare the existing local index in the background instead of charging its
  // complete cold build to the first interview answer after app restart.
  warmProjectIndex().catch(error => console.warn('[rag] warmup unavailable:', error?.code || error?.name || 'Error'));
  const indexWatch = setInterval(() => {
    if (activeGeneration?.policy.instant && !activeGeneration.firstContent) return;
    refreshProjectIndex().then(() => warmProjectIndex())
      .catch(error => console.warn('[rag] index refresh unavailable:', error?.code || error?.name || 'Error'));
  }, 2000);
  indexWatch.unref?.();
  app.once('will-quit', () => clearInterval(indexWatch));
  // Warm only an already prepared local model. This never initiates downloads.
  const semantic = getSemanticRetriever();
  semantic.warm().then(() => semantic.indexSnapshot(getProjectIndexSnapshot(), { revision: getProjectIndexRevision() }))
    .then(() => send('project:semantic-state', semantic.status()))
    .catch(() => send('project:semantic-state', semantic.status()));
}

// -------- lifecycle --------
app.whenReady().then(async () => {
  try {
    // Recover a torn private import before a bundled update can advance the
    // material generation used to identify ownership of the interrupted write.
    require('./src/personal-workspace').recoverPersonalWorkspaceImport({materialService,store});
    await require('./src/bundled-materials').installBundledMaterials({bundlePath:path.join(__dirname,'materials/bundle.json'),materialService,store});
    await require('./src/personal-workspace').installPersonalWorkspace({directory:process.env.CUE_PERSONAL_WORKSPACE,materialService,store});
    instantCards.update(store.getSettings());
  } catch(error) {
    const warning='随应用发布的材料载入失败，请检查材料包或重新安装；本地有效材料仍保留。';
    materialService.warnings.push(warning);
    console.error('[cue] bundled materials:',error.message);
    dialog.showErrorBox('项目材料载入失败',warning+'\n'+error.message);
  }
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

let recorderClosing=false;
app.on('before-quit',event=>{
  if(recorderClosing||!transcriptRecorder.file&&!transcriptRecorder.pendingBytes)return;
  event.preventDefault();recorderClosing=true;transcriptRecorder.endSession('应用关闭');
  transcriptRecorder.flush().finally(()=>app.quit());
});
app.on('will-quit', () => {
  activeGeneration?.controller.abort();
  activeGeneration = null;
  uiReplyTimings.clear();
  ragSession.reset();
  semanticRetriever?.close()?.catch(() => {});
  globalShortcut.unregisterAll();
  // Best effort, deliberately not blocking the quit: the library also removes
  // the instance file from a `process.on('exit')` handler, and a file left
  // behind is harmless anyway because readers check whether the PID is alive.
  // Delaying shutdown to tidy a directory would be the wrong trade.
  stopAppLink();
  if (whisperModelManager?.activeDownload) {
    whisperModelManager.cancelDownload(whisperModelManager.activeDownload.modelId);
  }
  desiredCaptureState=false;
  cancelLocalWhisperStartup();
  if (localWhisperTranscriber) localWhisperTranscriber.forceStop().catch(() => {});
});
app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', (e) => {
  // Don't quit while the permissions window is open — the user may be in System Settings
  if (permWin) { e.preventDefault(); return; }
  app.quit();
});
