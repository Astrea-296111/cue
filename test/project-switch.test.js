'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { ConversationMemory } = require('../src/conversation-memory');
const { planProjectRetrieval } = require('../src/project-query');
const { ProjectSearch } = require('../src/project-search');

const root = path.resolve(__dirname, '..');
const catalog = [
  { name: 'TCS', prefix: 'TCS/', aliases: ['TCS'] },
  { name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] },
  { name: 'FlashFlow', prefix: 'FlashFlow/', aliases: ['FlashFlow'] }
];
const switchQuestion = '关于第二个，你的agent项目。这个项目最难的地方是在哪里？';
const tcsAnswer = '最大的困难是对抗平台压缩，微信和 Facebook 会二次压缩 JPEG 图片，影响 TCS 恢复率。';
const repoAnswer = 'RepoPilot 的困难是 Agent Loop / LangGraph 双运行时一致性和工具验证闭环。';
const turn = text => [{ channel: 'them', text }];
const chunks = [
  { path: 'TCS/README.md', startLine: 1, endLine: 3, text: 'TCS_ONLY 项目最难的地方是平台压缩、微信和 Facebook 的 JPEG 图片恢复率。' },
  { path: 'RepoPilot/README.md', startLine: 1, endLine: 3, text: 'REPO_ONLY RepoPilot agent 项目最难的是 Agent Loop / LangGraph 双运行时一致性，AST BM25 FAISS RRF 检索和工具验证闭环。' },
  { path: 'FlashFlow/README.md', startLine: 1, endLine: 2, text: 'FLASH_ONLY FlashFlow 库存项目，Redis 与任务重试。' }
];

function memoryAtTCS() {
  const memory = new ConversationMemory();
  const request = memory.begin({ mode: 'say', question: '介绍第一个项目 TCS？', catalog });
  memory.commit(request, tcsAnswer);
  return memory;
}

for (const question of [switchQuestion, '关于第二个，你的 agent 项目。这个项目最难在哪里？', '你的第二个 Agent 项目有什么难点？', '讲讲第二个项目的难点？', 'RepoPilot 这个项目最难在哪里？']) {
  test(`explicit project identity precedes referential wording: ${question}`, () => {
    const previous = planProjectRetrieval(turn('介绍第一个项目 TCS？'), 'say', { catalog });
    const plan = planProjectRetrieval(turn(question), 'say', { previousPlan: previous, catalog });
    assert.deepEqual(plan.scopes, ['RepoPilot/']);
    assert.deepEqual(plan.activeProject.scopes, ['RepoPilot/']);
    assert.deepEqual(plan.previousProject.scopes, ['TCS/']);
    assert.equal(plan.projectSwitched, true);
  });
}

test('project switch has zero history even with a large configured budget; same-project follow-up is not a switch', () => {
  const memory = memoryAtTCS();
  let request = memory.begin({ mode: 'say', question: '在这个过程中，你遇到的最大困难是什么？你是怎么解决的？', catalog });
  assert.deepEqual(request.plan.scopes, ['TCS/']);
  assert.equal(request.plan.projectSwitched, false);
  memory.commit(request, tcsAnswer);
  request = memory.begin({ mode: 'say', question: switchQuestion, catalog, settings: { conversationContextChars: 48000 } });
  assert.equal(request.policy, 'project-switch');
  assert.deepEqual(request.turns, []);
  assert.equal(request.memory, '');
  assert.equal(request.stats.historyChars, 0);
  assert.equal(memory.recent.length, 2, 'isolation must not globally delete history');
  memory.commit(request, repoAnswer);
  const next = memory.begin({ mode: 'say', question: '这个项目的验证闭环为什么这样设计？', catalog });
  assert.equal(next.plan.projectSwitched, false);
  assert.deepEqual(next.plan.scopes, ['RepoPilot/']);
  assert.equal(next.turns.filter(t => t.role === 'assistant').length, 1);
  assert.equal(next.turns[1].text, repoAnswer);
  assert.doesNotMatch(JSON.stringify(next), /二次压缩/);
});

test('referential project recall filters archived answers from other projects', () => {
  const memory = memoryAtTCS();
  for (let i = 0; i < 25; i++) {
    const request = memory.begin({ mode: 'say', question: `这个 TCS 项目第${i}个难点是什么？`, catalog });
    memory.commit(request, tcsAnswer);
  }
  const switched = memory.begin({ mode: 'say', question: switchQuestion, catalog });
  memory.commit(switched, repoAnswer);
  const request = memory.begin({ mode: 'say', question: '这个项目最难的地方，继续展开一下？', catalog });
  assert.ok(memory.archive.length > 0);
  assert.doesNotMatch(JSON.stringify({ turns: request.turns, memory: request.memory }), /平台压缩|Facebook/);
  assert.match(JSON.stringify(request.turns), /LangGraph/);
});

test('generic Redis interlude preserves RepoPilot for an explicit return', () => {
  const memory = memoryAtTCS();
  const switched = memory.begin({ mode: 'say', question: switchQuestion, catalog });
  memory.commit(switched, repoAnswer);
  const generic = memory.begin({ mode: 'say', question: 'Redis 为什么快？', catalog });
  assert.equal(generic.plan.retrieve, false);
  assert.equal(generic.policy, 'independent');
  assert.deepEqual(generic.plan.activeProject.scopes, ['RepoPilot/']);
  memory.commit(generic, 'Redis 使用内存和高效数据结构。');
  const returned = memory.begin({ mode: 'say', question: '回到刚才那个项目，你为什么用 LangGraph？', catalog });
  assert.deepEqual(returned.plan.scopes, ['RepoPilot/']);
  assert.equal(returned.plan.projectSwitched, false);
  assert.doesNotMatch(JSON.stringify(returned.turns), /Redis 使用|平台压缩/);
});

test('ProjectSearch scope excludes other projects from lexical, dense and cached results', () => {
  const search = ProjectSearch.build(chunks);
  const query = '项目最难的地方 平台压缩 LangGraph';
  search.rank(query, ['TCS/']);
  for (let i = 0; i < 2; i++) {
    const ranked = search.rank(query, ['RepoPilot/']);
    assert.ok(ranked.rows.length > 0);
    assert.ok(ranked.rows.every(row => row.chunk.path.startsWith('RepoPilot/')));
  }
});

// Load the package entry and its real Module._load hooks, bugfix bootstrap,
// root main, question resolver, retrieval and LLM adapter. Only Electron/SDK
// transport and unrelated hardware adapters are mocked. Capture SDK messages.
function runtime(t, extraSettings = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-project-switch-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks }));
  const ipc = new EventEmitter();
  ipc.handle = () => {};
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  app.getPath = () => temp;
  app.commandLine = { appendSwitch() {} };
  const calls = [], searches = [], events = [], loaded = [], cache = new Map();
  let answer = tcsAnswer;
  const settings = { provider: 'custom', baseUrl: 'https://example.invalid/v1', apiKeys: {},
    models: { custom: { fast: 'test-model' } }, smart: false, resumeText: '', ...extraSettings };
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
    electron: { app, ipcMain: ipc, BrowserWindow: { getAllWindows: () => [] }, globalShortcut: {}, dialog: {} },
    openai: OpenAI,
    'src/store.js': { getSettings: () => settings },
    'src/screen.js': { captureScreenshot: async () => 'data:image/png;base64,AA==' },
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
  load(path.join(root, require('../package.json').main));
  const context = cache.get(path.join(root, 'main.js')).context;
  context.__window = { isDestroyed: () => false, webContents: { send: (channel, data) => events.push({ channel, ...data }) } };
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
    async ask(mode = 'say', text = '') {
      // Invoke the actual ordered IPC listeners, including custom-main's hook.
      for (const listener of ipc.listeners('ask')) await listener(null, { mode, text });
    },
    async prefetch(payload) {
      ipc.emit('project:prefetch', null, payload);
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

async function switchRuntime(app) {
  app.final('介绍第一个项目 TCS？');
  await app.ask();
  app.final('在这个过程中，你遇到的最大困难是什么？你是怎么解决的？');
  await app.ask();
  app.answer(repoAnswer);
  app.final(switchQuestion);
  await app.ask();
  assert.equal(app.calls.length, 3);
}

test('package entry sends clean RepoPilot SDK messages after TCS and keeps subsequent follow-up isolated', async t => {
  const app = runtime(t, { resumeText: '项目经历\n1. TCS\n' + 'TCS 简历平台压缩事实。'.repeat(180) +
    '\n2. RepoPilot\nREPO_RESUME Agent Loop / LangGraph 双运行时一致性。\n3. FlashFlow\nFLASH_RESUME 库存项目。',
    projectKnowledge: '# TCS\nTCS_MANUAL 平台压缩。\n# RepoPilot\nREPO_MANUAL LangGraph 工具验证。\n# FlashFlow\nFLASH_MANUAL 库存项目。' });
  await switchRuntime(app);
  assert.ok(app.loaded.includes('src/custom-main.js') && app.loaded.includes('src/bugfix-main.js') && app.loaded.includes('main.js'));
  assert.equal(app.loaded.includes('src/main.js'), false);
  assert.equal(app.value('conversation.recent[2].plan.projectSwitched'), true);
  const messages = app.calls[2].messages;
  assert.equal(messages.filter(m => m.role === 'assistant').length, 0);
  assert.doesNotMatch(JSON.stringify(messages), /二次压缩|TCS_ONLY|TCS_MANUAL|FLASH_RESUME|FLASH_MANUAL/);
  assert.match(messages[0].content, /REPO_ONLY/);
  assert.match(messages[0].content, /REPO_RESUME/);
  assert.match(messages[0].content, /REPO_MANUAL/);
  app.final('那为什么用了 LangGraph？');
  await app.ask();
  assert.match(app.calls[3].messages.find(m => m.role === 'assistant').content, /双运行时一致性/);
  assert.doesNotMatch(JSON.stringify(app.calls[3].messages), /二次压缩|TCS_ONLY/);
  assert.match(app.value('conversation.recent[3].plan.projectLabel'), /RepoPilot/);
});

test('real bootstrap has one scoped retrieval per request, and scoped prefetch never adds legacy evidence', async t => {
  const app = runtime(t);
  await switchRuntime(app);
  const scoped = Array.from(app.value('conversation.recent[2].plan.scopes'));
  assert.equal(scoped.length, 1);
  assert.match(app.value('conversation.recent[2].plan.projectLabel'), /RepoPilot/);
  const search = app.searches.filter(c => c.method === 'searchProjectKnowledge');
  assert.equal(search.length, 3, 'one authoritative Project RAG search per answer');
  assert.deepEqual(search[2].scopes, scoped);
  assert.ok(search[2].paths.length > 0);
  assert.ok(search[2].paths.every(p => p.startsWith('RepoPilot/')));
  await app.prefetch({ text: switchQuestion, previous: ['介绍 TCS 项目？'] });
  const prefetch = app.searches.find(c => c.method === 'prefetchProjectKnowledge');
  assert.deepEqual(prefetch.scopes, scoped);
  const count = app.searches.length;
  await app.prefetch({ text: 'Redis 为什么快？', previous: [switchQuestion] });
  assert.equal(app.searches.length, count, 'generic questions must not trigger project prefetch');
  await app.prefetch({ text: '这个项目最难在哪里？', previous: ['那为什么用了 LangGraph？'] });
  assert.equal(app.searches.length, count, 'ambiguous prefetch must not search all projects');
});

for (const mode of ['ask', 'answerThis', 'assist']) {
  test(`manual project switch uses the authoritative plan through ${mode}`, async t => {
    const app = runtime(t);
    await app.ask(mode, '介绍第一个项目 TCS？');
    app.answer(repoAnswer);
    await app.ask(mode, switchQuestion);
    assert.equal(app.calls.length, 2);
    assert.equal(app.value('conversation.recent[1].plan.projectSwitched'), true);
    assert.doesNotMatch(JSON.stringify(app.calls[1].messages), /二次压缩|TCS_ONLY/);
    assert.match(app.calls[1].messages[0].content, /REPO_ONLY/);
    assert.equal(app.searches.filter(c => c.method === 'searchProjectKnowledge').length, 2);
  });
}

test('runtime suspends RAG on Redis then returns to RepoPilot with clean messages', async t => {
  const app = runtime(t);
  await switchRuntime(app);
  const count = app.searches.length;
  app.answer('Redis 使用内存和高效数据结构。');
  app.final('Redis 为什么快？');
  await app.ask();
  assert.equal(app.searches.length, count);
  assert.equal(app.value('conversation.recent[3].plan.retrieve'), false);
  assert.match(app.value('conversation.activeProjectPlan.label'), /RepoPilot/);
  app.answer(repoAnswer);
  app.final('回到刚才那个项目，你为什么用 LangGraph？');
  await app.ask();
  assert.match(app.value('conversation.recent[4].plan.projectLabel'), /RepoPilot/);
  assert.doesNotMatch(JSON.stringify(app.calls[4].messages), /二次压缩|Redis 使用/);
});

for (const scenario of [
  { name: '如果平', speech: ['达到100%的恢复率是不是牺牲了什么？', '比如图片变得肉眼可见的模糊，或者需要发特别多张图。', '如果平'], expected: /100%.*恢复率/, excluded: /如果平/ },
  { name: 'ops after Function Call and React', speech: ['为什么用 Function Call？', '为什么用 React？', 'ops'], expected: /Function Call[\s\S]*React/, excluded: /\bops\b/i },
  { name: 'complete question plus unfinished tail', speech: ['项目是你独立完成的，还是团队合作？你具体负责哪一部分？在这个过程'], expected: /独立完成[\s\S]*负责/, excluded: /在这个过程/ }
]) {
  test(`unchanged QuestionResolver via package entry: ${scenario.name}`, async t => {
    const app = runtime(t);
    for (const text of scenario.speech) app.final(text);
    await app.ask();
    assert.equal(app.calls.length, 1);
    const current = app.calls[0].messages.at(-1).content;
    assert.match(current, scenario.expected);
    assert.doesNotMatch(current, scenario.excluded);
  });
}
