'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createInterviewRuntime, currentText } = require('./helpers/interview-agent-runtime');
const { createReplyLatency } = require('../src/reply-latency');
const { createLLM } = require('../src/llm');
const { ProjectSearch } = require('../src/project-search');

test('the live package entry sends qwen-flash fast options all the way to the SDK', async t => {
  const app = createInterviewRuntime(t, { settings: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { custom: { fast: 'qwen-flash' } } } });
  app.final('什么是 Redis？');
  await app.shortcut('CommandOrControl+Return');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].model, 'qwen-flash');
  assert.equal(app.calls[0].enable_thinking, false);
  const line = app.logs.find(args => String(args[0]).startsWith('[latency][model] '))[0];
  const metrics = JSON.parse(line.slice('[latency][model] '.length));
  assert.equal(metrics.enableThinking, false);
  assert.equal(metrics.automaticRetriesDisabled, true);
});

test('lexical-only searches build no hash vectors and scan none, while fallback remains lazy and scoped', () => {
  const index = ProjectSearch.build([
    { id: 'a', projectId: 'a', path: 'Cache.java', text: '缓存版本校验通过 MySQL 事务实现。' },
    { id: 'b', projectId: 'b', path: 'Else.java', text: '其他项目的缓存版本。' }
  ]);
  assert.equal(index.embeddings.filter(Boolean).length, 0);
  const fast = index.getCandidates('缓存版本校验', ['@project:a'], { hashFallback: false });
  assert.equal(fast.denseScanned, 0);
  assert.equal(index.embeddings.filter(Boolean).length, 0);
  assert.ok(fast.rows.some(row => row.chunk.id === 'a'));
  index.getCandidates('缓存版本校验', ['@project:a']);
  assert.ok(index.embeddings[0]);
  assert.equal(index.embeddings[1], undefined, 'Do not compute vectors outside the requested project');
});

test('fast project answers never queue a semantic worker on the formal request path', async t => {
  let queries = 0;
  const semantic = { status: () => ({ ready: true, modelVersion: 'blocked-worker' }),
    queryCandidates() { queries++; return new Promise(() => {}); }, resetSession() {} };
  const app = createInterviewRuntime(t, { semanticRetriever: semantic });
  await app.ask('say', 'TCS 项目的缓存一致性如何设计？');
  assert.equal(queries, 0);
  assert.equal(app.calls.length, 1);
  const line = app.logs.find(args => String(args[0]).startsWith('[latency][prompt] '))[0];
  assert.equal(JSON.parse(line.slice('[latency][prompt] '.length)).retrieval.semanticWaitMs, 0);
  assert.match(currentText(app.calls[0]), /TCS 项目的缓存一致性如何设计/);
});

test('fast mode retains exact completed semantic prefetches', async t => {
  let queries = 0;
  const semantic = { status: () => ({ ready: true, modelVersion: 'ready-worker' }),
    queryCandidates: async () => { queries++; return { rows: [], reason: 'fixture-empty' }; }, resetSession() {} };
  const app = createInterviewRuntime(t, { semanticRetriever: semantic });
  const question = 'TCS 项目的缓存一致性如何设计？';
  await app.prefetch({ text: question, final: true });
  assert.equal(queries, 1);
  await app.ask('say', question);
  assert.equal(queries, 1);
  const line = app.logs.find(args => String(args[0]).startsWith('[latency][prompt] '))[0];
  assert.equal(JSON.parse(line.slice('[latency][prompt] '.length)).retrieval.exactPrefetchHit, true);
});

test('compact live prompts keep all current questions and scenario constraints once', async t => {
  const app = createInterviewRuntime(t);
  const question = '假设订单流量达到原来的10倍，数据库不能扩容，你会怎么优化？为什么这样设计？Redis 挂了怎么办？';
  await app.ask('say', question);
  const text = currentText(app.calls[0]);
  assert.equal(text.split(question).length - 1, 1);
  assert.match(text, /数据库不能扩容/);
  assert.match(text, /为什么这样设计/);
  assert.match(text, /Redis 挂了怎么办/);
  assert.match(text, /3个子问题/);
  assert.ok(app.calls[0].max_tokens >= 1000, 'Output coverage must not be cut to shorten TTFT');
});

test('timing separates preparation, provider response, hidden reasoning, and merged ASR finals without logging content', () => {
  let clock = 0;
  const logs = [];
  const timing = createReplyLatency({ now: () => clock, wallNow: () => 123, log: value => logs.push(value) });
  timing.observe('vad:state', { channel: 'them', speaking: false });
  clock = 20;
  timing.observe('stt:final', { channel: 'them', text: '缓存如何失效？', sourceId: 'asr', utteranceKey: '1' });
  clock = 30;
  timing.observe('stt:final', { channel: 'them', text: '失败后怎么恢复？', sourceId: 'asr', utteranceKey: '2' });
  clock = 40;
  const turn = timing.start('say', '缓存如何失效？失败后怎么恢复？', { sourceKeys: ['asr:1', 'asr:2'] });
  const sent = 50;
  clock = 100; turn.activity({ phase: 'provider-response' });
  clock = 120; turn.activity({ phase: 'reasoning' });
  clock = 620; turn.firstToken(sent); turn.firstToken(sent);
  assert.equal(logs.length, 1);
  const record = JSON.parse(logs[0].slice('[latency][reply] '.length));
  assert.equal(record.input, 'stt-final');
  assert.equal(record.prepareMs, 10);
  assert.equal(record.providerResponseMs, 50);
  assert.equal(record.firstProviderEventMs, 70);
  assert.equal(record.reasoningToFirstTokenMs, 500);
  assert.equal(record.finalToFirstTokenMs, 590);
  assert.ok(!logs[0].includes('缓存'));
  timing.reset();
  clock = 700; timing.start('say', '缓存如何失效？').firstToken(700);
  assert.equal(JSON.parse(logs[1].slice('[latency][reply] '.length)).input, 'manual-or-transcript');
});

async function server(t, handler) {
  const service = http.createServer(handler);
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return createLLM({ provider: 'custom', baseUrl: `http://127.0.0.1:${service.address().port}/v1`,
    models: { custom: { fast: 'fixture-model' } }, apiKeys: { custom: 'local-fixture-only' }, smart: false });
}

test('live OpenAI SDK requests do not silently retry HTTP failures', async t => {
  let attempts = 0;
  const llm = await server(t, (_request, response) => {
    attempts++;
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'fixture unavailable' } }));
  });
  await assert.rejects(llm.stream({ mode: 'say', system: '规则', turns: [{ role: 'user', text: '问题' }] }), /unavailable|503/);
  assert.equal(attempts, 1);
});

test('the real SDK forwards the first content chunk before the answer finishes', async t => {
  let release, done = false;
  const llm = await server(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '先给结论。' } }] }) + '\n\n');
    release = () => response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '再解释。' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  let first;
  const received = new Promise(resolve => { first = resolve; });
  const pending = llm.stream({ mode: 'say', system: '规则', turns: [{ role: 'user', text: '问题' }], onToken: first }).then(value => { done = true; return value; });
  assert.equal(await received, '先给结论。');
  assert.equal(done, false);
  release();
  assert.equal(await pending, '先给结论。再解释。');
});
