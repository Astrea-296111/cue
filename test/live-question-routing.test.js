'use strict';

// Integration regression tests for the real root main.js answer-target path.
// Electron/network are mocked, but publishTranscript -> QuestionResolver ->
// runFeature -> prompt assembly is the same code used by the application.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (Object.hasOwn(mocks, relative)) return mocks[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const nativeRequire = createRequire(file);
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.')) return load(nativeRequire.resolve(id));
      return nativeRequire(id);
    };
    const context = vm.createContext({
      require: localRequire,
      module,
      exports: module.exports,
      __dirname: path.dirname(file),
      __filename: file,
      process,
      Buffer,
      URL,
      Headers,
      AbortController,
      AbortSignal,
      performance,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    module.context = context;
    return module.exports;
  }
  return { load, context: (file) => cache.get(path.resolve(file)).context };
}

function appHarness(t, extraSettings = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-live-routing-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const handlers = new Map();
  const listeners = new Map();
  const events = [];
  const calls = [];
  const settings = {
    provider: 'custom',
    smart: false,
    resumeText: 'RepoPilot RAG BM25 FAISS RRF LangGraph MCP FastAPI SQLAlchemy Redis PostgreSQL',
    models: { custom: { fast: 'test-model' } },
    ...extraSettings
  };

  const fakeApp = {
    commandLine: { appendSwitch() {} },
    getPath: () => temp,
    whenReady: () => new Promise(() => {}),
    on() {}
  };

  const modules = loader({
    electron: {
      app: fakeApp,
      ipcMain: {
        handle: (name, fn) => handlers.set(name, fn),
        on: (name, fn) => listeners.set(name, fn)
      }
    },
    'src/store.js': { getSettings: () => settings },
    'src/screen.js': { captureScreenshot: async () => 'data:image/png;base64,AA==' },
    'src/llm.js': {
      createLLM: () => ({
        ready: true,
        async stream(args) {
          calls.push(args);
          args.onToken('测试回答');
          return '测试回答';
        }
      })
    },
    'src/stt.js': {},
    'src/stt-streaming.js': {},
    'src/resume.js': {},
    'src/applink.js': { recordEvent() {} },
    'src/whisper-model-manager.js': {},
    'src/whisper-model-catalog.js': {},
    'src/whisper-runtime.js': {},
    'src/local-whisper-transcriber.js': {}
  });

  modules.load(path.join(root, 'main.js'));
  const context = modules.context(path.join(root, 'main.js'));
  context.__testWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, data) => events.push({ channel, ...data }) }
  };
  vm.runInContext('win = __testWindow', context);

  let seq = 0;
  const invoke = (code, values = {}) => {
    Object.assign(context, values);
    return vm.runInContext(code, context);
  };

  return {
    calls,
    events,
    context,
    final(text) {
      seq++;
      invoke("publishTranscript('them', __text, { sourceId: 'test', utteranceKey: 'u' + __seq, utteranceOrder: __seq })", { __text: text, __seq: seq });
    },
    interim(text) {
      invoke("publishInterim('them', __text, { sourceId: 'test', utteranceKey: 'interim' })", { __text: text });
    },
    ask(mode = 'say', text = '') {
      return listeners.get('ask')(null, { mode, text });
    },
    value(expression) { return vm.runInContext(expression, context); }
  };
}

test('real main path answers stable question and excludes trailing interim fragment from prompt', async (t) => {
  const app = appHarness(t);
  app.final('达到100%的恢复率是不是牺牲了什么？');
  app.final('比如图片变得肉眼可见的模糊，或者需要发特别多张图。');
  app.interim('如果平');

  await app.ask('say');
  assert.equal(app.calls.length, 1);
  assert.equal(
    app.value('conversation.recent[0].question'),
    '达到100%的恢复率是不是牺牲了什么?\n比如图片变得肉眼可见的模糊,或者需要发特别多张图。'
  );
  const prompt = app.calls[0].turns.at(-1).text;
  assert.match(prompt, /达到100%的恢复率/);
  assert.match(prompt, /比如图片变得肉眼可见的模糊/);
  assert.doesNotMatch(prompt, /如果平/);
});

test('Ctrl+Enter does not call the model for an unanswerable new fragment or revive the old answer', async (t) => {
  const app = appHarness(t);
  app.final('为什么用 React 框架？');
  await app.ask('say');
  assert.equal(app.calls.length, 1);

  app.final('如果平');
  await app.ask('say');
  assert.equal(app.calls.length, 1, 'incomplete input must not request a fabricated answer');
  assert.ok(app.events.some(event => event.channel === 'status' && /没有新的回答目标|尚未识别完整/.test(event.message)));
});

test('ops noise never enters transcript or steals focus from consecutive questions', async (t) => {
  const app = appHarness(t);
  app.final('为什么用 Function Call？');
  app.final('为什么用 React 框架？');
  app.final('ops');
  await app.ask('say');

  assert.equal(app.calls.length, 1);
  const question = app.value('conversation.recent[0].question');
  assert.doesNotMatch(question, /Function Call/);
  assert.match(question, /React/);
  assert.doesNotMatch(question, /ops/i);
  assert.equal(app.value("transcript.some(t => /ops/i.test(t.text))"), false);
});

test('technical normalization is active on the real STT publication path', async (t) => {
  const app = appHarness(t);
  app.final('为什么用 red？');
  await app.ask('say');
  assert.equal(app.value('conversation.recent[0].question'), '为什么用 RAG?');
  assert.equal(app.value("transcript.at(-1).text"), '为什么用 RAG?');
});

test('a complete interim can still be answered before sentence_end for low latency', async (t) => {
  const app = appHarness(t);
  app.interim('为什么用 MCP？');
  await app.ask('say');
  assert.equal(app.calls.length, 1);
  assert.equal(app.value('conversation.recent[0].question'), '为什么用 MCP?');
});

test('real Ctrl+Enter path keeps TCS as active project across implicit follow-ups and trims same-final tail', async (t) => {
  const app = appHarness(t, {
    resumeText: [
      '第一个项目 TCS：阈值覆盖共享的鲁棒 JPEG 隐写框架，消息恢复率、MDS、多载体。',
      '第二个项目 RepoPilot：RAG、BM25、FAISS、LangGraph。'
    ].join('\n')
  });

  app.final('介绍一下第一个项目 TCS？');
  await app.ask('say');
  assert.deepEqual(Array.from(app.value('conversation.recent[0].plan.scopes')), ['TCS']);

  app.final('达到100%的恢复率是不是牺牲了什么？比如图片变得肉眼可见的模糊，或者需要发特别多张图。');
  await app.ask('say');
  assert.equal(app.value('conversation.recent[1].plan.reason'), 'active-project-followup');
  assert.deepEqual(Array.from(app.value('conversation.recent[1].plan.scopes')), ['TCS']);

  app.final('项目是你独立完成的，还是团队合作？你具体负责了哪一部分？在这个过程');
  await app.ask('say');
  assert.equal(app.value('conversation.recent[2].plan.reason'), 'active-project-followup');
  assert.deepEqual(Array.from(app.value('conversation.recent[2].plan.scopes')), ['TCS']);
  assert.equal(
    app.value('conversation.recent[2].question'),
    '项目是你独立完成的,还是团队合作?你具体负责了哪一部分?'
  );
  assert.doesNotMatch(app.calls[2].turns.at(-1).text, /在这个过程/);
  assert.equal(app.calls[2].turns.filter(turn => turn.role === 'assistant').length, 0,
    'project identity may continue without making the prior answer a task');
});
