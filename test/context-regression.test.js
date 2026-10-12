'use strict';

// Offline regression tests: real application request assembly, deterministic
// provider streams and temporary indexes. No API key/network/Electron needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { ConversationMemory, selectRelevantText } = require('../src/conversation-memory');
const { planProjectRetrieval, isLikelyFollowUp } = require('../src/project-query');
const { buildProjectCatalog } = require('../src/project-scope');
const { ProjectSearch } = require('../src/project-search');
const { shouldCaptureScreen } = require('../src/prompts');

const catalog = [
  { name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] },
  { name: 'FlashFlow', prefix: 'FlashFlow/', aliases: ['FlashFlow'] }
];

function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (Object.hasOwn(mocks, relative)) return mocks[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const nativeRequire = createRequire(file);
    const localRequire = id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.')) return load(nativeRequire.resolve(id));
      return nativeRequire(id);
    };
    const context = vm.createContext({ require: localRequire, module, exports: module.exports,
      __dirname: path.dirname(file), __filename: file, process, Buffer, URL, Headers,
      AbortController, AbortSignal, performance, setTimeout, clearTimeout, setInterval,
      clearInterval, setImmediate, console: { log() {}, warn() {}, error() {} }, ...globals });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    module.context = context;
    return module.exports;
  }
  return { load, context: file => cache.get(path.resolve(file)).context };
}

function appHarness(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-context-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const handlers = new Map(), listeners = new Map(), events = [], calls = [];
  const settings = { provider: 'custom', smart: false, models: { custom: { fast: 'qwen3.8-flash' } }, ...options.settings };
  let behavior = options.behavior || (async args => { args.onToken('测试回答'); return '测试回答'; });
  let captures = 0;
  const fakeApp = { commandLine: { appendSwitch() {} }, getPath: () => temp,
    whenReady: () => new Promise(() => {}), on() {} };
  const overrides = {
    electron: { app: fakeApp, ipcMain: { handle: (k, f) => handlers.set(k, f), on: (k, f) => listeners.set(k, f) } },
    'src/store.js': { getSettings: () => settings },
    'src/screen.js': { captureScreenshot: async () => { captures++; if (options.screenError) throw Error('screen failed'); return 'data:image/png;base64,AA=='; } },
    'src/llm.js': { createLLM: () => ({ ready: true, stream: args => { calls.push(args); return behavior(args); } }) },
    'src/stt.js': {}, 'src/stt-streaming.js': {}, 'src/resume.js': {},
    'src/applink.js': { recordEvent() {} }, 'src/whisper-model-manager.js': {},
    'src/whisper-model-catalog.js': {}, 'src/whisper-runtime.js': {}, 'src/local-whisper-transcriber.js': {}
  };
  const modules = loader(overrides, options.globals);
  modules.load(path.join(root, 'main.js'));
  const context = modules.context(path.join(root, 'main.js'));
  context.__testWindow = { isDestroyed: () => false, webContents: { send: (channel, data) => events.push({ channel, ...data }) } };
  vm.runInContext('win = __testWindow', context);
  return { calls, events, handlers, settings, modules, temp,
    ask: (text, mode = 'ask') => listeners.get('ask')(null, { mode, text }),
    clear: () => handlers.get('transcript:clear')(),
    behavior: fn => { behavior = fn; },
    value: expression => vm.runInContext(expression, context),
    speech: text => { context.__speech = text; vm.runInContext("pushTranscript({channel:'them',text:__speech,ts:Date.now()+1})", context); },
    get captures() { return captures; }
  };
}

test('user Redis regression: all four manual questions include actual earlier answers', async t => {
  const app = appHarness(t);
  const answers = ['String、Hash、List、Set、Zset。', '还有 Bitmap、HyperLogLog、Geo、Stream，以及其他扩展能力。',
    '除了五种基础类型，还可以讨论 Bitmap、HyperLogLog、Geo、Stream、Bitfield。', '下面展开这五项。'];
  app.behavior(async args => { const answer = answers[app.calls.length - 1]; args.onToken(answer); return answer; });
  for (const q of ['讲讲Redis的数据结构', '只有5种吗？', 'Redis数据结构只有5种吗？', '那你讲讲后5种']) await app.ask(q);
  assert.equal(app.calls[1].turns[0].text, '讲讲Redis的数据结构');
  assert.equal(app.calls[1].turns[1].role, 'assistant');
  assert.match(app.calls[1].turns[1].text, /Zset/);
  assert.match(app.calls[3].turns.filter(t => t.role === 'assistant').at(-1).text, /Bitmap.*Bitfield/);
  assert.equal(app.captures, 0);
  assert.equal(app.value('conversation.recent.length'), 4);
});

test('ask / answerThis / say / assist share one conversation', async t => {
  const app = appHarness(t);
  await app.ask('讲讲 RepoPilot 项目');
  await app.ask('为什么这样设计？', 'answerThis');
  await app.ask('再展开第二点', 'say');
  await app.ask('结合屏幕看看这个实现', 'assist');
  assert.equal(app.calls[3].turns.filter(t => t.role === 'assistant').length, 3);
  assert.equal(app.captures, 1);
});

test('failed and empty replies do not become memory', async t => {
  const app = appHarness(t);
  app.behavior(async args => { args.onToken('失败的半句'); throw Error('network'); });
  await app.ask('问题一');
  app.behavior(async () => '');
  await app.ask('问题二');
  assert.equal(app.value('conversation.recent.length'), 0);
  assert.equal(app.events.filter(e => e.channel === 'llm:error').length, 2);
  assert.equal(app.value('state.busy'), false);
});

test('clear aborts old generation; late tokens cannot enter a new conversation', async t => {
  const app = appHarness(t);
  let release;
  app.behavior(args => new Promise(resolve => { release = () => { args.onToken('旧请求迟到内容'); resolve('旧内容'); }; }));
  const old = app.ask('旧问题');
  await new Promise(setImmediate);
  const oldArgs = app.calls[0];
  app.clear();
  assert.equal(oldArgs.signal.aborted, true);
  app.behavior(async args => { args.onToken('新会话答案'); return '新会话答案'; });
  await app.ask('新问题');
  release(); await old;
  assert.equal(app.value('conversation.recent.length'), 1);
  assert.equal(app.value('conversation.recent[0].question'), '新问题');
  assert.equal(app.events.some(e => e.text === '旧请求迟到内容'), false);
  assert.equal(app.value('state.busy'), false);
});

test('new speech while waiting cannot replace the frozen request question', async t => {
  const app = appHarness(t);
  let release;
  app.behavior(args => new Promise(resolve => { release = () => { args.onToken('Redis答案'); resolve('Redis答案'); }; }));
  const pending = app.ask('Redis有几种类型');
  await new Promise(setImmediate);
  app.speech('Java线程有几种状态');
  release(); await pending;
  assert.equal(app.value('conversation.recent[0].question'), 'Redis有几种类型');
  assert.doesNotMatch(app.calls[0].turns.at(-1).text, /Java/);
});

test('manual say interrupts a running reply and only the new request commits', async t => {
  const app = appHarness(t);
  let release;
  app.behavior(args => new Promise(resolve => { release = () => { args.onToken('旧回答迟到片段'); resolve('旧回答'); }; }));
  const old = app.ask('Redis 的原理是什么？', 'say');
  await new Promise(setImmediate);
  const previous = app.calls[0];
  app.behavior(async args => { args.onToken('新的即时回答'); return '新的即时回答'; });
  await app.ask('TCP 的原理是什么？', 'say');
  assert.equal(previous.signal.aborted, true);
  release();
  await old;
  assert.equal(app.value('conversation.recent.length'), 1);
  assert.equal(app.value('conversation.recent[0].question'), 'TCP 的原理是什么？');
  assert.equal(app.events.some(e => e.text === '旧回答迟到片段'), false);
  assert.equal(app.value('state.busy'), false);
});

test('25s inactivity timer observes reasoning activity without displaying reasoning', async t => {
  const app = appHarness(t, { globals: {
    setTimeout: (fn, delay) => setTimeout(fn, delay === 25000 ? 40 : delay)
  } });
  app.behavior(async args => {
    for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 15)); args.onActivity(); }
    args.onToken('正文'); return '正文';
  });
  await app.ask('问题');
  assert.equal(app.events.some(e => e.channel === 'llm:error'), false);
  assert.equal(app.value('conversation.recent[0].answer'), '正文');
});

test('screen capture failure does not generate an answer using stale screen context', async t => {
  const app = appHarness(t, { screenError: true });
  await app.ask('解决屏幕题', 'leetcode');
  assert.equal(app.calls.length, 0);
  assert.equal(app.value('conversation.recent.length'), 0);
  assert.match(app.events.find(e => e.channel === 'llm:error').message, /截图失败/);
});

test('fresh screen task omits old dialogue, and its answer supports a later follow-up', async t => {
  const app = appHarness(t);
  await app.ask('旧的Java问题');
  await app.ask('', 'leetcode');
  assert.equal(app.calls[1].turns.length, 1);
  await app.ask('解释一下这段解法的复杂度');
  assert.equal(app.calls[2].turns.filter(t => t.role === 'assistant').length, 2);
});

test('deep project follow-ups survive over four turns, switch projects, and leave project mode', () => {
  const memory = new ConversationMemory();
  function turn(q) {
    const r = memory.begin({ mode: 'ask', question: q, catalog });
    memory.commit(r, '使用队列、重试和幂等键；尚未提供个人职责证据。');
    return r.plan;
  }
  assert.deepEqual(turn('介绍 RepoPilot 项目').scopes, ['RepoPilot/']);
  for (let i = 0; i < 30; i++) {
    const plan = turn(i % 2 ? '那里面如何保证幂等？' : '为什么这样设计？');
    assert.equal(plan.retrieve, true);
    assert.deepEqual(plan.scopes, ['RepoPilot/']);
  }
  assert.deepEqual(turn('再介绍 FlashFlow 项目').scopes, ['FlashFlow/']);
  assert.deepEqual(turn('那失败重试呢？').scopes, ['FlashFlow/']);
  assert.equal(turn('那讲讲Redis数据结构').retrieve, false);
  assert.equal(turn('只有五种吗？').retrieve, false);
  assert.deepEqual(turn('回到 RepoPilot，刚才的重试如何实现？').scopes, ['RepoPilot/']);
});

test('unanswered live topic change prevents carrying stale project scope', () => {
  const previousPlan = planProjectRetrieval([{ channel: 'them', text: '介绍 RepoPilot 项目' }], 'say', { catalog });
  const plan = planProjectRetrieval([
    { channel: 'them', text: '讲讲Redis数据结构' }, { channel: 'them', text: '只有五种吗？' }
  ], 'say', { previousPlan, catalog });
  assert.equal(plan.retrieve, false);
});

test('ordinary subject anchor survives a long pronoun-only follow-up chain', () => {
  const memory = new ConversationMemory();
  let r = memory.begin({ mode: 'ask', question: '讲讲Redis的数据结构' });
  memory.commit(r, '五种基础类型，还有扩展能力。');
  for (let i = 0; i < 30; i++) {
    r = memory.begin({ mode: 'ask', question: '那为什么这样？' });
    memory.commit(r, '与实现和空间开销有关。');
  }
  assert.equal(r.plan.anchor, '讲讲Redis的数据结构');
  assert.equal(r.plan.retrieve, false);
  assert.match(r.memory, /Redis/);
});

test('consumed old spoken topic does not override a manual follow-up', async t => {
  const app = appHarness(t);
  app.speech('Java线程有几种状态');
  // The test speech helper simulates one tick in the future.
  await new Promise(r => setTimeout(r, 3));
  await app.ask('讲讲Redis的数据结构');
  await app.ask('只有5种吗？');
  assert.doesNotMatch(app.calls[1].turns.at(-1).text, /Java/);
  assert.match(app.calls[1].turns[0].text, /Redis/);
});

test('recap still receives the whole retained speech transcript', async t => {
  const app = appHarness(t);
  app.speech('早期面试官问题：谈谈Java线程');
  await new Promise(r => setTimeout(r, 3));
  await app.ask('讲讲Redis');
  await app.ask('', 'recap');
  assert.match(app.calls[1].turns.at(-1).text, /早期面试官问题/);
  assert.match(app.calls[1].system, /不能当作候选人实际说过/);
  assert.equal(app.value('conversation.recent.length'), 1);
});

test('specific project follow-up retrieves the code for the retained project', async t => {
  const app = appHarness(t);
  const chunks = [
    { path: 'RepoPilot/README.md', startLine: 1, endLine: 2, text: 'RepoPilot 项目 architecture retry 幂等 重试 队列' },
    { path: 'RepoPilot/RetryWorker.java', startLine: 1, endLine: 3, text: 'retry 重试 幂等 idempotency 实现：用 uniqueRequestId 去重。' },
    { path: 'FlashFlow/README.md', startLine: 1, endLine: 2, text: 'FlashFlow 项目 architecture retry 幂等 重试' },
    { path: 'FlashFlow/RetryWorker.java', startLine: 1, endLine: 3, text: 'retry 重试 幂等 idempotency 实现：使用 otherProjectKey。' }
  ];
  fs.writeFileSync(path.join(app.temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks }));
  await app.ask('介绍 RepoPilot 项目');
  await app.ask('那重试幂等怎么实现？');
  assert.match(app.calls[1].system, /uniqueRequestId/);
  assert.doesNotMatch(app.calls[1].system, /otherProjectKey/);
});

test('an explicit generic technical question leaves project scope even when short', () => {
  const previousPlan = planProjectRetrieval([{ channel: 'them', text: '介绍 RepoPilot 项目' }], 'say', { catalog });
  const plan = planProjectRetrieval([{ channel: 'them', text: 'Redis支持哪些类型？' }], 'say', { previousPlan, catalog });
  assert.equal(plan.retrieve, false);
});

test('long sessions stay bounded and recall an early project fact excerpt', () => {
  const memory = new ConversationMemory();
  let r = memory.begin({ mode: 'ask', question: 'RepoPilot 的压测环境是什么？', catalog });
  memory.commit(r, '用户材料写明：压测环境为 SAMPLE-ENV-42，仅限该环境结果。');
  for (let i = 0; i < 65; i++) {
    r = memory.begin({ mode: 'ask', question: `讲讲技术问题${i}`, catalog });
    memory.commit(r, '技术解释。'.repeat(450));
  }
  r = memory.begin({ mode: 'ask', question: '回到 RepoPilot，压测环境是什么？', catalog });
  assert.equal(memory.recent.length, 24);
  assert.equal(memory.archive.length, 42);
  assert.ok(r.stats.historyChars <= r.stats.budget);
  assert.match(r.memory, /SAMPLE-ENV-42/);
  assert.ok(r.turns.length <= 24);
  assert.match(r.memory, /助手旧答案不是项目事实/);
  memory.reset();
  assert.equal(memory.commit(r, '迟到结果'), false);
  assert.equal(memory.archive.length, 0);
});

test('oversized last answer has a visible excerpt marker and still respects budget', () => {
  const memory = new ConversationMemory();
  const r = memory.begin({ mode: 'ask', question: '问题' });
  memory.commit(r, '开头'.repeat(30000) + '最后一项');
  const next = memory.begin({ mode: 'ask', question: '最后一项呢？', settings: { conversationContextChars: 4000 } });
  assert.ok(next.stats.historyChars <= 4000);
  assert.match(next.turns[1].text, /历史摘录/);
  assert.match(next.turns[1].text, /最后一项/);
});

test('actual candidate speech remains separate from generated assistant answers', () => {
  const memory = new ConversationMemory();
  const r = memory.begin({ mode: 'ask', question: '讲讲你的项目职责',
    transcript: [{ channel: 'you', text: '我负责FlashFlow的调度模块，其他模块是同事负责。', ts: Date.now() }] });
  memory.commit(r, '可以从调度流程讲起。');
  const next = memory.begin({ mode: 'ask', question: '那其他模块呢？' });
  assert.match(next.turns[0].text, /实际发言.*\n我负责FlashFlow/);
  assert.equal(next.turns[1].text, '可以从调度流程讲起。');
  assert.ok(next.stats.historyChars <= next.stats.budget);
});

test('project scope is applied before the ranking top-60 cut-off', () => {
  const chunks = Array.from({ length: 80 }, (_, i) => ({ path: `FlashFlow/Retry${i}.java`, text: 'retry 幂等 重试 retry', startLine: 1, endLine: 2 }));
  chunks.push({ path: 'RepoPilot/Worker.java', text: 'retry 重试', startLine: 1, endLine: 2 });
  const search = ProjectSearch.build(chunks);
  const scoped = search.rank('retry 重试', ['RepoPilot/']);
  assert.equal(scoped.rows.length, 1);
  assert.equal(scoped.rows[0].chunk.path, 'RepoPilot/Worker.java');
  assert.equal(search.rank('retry 重试', ['FlashFlow/']).rows.some(r => r.chunk.path.startsWith('RepoPilot')), false);
});

test('existing v1 indexes derive project boundaries without migration', () => {
  const projects = buildProjectCatalog({ version: 1, sourceName: 'projects.zip', chunks: [
    { path: 'RepoPilot/README.md' }, { path: 'RepoPilot/backend/pom.xml' },
    { path: 'FlashFlow/README.md' }, { path: 'docs/README.md' }
  ] });
  assert.deepEqual(projects.map(p => p.prefix).sort(), ['FlashFlow/', 'RepoPilot/']);
  assert.equal(planProjectRetrieval([{ channel: 'them', text: 'RepoPilotExtra 是什么' }], 'ask', { catalog }).retrieve, false);
});

test('real imported index: overview fallback and retrieval remain inside selected project', async t => {
  const app = appHarness(t);
  const chunks = [
    { path: 'RepoPilot/README.md', startLine: 1, endLine: 2, text: 'RepoPilot uses local BM25 retrieval and retry jobs.' },
    { path: 'FlashFlow/README.md', startLine: 1, endLine: 2, text: 'FlashFlow uses workflow retries and an idempotency key.' }
  ];
  fs.writeFileSync(path.join(app.temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks }));
  const knowledge = app.modules.load(path.join(root, 'src/project-knowledge.js'));
  assert.equal(knowledge.getProjectCatalog().length, 2);
  const rows = knowledge.getProjectOverviewChunks({ scopes: ['RepoPilot/'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, 'RepoPilot/README.md');
  await app.ask('介绍 RepoPilot 项目');
  assert.match(app.calls[0].system, /RepoPilot\/README/);
  assert.doesNotMatch(app.calls[0].system, /FlashFlow\/README/);
});

test('manual project notes can recall relevant material after the old prefix cutoff', () => {
  const text = ('无关项目的常规说明。\n\n').repeat(900) + '\n\nFlashFlow 采用租约续期机制，租约期限为用户材料指定的值。';
  const selected = selectRelevantText(text, 'FlashFlow 租约续期', 1800);
  assert.match(selected, /FlashFlow.*租约续期/);
  assert.ok(selected.length <= 1800);
});

test('short follow-ups and explicit screenshots have consistent routing', () => {
  for (const text of ['只有5种吗？', '那你讲讲后5种', '第二点展开说', '为什么这样做？']) assert.equal(isLikelyFollowUp(text), true);
  assert.equal(shouldCaptureScreen('ask', '只有5种吗？'), false);
  assert.equal(shouldCaptureScreen('ask', '分析屏幕上的代码'), true);
  assert.equal(shouldCaptureScreen('leetcode'), true);
});

test('OpenAI-compatible adapter preserves history roles, hides reasoning, and forwards abort signal', async () => {
  let sent, requestOptions, activity = 0;
  class OpenAI {
    constructor() { this.chat = { completions: { create: async (body, options) => {
      sent = body; requestOptions = options;
      return (async function* () {
        yield { choices: [{ delta: { reasoning_content: '不应出现在答案中的原始思考' } }] };
        yield { choices: [{ delta: { content: '正确正文' }, finish_reason: 'stop' }] };
      })();
    } } }; }
  }
  const modules = loader({ openai: OpenAI });
  const llm = modules.load(path.join(root, 'src/llm.js')).createLLM({ provider: 'custom', apiKeys: { custom: 'test-only' },
    baseUrl: 'https://example.invalid/v1', models: { custom: { fast: 'qwen3.8-flash' } } });
  const controller = new AbortController();
  let output = '';
  await llm.stream({ system: '规则', turns: [{ role: 'user', text: '旧问题' }, { role: 'assistant', text: '旧答案' }, { role: 'user', text: '追问' }],
    imageDataUrl: 'data:image/png;base64,AA==', signal: controller.signal,
    onToken: t => { output += t; }, onActivity: () => activity++ });
  assert.equal(sent.messages[2].role, 'assistant');
  assert.equal(typeof sent.messages[1].content, 'string');
  assert.equal(sent.messages.at(-1).content[1].type, 'image_url');
  assert.equal(output, '正确正文');
  assert.equal(activity, 2);
  assert.equal(requestOptions.signal, controller.signal);
});

test('active project identity survives implicit TCS drill-downs and scopes responsibility follow-up to TCS', () => {
  const memory = new ConversationMemory();
  const projectCatalog = [
    { name: 'TCS', prefix: 'TCS/', aliases: ['TCS', '阈值覆盖共享'] },
    { name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] }
  ];
  const turn = (question) => {
    const request = memory.begin({ mode: 'say', question, catalog: projectCatalog });
    memory.commit(request, '测试回答');
    return request;
  };

  let request = turn('介绍一下第一个项目 TCS');
  assert.deepEqual(request.plan.scopes, ['TCS/']);

  request = turn('达到100%的恢复率是不是牺牲了什么？比如图片变模糊或者需要发特别多张图。');
  assert.equal(request.plan.reason, 'active-project-followup');
  assert.deepEqual(request.plan.scopes, ['TCS/']);
  assert.equal(request.policy, 'followup');

  request = turn('项目是你独立完成的，还是团队合作？你具体负责了哪一部分？');
  assert.equal(request.plan.reason, 'active-project-followup');
  assert.deepEqual(request.plan.scopes, ['TCS/']);
  assert.equal(request.policy, 'followup');
  assert.ok(request.turns.some(turn => turn.role === 'assistant'), 'one recent answer should be retained for project continuity');
});

test('generic technical interlude suspends active project without erasing it, and explicit return resumes it', () => {
  const memory = new ConversationMemory();
  const projectCatalog = [
    { name: 'TCS', prefix: 'TCS/', aliases: ['TCS', '阈值覆盖共享'] },
    { name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] }
  ];
  const turn = (question) => {
    const request = memory.begin({ mode: 'say', question, catalog: projectCatalog });
    memory.commit(request, '测试回答');
    return request;
  };

  assert.deepEqual(turn('介绍一下第一个项目 TCS').plan.scopes, ['TCS/']);
  let request = turn('Redis支持哪些数据类型？');
  assert.equal(request.plan.retrieve, false);
  assert.equal(request.plan.projectActive, false);
  assert.equal(request.policy, 'independent');

  request = turn('只有五种吗？');
  assert.equal(request.plan.retrieve, false, 'pronoun follow-up must stay on Redis instead of reviving TCS');

  request = turn('回到刚才那个项目，你具体负责哪一部分？');
  assert.equal(request.plan.retrieve, true);
  assert.deepEqual(request.plan.scopes, ['TCS/']);
});

test('explicit second project switches active scope away from TCS', () => {
  const memory = new ConversationMemory();
  const projectCatalog = [
    { name: 'TCS', prefix: 'TCS/', aliases: ['TCS', '阈值覆盖共享'] },
    { name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] }
  ];
  const first = memory.begin({ mode: 'say', question: '介绍一下第一个项目', catalog: projectCatalog });
  memory.commit(first, 'TCS 回答');
  const second = memory.begin({ mode: 'say', question: '再讲讲第二个项目 RepoPilot', catalog: projectCatalog });
  memory.commit(second, 'RepoPilot 回答');
  const followup = memory.begin({ mode: 'say', question: '这个项目里你具体负责什么？', catalog: projectCatalog });
  assert.deepEqual(followup.plan.scopes, ['RepoPilot/']);
});

test('real retrieval stays inside TCS for the recovery-rate and responsibility follow-up chain', async t => {
  const app = appHarness(t, { settings: {
    resumeText: '第一个项目 TCS 阈值覆盖共享 JPEG 隐写；第二个项目 RepoPilot Coding Agent。'
  }});
  const chunks = [
    { path: 'TCS/README.md', startLine: 1, endLine: 3, text: 'TCS_ONLY：恢复率、图片失真、多载体；职责是 TCS 算法设计与平台验证。' },
    { path: 'RepoPilot/README.md', startLine: 1, endLine: 3, text: 'REPOPILOT_ONLY：团队协作，负责 RAG、BM25、FAISS 和 Agent Loop。' }
  ];
  fs.writeFileSync(path.join(app.temp, 'cue-project-index-v1.json'), JSON.stringify({ version: 1, sourceName: 'projects', chunks }));

  await app.ask('介绍一下第一个项目 TCS');
  await app.ask('达到100%的恢复率是不是牺牲了什么？比如图片变模糊或者需要发特别多张图。');
  await app.ask('项目是你独立完成的，还是团队合作？你具体负责了哪一部分？');

  assert.match(app.calls[1].system, /TCS_ONLY/);
  assert.doesNotMatch(app.calls[1].system, /REPOPILOT_ONLY/);
  assert.match(app.calls[2].system, /TCS_ONLY/);
  assert.doesNotMatch(app.calls[2].system, /REPOPILOT_ONLY/);
  assert.equal(app.value('conversation.recent[2].plan.scopes.length'), 1);
  assert.match(app.value('conversation.recent[2].plan.projectLabel'), /TCS/i);
});
