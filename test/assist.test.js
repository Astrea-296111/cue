'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { QuestionResolver } = require('../src/question-resolver');
const { isLikelyFollowUp } = require('../src/project-query');
const root = path.resolve(__dirname, '..');

// Actual package entry, bootstrap, question/memory routing and LLM adapter;
// replace the OS display and SDK transport, and inspect final multimodal messages.
function runtime(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-assist-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks: [] }));
  const ipc = new EventEmitter();
  ipc.handle = () => {};
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  app.getPath = () => temp;
  app.commandLine = { appendSwitch() {} };
  const calls = [], searches = [], events = [], loaded = [], cache = new Map();
  let answer = '测试答案';
  const shortcuts = new Map(), pendingShortcuts = [];
  let captures = 0;
  const settings = { provider: 'custom', baseUrl: 'https://example.invalid/v1', apiKeys: {},
    models: { custom: { fast: 'test-model' } }, smart: false, realtimeAnswerMode: 'standard', resumeText: '', ...options.settings };
  class OpenAI {
    constructor() {
      this.chat = { completions: { create: async args => {
        calls.push(JSON.parse(JSON.stringify(args)));
        const text = answer;
        return (async function* () { yield { choices: [{ delta: { content: text }, finish_reason: 'stop' }] }; })();
      } } };
    }
  }
  const mocks = {
    electron: { app, ipcMain: ipc, BrowserWindow: { getAllWindows: () => [window] }, globalShortcut: { unregister: key => shortcuts.delete(key), register: (key, fn) => { shortcuts.set(key, fn); return true; } }, dialog: {} },
    openai: OpenAI,
    'src/store.js': { getSettings: () => settings },
    'src/screen.js': { captureScreenshot: async () => { captures++; if (options.screenError) throw Error('capture failed'); return 'data:image/png;base64,' + Buffer.from('screen-' + captures).toString('base64'); } },
    'src/stt.js': {}, 'src/stt-streaming.js': {}, 'src/resume.js': {}, 'src/applink.js': { recordEvent() {} },
    'src/whisper-model-manager.js': {}, 'src/whisper-model-catalog.js': {},
    'src/whisper-runtime.js': {}, 'src/local-whisper-transcriber.js': {}
  };
  const shim = { _resolveFilename: (id, parent) => createRequire(parent.filename).resolve(id) };
  function load(file) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (Object.hasOwn(mocks, relative)) return mocks[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {}, filename: file };
    cache.set(file, module);
    loaded.push(relative);
    const context = vm.createContext({ module, exports: module.exports, __filename: file, __dirname: path.dirname(file),
      require: id => shim._load(id, module), process, Buffer, URL, Headers, AbortController, AbortSignal, performance,
      setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
      console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    module.context = context;
    if (relative === 'src/project-knowledge.js') {
      for (const method of ['searchProjectKnowledge', 'prefetchProjectKnowledge', 'getProjectOverviewChunks', 'getProjectProfileContext']) {
        const original = module.exports[method];
        module.exports[method] = function (...args) {
          const options = method === 'getProjectOverviewChunks' ? args[0] : args[1];
          const result = original.apply(this, args);
          searches.push({ method, scopes: options?.scopes ? Array.from(options.scopes) : null,
            paths: Array.isArray(result) ? result.map(item => item.path) : [] });
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
  const entry = load(path.join(root, require('../package.json').main));
  const context = cache.get(path.join(root, 'main.js')).context;
  const window = { isDestroyed: () => false, webContents: {
    getURL: () => 'file://' + root + '/renderer/index.html',
    send(channel, data) {
      events.push({ channel, ...data });
      if (channel === 'shortcut:mode') pendingShortcuts.push(submit(data.mode));
    }
  } };
  context.__window = window;
  entry.installShortcutOverrides();
  async function submit(mode, text = '') {
    for (const listener of ipc.listeners('ask')) await listener(null, { mode, text });
  }
  vm.runInContext('win = __window', context);
  const value = expression => vm.runInContext(expression, context);
  let seq = 0;
  return {
    calls, searches, events, loaded, value,
    answer(text) { answer = text; },
    final(text) {
      Object.assign(context, { __text: text, __seq: ++seq });
      value("publishTranscript('them', __text, { sourceId: 'test', utteranceKey: 'u' + __seq, utteranceOrder: __seq })");
    },
    ask: (mode = 'assist', text = '') => submit(mode, text),
    async shortcut(key) {
      assert.ok(shortcuts.has(key), 'shortcut must be registered');
      shortcuts.get(key)();
      await Promise.all(pendingShortcuts.splice(0));
    },
    get captures() { return captures; },
    async prefetch(payload) {
      ipc.emit('project:prefetch', null, payload);
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}


function current(call) { return call.messages.at(-1).content; }
function text(call) { return current(call).find(part => part.type === 'text').text; }
function image(call) { return current(call).find(part => part.type === 'image_url').image_url.url; }

for (const instruction of ['改成迭代法实现', '把这个方法改为迭代实现', '不要用递归，改用栈实现', '保留原接口，添加空树判断', '请修改这个函数，添加空树判断', '添加判空', '那请改成迭代法实现']) {
  test(`complete code instruction is selectable and continues the task: ${instruction}`, () => {
    const resolver = new QuestionResolver();
    resolver.observe({ channel: 'them', text: instruction }, true);
    assert.equal(resolver.resolveForSubmit().text, instruction.normalize('NFKC').replace(/，/g, ','));
    assert.equal(isLikelyFollowUp(instruction), true);
  });
}

test('Assist works on the current screen even before any question is recognized', async t => {
  const app = runtime(t);
  await app.ask();
  assert.equal(app.calls.length, 1);
  assert.equal(app.captures, 1);
  assert.ok(image(app.calls[0]));
  assert.match(text(app.calls[0]), /本次截图/);
  assert.match(app.calls[0].messages[0].content, /当前屏幕中的代码是修改基准/);
  assert.doesNotMatch(text(app.calls[0]), /用3~5句/);
  assert.equal(app.calls[0].max_tokens, 4096);
});

test('recursive traversal followed by iterative requirement sends the latest screen plus task context', async t => {
  const app = runtime(t);
  app.final('如何用 Java 实现二叉树的中序递归遍历？');
  await app.ask('say');
  assert.equal(app.captures, 0);
  app.final('改成迭代法实现');
  await app.ask();
  assert.equal(app.calls.length, 2);
  const request = app.calls[1];
  assert.match(text(request), /改成迭代法实现/);
  assert.match(JSON.stringify(request.messages), /Java.*中序/);
  assert.match(request.messages[0].content, /保留仍适用的输入输出、遍历顺序和边界约束/);
  assert.match(request.messages[0].content, /给出修改后的代码或完整受影响的方法/);
  assert.match(request.messages[0].content, /历史助手代码不能覆盖当前屏幕代码/);
  assert.match(request.messages[0].content, /沿用屏幕中的编程语言、接口和数据结构/);
  assert.equal(request.messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(app.captures, 1);
});

test('repeated Assist recaptures screen and keeps confirmed requirement instead of an unfinished tail', async t => {
  const app = runtime(t);
  app.final('改成迭代法实现');
  await app.ask();
  app.final('如果平');
  await app.ask();
  assert.equal(app.calls.length, 2);
  assert.equal(app.captures, 2);
  assert.notEqual(image(app.calls[0]), image(app.calls[1]));
  assert.match(text(app.calls[1]), /改成迭代法实现/);
  assert.doesNotMatch(JSON.stringify(app.calls[1].messages), /如果平/);
});

test('a question about screen code replaces the previous edit target', async t => {
  const app = runtime(t);
  app.final('改成迭代法实现');
  await app.ask();
  app.final('这段代码时间复杂度是多少？');
  await app.ask();
  assert.equal(app.calls.length, 2);
  assert.equal(app.captures, 2);
  assert.match(text(app.calls[1]), /这段代码时间复杂度是多少/);
  assert.doesNotMatch(text(app.calls[1]), /当前轮面试官提问[^]*改成迭代法实现/);
  assert.match(app.calls[1].messages[0].content, /解释代码、分析复杂度时直接回答/);
  assert.notEqual(image(app.calls[0]), image(app.calls[1]));
});

test('screen-only Assist excludes unconfirmed speech and reset removes previous requirements', async t => {
  const app = runtime(t);
  app.final('如果平');
  await app.ask();
  assert.equal(app.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(app.calls[0].messages), /如果平/);
  app.final('改成迭代法实现');
  await app.ask();
  app.value('conversation.reset(); questionResolver.reset(); transcript.length = 0');
  await app.ask();
  assert.equal(app.calls.length, 3);
  assert.doesNotMatch(text(app.calls[2]), /改成迭代法实现/);
  assert.equal(app.calls[2].messages.filter(m => m.role === 'assistant').length, 0);
});

test('Ctrl+Shift+Enter, Ctrl+? and the Assist mode use the same multimodal request', async t => {
  const app = runtime(t);
  app.final('改成迭代法实现');
  await app.shortcut('CommandOrControl+Shift+Return');
  await app.shortcut('CommandOrControl+Shift+/');
  await app.ask('assist');
  assert.equal(app.calls.length, 3);
  assert.equal(app.captures, 3);
  for (const call of app.calls) {
    assert.match(text(call), /改成迭代法实现/);
    assert.ok(image(call));
  }
});

test('Ctrl+Enter remains the speech-only answer shortcut', async t => {
  const app = runtime(t);
  app.final('为什么用 Function Call？');
  await app.shortcut('CommandOrControl+Return');
  assert.equal(app.calls.length, 1);
  assert.equal(app.captures, 0);
  assert.equal(typeof app.calls[0].messages.at(-1).content, 'string');
});

test('Assist capture failure cannot fall back to an old screenshot or send a model request', async t => {
  const app = runtime(t, { screenError: true });
  app.final('改成迭代法实现');
  await app.ask();
  assert.equal(app.calls.length, 0);
  assert.equal(app.captures, 1);
  assert.match(app.events.find(e => e.channel === 'llm:error').message, /截图失败/);
});

test('manual say leaves an incomplete new target in preview without requesting a model', async t => {
  const app = runtime(t);
  app.final('如果平');
  await app.shortcut('CommandOrControl+Return');
  assert.equal(app.calls.length, 0);
  assert.equal(app.captures, 0);
  assert.equal(app.value('conversation.recent.length'), 0);
  assert.ok(app.events.some(event => event.channel === 'status' && /新的回答目标|尚未识别完整/.test(event.message)));
});

test('manual say with no speech shows no target and does not request an invented question', async t => {
  const app = runtime(t);
  await app.ask('say');
  assert.equal(app.calls.length, 0);
  assert.ok(app.events.some(event => event.channel === 'status' && /没有新的回答目标/.test(event.message)));
  assert.equal(app.value('conversation.recent.length'), 0);
});

test('long interviewer setup and all constraints reach the final SDK messages', async t => {
  const app = runtime(t);
  for (const part of ['假设我们有一个订单服务,用 Redis 缓存库存。', '数据库是唯一事实来源,请求允许重试。', '要求不能超卖,并且不能丢订单。', '如何设计库存扣减？怎么保证幂等？']) app.final(part);
  await app.ask('say');
  const request = app.calls[0];
  const current = request.messages.at(-1).content;
  for (const constraint of ['Redis', '唯一事实来源', '请求允许重试', '不能超卖', '不能丢订单', '库存扣减', '幂等']) assert.ok(current.includes(constraint), constraint);
  assert.match(current, /这是复杂问题/);
  assert.equal(request.max_tokens, 1000);
  assert.match(request.messages[0].content, /背景只用于理解当前目标/);
});

test('longer same-project follow-up preserves multiple relevant rounds but generic questions get no history', async t => {
  const app = runtime(t);
  for (const question of ['如何用 Java 实现二叉树的中序递归遍历？', '这个接口的入参不能改变,怎么保留方法签名？', '如果输入空树,应该怎么处理？', '这个实现改成迭代法,怎么保留前面的限制？']) {
    app.final(question);
    await app.ask('say');
  }
  const last = app.calls[3];
  assert.equal(last.messages.filter(m => m.role === 'assistant').length, 3);
  assert.match(JSON.stringify(last.messages), /中序递归遍历/);
  assert.match(JSON.stringify(last.messages), /方法签名/);
  app.final('什么是 TCP 三次握手？');
  await app.ask('say');
  assert.equal(app.calls[4].messages.filter(m => m.role === 'assistant').length, 0);
  assert.doesNotMatch(app.calls[4].messages.at(-1).content, /二叉树|方法签名/);
});
