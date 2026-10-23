const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

contextBridge.exposeInMainWorld('cue', {
  platform,
  materialState:()=>ipcRenderer.invoke('materials:state'),
  materialPrepare:input=>ipcRenderer.invoke('materials:prepare',input),
  materialCommit:input=>ipcRenderer.invoke('materials:commit',input),
  materialRollback:input=>ipcRenderer.invoke('materials:rollback',input),
  providerCapabilities: config => ipcRenderer.invoke('provider:capabilities',config),
  testProviderConnection: config => ipcRenderer.invoke('provider:test',config),
  getProjectFactPackStatus: () => ipcRenderer.invoke('facts:status'),
  importProjectFactPacks: () => ipcRenderer.invoke('facts:import'),
  rebuildProjectFactPacks: () => ipcRenderer.invoke('facts:rebuild'),
  saveProjectFactCards: payload => ipcRenderer.invoke('facts:save',payload),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  whisperModels: () => ipcRenderer.invoke('whisper:models'),
  whisperModelDownload: (modelId) => ipcRenderer.invoke('whisper:model-download', modelId),
  whisperModelCancel: (modelId) => ipcRenderer.invoke('whisper:model-cancel', modelId),
  whisperModelDelete: (modelId) => ipcRenderer.invoke('whisper:model-delete', modelId),
  whisperModelImport: (modelId) => ipcRenderer.invoke('whisper:model-import', modelId),
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  replyRendered: (requestId, details) => ipcRenderer.send('llm:rendered', details ? { requestId, ...details } : requestId),
  questionTarget: () => ipcRenderer.invoke('question:get-target'),
  questionRetry: () => ipcRenderer.invoke('question:retry'),
  captureToggle: () => ipcRenderer.invoke('capture:toggle').catch((err) => {
    console.error('[cue] captureToggle error', err);
    return false;
  }),
  captureState: () => ipcRenderer.invoke('capture:state'),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  appLinkState: () => ipcRenderer.invoke('applink:state'),
  appLinkRevoke: (callerId) => ipcRenderer.invoke('applink:revoke', callerId),
  appLinkConsentRespond: (id, allowed) => ipcRenderer.send('applink:consent-response', { id, allowed }),
  pickProfileDocument: () => ipcRenderer.invoke('profile:pickDocument'),
  projectIndexState: () => ipcRenderer.invoke('project:index-state'),
  projectImportFolder: () => ipcRenderer.invoke('project:import-folder'),
  projectImportZip: () => ipcRenderer.invoke('project:import-zip'),
  projectIndexClear: () => ipcRenderer.invoke('project:index-clear'),
  projectPrefetch: (query) => ipcRenderer.send('project:prefetch', query),
  projectCurrent: (projectId) => ipcRenderer.invoke('project:current', projectId),
  projectSemanticState: () => ipcRenderer.invoke('project:semantic-state'),
  projectSemanticPrepare: (importLocal = false) => ipcRenderer.invoke('project:semantic-prepare', { importLocal }),
  quit: () => ipcRenderer.send('app:quit'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  permissionsRequest: () => ipcRenderer.invoke('permissions:request'),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'llm:evidence', 'llm:materials', 'materials:changed', 'llm:local-facts', 'llm:profile', 'llm:metrics', 'question:target', 'project:active', 'project:catalog', 'project:semantic-progress', 'project:semantic-state', 'status', 'transcript', 'stt:interim', 'stt:final', 'stt:status', 'vad:state', 'applink:consent-request', 'hide:toggle', 'shortcut:mode', 'whisper:download-progress', 'whisper:models-changed'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
