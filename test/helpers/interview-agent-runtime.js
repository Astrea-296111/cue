'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '../..');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

const defaultChunks = [
  { path: 'TCS/README.md', startLine: 1, endLine: 5,
    text: 'TCS_ONLY TCS 阈值覆盖共享项目。困难是平台压缩、微信和 Facebook 的 JPEG 图片恢复率。验证使用用户材料注明的 TCS-ENV-42。职责只由候选人实际发言确认。' },
  { path: 'RepoPilot/README.md', startLine: 1, endLine: 8,
    text: 'REPO_ONLY RepoPilot Agent 项目。架构和核心链路是 Agent Loop / LangGraph 双运行时、工具执行和验证闭环。问题背景是自动修复代码。目标是在失败后验证重试。LangGraph 用显式状态图控制工具执行。' },
  { path: 'RepoPilot/retrieval.py', startLine: 12, endLine: 20,
    text: 'REPO_RETRIEVAL EvidenceCache implements local BM25 and FAISS hybrid retrieval with RRF. query_expansion preserves the request scope. Cache hits reuse source evidence; missing retrieval evidence causes one scoped search.' },
  { path: 'RepoPilot/checkpoint.py', startLine: 21, endLine: 27,
    text: 'REPO_STATE LangGraph checkpoint persists tool verification and retry state. def resume(checkpoint): return graph.invoke(checkpoint). AST validation rejects broken syntax.' },
  { path: 'RepoPilot/challenge.md', startLine: 1, endLine: 1, docType: 'challenge', truthScope: 'implemented', status: 'confirmed',
    text: 'REPO_ONLY_SYNTHETIC 这是合成测试资料。RepoPilot 最难的地方是 Agent Loop / LangGraph 双运行时一致性；我负责在工具执行后验证状态，通过 checkpoint 恢复测试确认没有重复执行。' },
  { path: 'FlashFlow/README.md', startLine: 1, endLine: 4,
    text: 'FLASH_ONLY FlashFlow 库存项目，Redis 与任务重试，租约续期。' }
];

function writeIndex(temp, version, chunks, options = {}) {
  if (options.indexSnapshot) {
    fs.writeFileSync(path.join(temp, 'cue-project-index-v2.json'), JSON.stringify(options.indexSnapshot));
    return;
  }
  if (version === 1) {
    fs.writeFileSync(path.join(temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks }));
    return;
  }
  // Use the real source-profile builder and the existing persisted v2 shape.
  const { buildSourceProjectProfile } = require('../../src/project-profile');
  const names = [...new Set(chunks.map(chunk => chunk.path.split('/')[0]))];
  const tagged = chunks.map(chunk => ({ ...chunk, projectId: 'fixture-' + chunk.path.split('/')[0].toLowerCase(), projectName: chunk.path.split('/')[0] }));
  const projects = names.map(name => {
    const own = tagged.filter(chunk => chunk.projectName === name);
    return { id: 'fixture-' + name.toLowerCase(), name, sourceType: 'folder', sourceName: name,
      updatedAt: '2026-10-12T00:00:00.000Z', stats: { fileCount: own.length, chunkCount: own.length },
      profile: buildSourceProjectProfile(name, own), ...(options.projects || []).find(project => project.name === name) };
  });
  fs.writeFileSync(path.join(temp, 'cue-project-index-v2.json'), JSON.stringify({ version: 2, chunkerVersion: 2,
    updatedAt: '2026-10-12T00:00:00.000Z', projects, chunks: tagged, parents: options.parents || [], stats: { fileCount: tagged.length, chunkCount: tagged.length } }));
}

/**
 * Exercise the package entry, explicit bootstrap (or frozen legacy entry), root
 * main, real planning/memory/retrieval/prompts, and the actual LLM adapter.
 * The OS/hardware and model transport are replaced; no planning or retrieval
 * result is mocked. SDK messages and scoped searches are observed unchanged.
 */
function createInterviewRuntime(t, options = {}) {
  // A new harness may observe a frozen application, but never substitutes its
  // production modules or prompts. Node dependencies remain those installed by CI.
  const root = path.resolve(options.targetRoot || path.resolve(__dirname, '../..'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-interview-agent-'));
  writeIndex(temp, options.indexVersion || 2, options.chunks || defaultChunks, options);
  const initialSettings = { provider: 'custom',
    baseUrl: 'https://example.invalid/v1', apiKeys: { custom: 'test-transport-only' },
    // Existing retrieval suites deliberately exercise the standard RAG flow.
    // Instant-mode suites opt in explicitly; production store defaults instant.
    models: { custom: { fast: 'test-model' } }, smart: false, realtimeAnswerMode: 'standard', resumeText: '', ...options.settings };
  const memorySettings = !!(options.inMemorySettings || options.liveTransport);
  // Live credentials are injected only after the real store module loads.
  // Neither the temporary store nor material snapshots ever contain keys.
  fs.writeFileSync(path.join(temp, 'cue-data.json'), JSON.stringify(memorySettings
    ? { ...initialSettings, apiKeys: {} } : initialSettings),{mode:0o600});

  let time = options.startedAt || 1_800_000_000_000;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (name, fn) => handlers.set(name, fn);
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  app.getPath = () => temp;
  app.getAppPath = () => root;
  app.getVersion = () => '0.2.2';
  app.commandLine = { appendSwitch() {} };

  const calls = [], requestOptions = [], requests = [], commits = [], searches = [], events = [], loaded = [], logs = [], transportEvents = [], observedTimes = [];
  let requestObservedAt = null, bodyText = '';
  const observeBody = text => {
    if (typeof text !== 'string' || !text.trim()) return;
    bodyText += text;
    if (!observedTimes.some(item => item.type === 'first-body')) observedTimes.push({type:'first-body', at:performance.now()});
    if (/[。！？.!?](?:[\s\n]|$)/.test(bodyText) && !observedTimes.some(item => item.type === 'first-sentence')) observedTimes.push({type:'first-sentence', at:performance.now()});
  };
  const modules = new Map(), shortcuts = new Map(), pendingShortcuts = [];
  const ownedTimers = new Set();
  const trackedTimeout = (callback, ms, ...args) => {
    const timer = setTimeout(() => { ownedTimers.delete(timer); callback(...args); }, ms);
    ownedTimers.add(timer); return timer;
  };
  const trackedInterval = (callback, ms, ...args) => { const timer=setInterval(callback,ms,...args); ownedTimers.add(timer); return timer; };
  const clearOwnedTimer = timer => { ownedTimers.delete(timer); clearTimeout(timer); clearInterval(timer); };
  let captures = 0, captureError = false, seq = 0, window;
  let response = { text: '测试答案', finishReason: 'stop' }, transport;

  class OpenAI {
    constructor(config) {
      const live = options.liveTransport;
      const Client = live && (live.Client || require('openai'));
      const client = live && new Client({ ...config, maxRetries: 0, timeout: live.totalTimeoutMs || 60000 });
      this.chat = { completions: { create: async (body, sdkOptions) => {
        requestObservedAt = performance.now(); bodyText = ''; observedTimes.length = 0;
        observedTimes.push({type:'request', at:requestObservedAt});
        calls.push(copy(body));
        requestOptions.push(sdkOptions);
        if (live) {
          const maxTokens = Number(body.max_tokens || body.max_completion_tokens);
          if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > (live.maxOutputTokens || 1800)) {
            transportEvents.push({ type: 'error', code: 'output-token-budget' });
            throw new Error('Live evaluation output token budget exceeded.');
          }
          try { live.onAttempt?.({ model: body.model, maxTokens }); }
          catch (error) { transportEvents.push({ type: 'error', code: 'request-budget' }); throw error; }
          const controller = new AbortController();
          const signal = sdkOptions?.signal ? AbortSignal.any([sdkOptions.signal, controller.signal]) : controller.signal;
          let firstContent = false;
          const timeout = code => {
            transportEvents.push({ type: 'error', code });
            controller.abort(new Error(code));
          };
          const first = setTimeout(() => timeout('first-content-timeout'), live.firstContentTimeoutMs || 15000);
          const total = setTimeout(() => timeout('total-timeout'), live.totalTimeoutMs || 60000);
          const cleanup = () => { clearTimeout(first); clearTimeout(total); };
          try {
            const stream = await client.chat.completions.create(body, { ...sdkOptions, maxRetries: 0,
              timeout: live.totalTimeoutMs || 60000, signal });
            return (async function* () {
              try {
                for await (const part of stream) {
                  if (!firstContent && String(part.choices?.[0]?.delta?.content || '').trim()) {
                    firstContent = true;
                    clearTimeout(first);
                  }
                  observeBody(part.choices?.[0]?.delta?.content);
                  yield part;
                }
              } catch (error) {
                transportEvents.push({ type: 'error', code: signal.aborted ? 'aborted' : 'provider-error',
                  status: Number.isInteger(error?.status) ? error.status : null });
                throw error;
              } finally { cleanup(); }
            })();
          } catch (error) {
            cleanup();
            transportEvents.push({ type: 'error', code: signal.aborted ? 'aborted' : 'provider-error',
              status: Number.isInteger(error?.status) ? error.status : null });
            throw error;
          }
        }
        if (transport) return transport(body, sdkOptions, calls.length - 1, config);
        const selected = { ...response };
        return (async function* () {
          if (selected.error) throw selected.error;
          for (const text of selected.chunks || [selected.text]) {
            yield { choices: [{ delta: { content: text } }] };
          }
          if (selected.finishReason !== null) yield { choices: [{ delta: selected.refusal ? { refusal: selected.refusal } : {}, finish_reason: selected.finishReason }] };
        })();
      } } };
    }
  }

  const mocks = {
    electron: { app, ipcMain: ipc, BrowserWindow: { getAllWindows: () => window ? [window] : [] },
      globalShortcut: { unregister: key => shortcuts.delete(key), register: (key, fn) => { shortcuts.set(key, fn); return true; } },
      dialog: options.dialogPaths ? { showOpenDialog: async () => {
        const selected = options.dialogPaths.shift();
        return selected ? { canceled: false, filePaths: [selected] } : { canceled: true, filePaths: [] };
      } } : {} },
    openai: OpenAI,
    'src/screen.js': { captureScreenshot: async () => {
      captures++;
      if (captureError) throw new Error('capture failed');
      return 'data:image/png;base64,' + Buffer.from('screen-' + captures).toString('base64');
    } },
    'src/stt.js': {}, 'src/stt-streaming.js': {}, 'src/resume.js': {}, 'src/applink.js': { recordEvent() {} },
    'src/whisper-model-manager.js': {}, 'src/whisper-model-catalog.js': {},
    'src/whisper-runtime.js': {}, 'src/local-whisper-transcriber.js': {}
  };
  if(options.liveSpeech) { delete mocks['src/stt.js']; delete mocks['src/stt-streaming.js']; }
  if(options.localWhisperHardware) {
    for(const [file,exports]of Object.entries(options.localWhisperHardware)) {
      if(!['src/whisper-model-manager.js','src/whisper-model-catalog.js','src/whisper-runtime.js','src/local-whisper-transcriber.js'].includes(file))throw new Error('Invalid local Whisper hardware replacement');
      mocks[file]=exports;
    }
  }
  if (options.semanticRetriever) mocks['src/project-embeddings.js'] = { getProjectEmbeddings: () => options.semanticRetriever };
  const shim = { _resolveFilename: (id, parent) => createRequire(parent.filename).resolve(id) };
  function load(file) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (Object.hasOwn(mocks, relative)) return mocks[relative];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {}, filename: file };
    modules.set(file, module);
    loaded.push(relative);
    const context = vm.createContext({ module, exports: module.exports, __filename: file, __dirname: path.dirname(file),
      require: id => shim._load(id, module), process, Buffer, URL, Headers, AbortController, AbortSignal, performance,
      Date: options.liveTransport || options.realTime ? Date : ClockDate, setTimeout:trackedTimeout, clearTimeout:clearOwnedTimer, setInterval:trackedInterval, clearInterval:clearOwnedTimer, setImmediate, queueMicrotask,
      console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)])) });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    module.context = context;
    if (relative === 'src/store.js' && memorySettings) {
      if(options.persistProfile) {
        // Keep the real settings persistence/verification used by personal
        // import transactions. Only provider credentials cross a memory-only
        // boundary; temporary profile files are private and removed at cleanup.
        const getPersisted=module.exports.getSettings,setPersisted=module.exports.setSettings;
        let apiKeys={...(initialSettings.apiKeys||{})};
        const withKeys=stored=>({...stored,apiKeys:{...(stored.apiKeys||{}),...apiKeys}});
        module.exports.getSettings=()=>withKeys(getPersisted());
        module.exports.setSettings=(patch,settingsOptions)=>{
          const {apiKeys:updateKeys,...ordinary}=patch||{};
          if(updateKeys)apiKeys={...apiKeys,...updateKeys};
          return withKeys(setPersisted(ordinary,settingsOptions));
        };
      } else {
      const merge = (base, patch) => {
        const result = { ...base };
        for (const [key, value] of Object.entries(patch || {})) result[key] = value && typeof value === 'object' && !Array.isArray(value)
          ? merge(base?.[key] || {}, value) : value;
        return result;
      };
      let settings = merge(copy(module.exports.getSettings()), initialSettings);
      module.exports.getSettings = () => settings;
      module.exports.setSettings = patch => {
        const update = { ...(patch || {}) };
        if (Object.hasOwn(update, 'instantRagPolicy') && !update.sourceRagPolicies) update.sourceRagPolicies = { instant: update.instantRagPolicy === 'off' ? 'off' : 'ready-only' };
        if (typeof update.aiRules === 'string') update.aiRules = update.aiRules.slice(0, module.exports.MAX_AI_RULES_CHARS);
        settings = merge(settings, update);
        return settings;
      };
      }
    }
    if (relative === 'src/conversation-memory.js') {
      const originalBegin = module.exports.ConversationMemory.prototype.begin;
      const originalCommit = module.exports.ConversationMemory.prototype.commit;
      module.exports.ConversationMemory.prototype.begin = function (...args) {
        const request = originalBegin.apply(this, args);
        requests.push(copy(request));
        return request;
      };
      module.exports.ConversationMemory.prototype.commit = function (request, answer, config) {
        const result = originalCommit.call(this, request, answer, config);
        commits.push({ request: copy(request), answer, config: config ? copy(config) : null, committed: result });
        return result;
      };
    }
    if (relative === 'src/project-knowledge.js') {
      for (const method of ['searchProjectKnowledge', 'getProjectCandidates', 'prefetchProjectKnowledge', 'getProjectOverviewChunks', 'getProjectProfileContext']) {
        const original = module.exports[method];
        module.exports[method] = function (...args) {
          const config = method === 'getProjectOverviewChunks' ? args[0] : args[1];
          const result = original.apply(this, args);
          searches.push({ method, query: method === 'getProjectOverviewChunks' ? '' : args[0],
            scopes: config?.scopes ? Array.from(config.scopes) : null,
            options: config ? copy(config) : null,
            rows: Array.isArray(result) ? copy(result) : copy((result?.rows || []).map(row => row.chunk || row)), atCall: calls.length });
          return result;
        };
      }
    }
    return module.exports;
  }
  shim._load = (id, parent) => {
    if (id === 'module') return shim;
    if (Object.hasOwn(mocks, id)) return mocks[id];
    const native = createRequire(parent.filename);
    return id.startsWith('.') ? load(native.resolve(id)) : native(id);
  };
  const entry = load(path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).main));
  const ready = options.coldIndex ? Promise.resolve() : load(path.join(root, 'src/project-knowledge.js')).warmProjectIndex();
  const context = modules.get(path.join(root, 'main.js')).context;
  async function submit(mode, text = '') {
    await ready;
    time++;
    for (const listener of ipc.listeners('ask')) await listener(null, { mode, text });
  }
  window = { isDestroyed: () => false, webContents: {
    getURL: () => 'file://' + root + '/renderer/index.html',
    send(channel, data) {
      if (channel === 'llm:token') {
        const text = String(data?.text || '');
        if (!options.liveTransport) observeBody(text);
        if (text.trim() && !observedTimes.some(item=>item.type==='renderer-delivery')) observedTimes.push({type:'renderer-delivery',at:performance.now()});
      }
      events.push(copy({ channel, ...data }));
      if (channel === 'shortcut:mode') pendingShortcuts.push(submit(data.mode));
    }
  } };
  context.__window = window;
  vm.runInContext('win = __window', context);
  entry?.installShortcutOverrides?.();
  const value = expression => vm.runInContext(expression, context);
  const clear = () => handlers.get('transcript:clear')(null);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await ready.catch(() => {}); clear(); for(const timer of ownedTimers) clearOwnedTimer(timer); fs.rmSync(temp, { recursive: true, force: true });
  };
  t.after(dispose);
  function speech(channel, text, final, meta = {}) {
    time += 100;
    Object.assign(context, { __text: text, __channel: channel,
      __meta: { sourceId: 'test', utteranceKey: 'u' + ++seq, utteranceOrder: seq, ...meta } });
    return value(`${final ? 'publishTranscript' : 'publishInterim'}(__channel, __text, __meta)`);
  }
  return {
    temp, ready, calls, requestOptions, requests, commits, searches, events, loaded, logs, transportEvents, observedTimes, value, dispose,
    snapshot: expression => copy(value(expression)),
    exports: relative => load(path.join(root, relative)),
    answer(text, config = {}) { if (options.liveTransport) throw new Error('Live transport cannot be replaced.'); transport = null; response = { text, finishReason: 'stop', ...config }; },
    behavior(factory) { if (options.liveTransport) throw new Error('Live transport cannot be replaced.'); transport = factory; },
    final: (text, meta) => speech('them', text, true, meta),
    interim: (text, meta) => speech('them', text, false, meta),
    candidate: (text, meta) => speech('you', text, true, meta),
    audio(channel, pcm) { if(!['you','them'].includes(channel))throw new Error('Invalid audio channel');ipc.emit(channel==='you'?'mic:pcm':'system:pcm',null,pcm); },
    advance(ms) { time += ms; },
    ask: (mode = 'say', text = '') => submit(mode, text),
    async shortcut(key) {
      if (!shortcuts.has(key)) throw new Error('Shortcut was not registered: ' + key);
      shortcuts.get(key)();
      await Promise.all(pendingShortcuts.splice(0));
    },
    clear,
    hasHandler: name => handlers.has(name),
    invoke: async (name, payload) => { await ready; if (!handlers.has(name)) throw new Error('Unsupported production IPC: ' + name); return handlers.get(name)(null, payload); },
    async importMaterialSnapshot({ facts, sources }) {
      await ready;
      // The production service validates and atomically publishes both layers.
      // Values cross the VM as data; no caller-supplied expression is executed.
      context.__materialInput = copy({ facts, sources });
      try {
        context.__materialPreview = await value('materialService.prepareImport({index:__materialInput.facts,sourceSnapshot:__materialInput.sources,mode:"replace-all"})');
        if (context.__materialPreview.conflicts.length || context.__materialPreview.packConflicts.length) throw new Error('Material snapshot has unresolved project identity.');
        const state = await value('materialService.commitImport(__materialPreview)');
        value('materialService.verifyPersisted()');
        return copy(state);
      } finally { delete context.__materialInput; delete context.__materialPreview; }
    },
    captureFailure(value = true) { captureError = value; },
    get captures() { return captures; },
    async prefetch(payload) { await ready; ipc.emit('project:prefetch', null, payload); await tick(); },
    async waitForCalls(count) {
      await ready;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (calls.length >= count) return;
        await tick();
      }
      throw new Error(`Expected ${count} SDK calls, observed ${calls.length}`);
    }
  };
}

function currentText(call) {
  const content = call.messages.at(-1).content;
  return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}
function imageUrl(call) {
  const content = call.messages.at(-1).content;
  return Array.isArray(content) ? content.find(part => part.type === 'image_url')?.image_url.url : null;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

module.exports = { createInterviewRuntime, defaultChunks, currentText, imageUrl, deferred };
