'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');

function recordingClient(behavior) {
  const configurations = [], requests = [];
  return { configurations, requests, Client: class {
    constructor(config) {
      configurations.push(config);
      this.chat = { completions: { create: async (body, options) => {
        requests.push({ body, options });
        return behavior ? behavior(body, options) : (async function* () {
          yield { choices: [{ delta: { content: '真实适配器测试正文。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } };
        })();
      } } };
    }
  } };
}
const settings = { provider: 'custom', baseUrl: 'https://provider.example/v1', apiKeys: { custom: 'secret-transport-only-test' },
  models: { custom: { fast: 'configured-qwen-model' } }, realtimeAnswerMode: 'standard',
  projectFactsEnabled: false, manualProjectKnowledgeEnabled: false, sourceRagPolicies: { standard: 'off' } };

test('live harness passes the production request to SDK, uses real clock and keeps settings credentials only in memory', async t => {
  const sdk = recordingClient(); let attempts = 0;
  const r = createInterviewRuntime(t, { chunks: [], settings, liveTransport: { Client: sdk.Client, onAttempt: () => attempts++ } });
  const before = Date.now();
  assert.ok(Math.abs(r.value('Date.now()') - before) < 1000);
  await r.ask('say', '什么是事务隔离？');
  assert.equal(attempts, 1);
  assert.equal(sdk.configurations[0].apiKey, settings.apiKeys.custom);
  assert.equal(sdk.configurations[0].maxRetries, 0);
  assert.equal(sdk.requests[0].options.maxRetries, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(sdk.requests[0].body)), r.calls[0]);
  assert.equal(sdk.requests[0].body.max_tokens, 400);
  assert.ok(r.loaded.includes('src/custom-main.js') && r.loaded.includes('main.js') && r.loaded.includes('src/llm.js'));
  assert.equal(r.commits.at(-1).answer, '真实适配器测试正文。');
  await r.invoke('settings:set', { apiKeys: { custom: 'another-memory-only-secret' }, realtimeAnswerMode: 'instant' });
  const persisted = fs.readFileSync(path.join(r.temp, 'cue-data.json'), 'utf8');
  assert.ok(!persisted.includes(settings.apiKeys.custom) && !persisted.includes('another-memory-only-secret'));
  assert.throws(() => r.answer('fake'), /cannot be replaced/);
});

test('live transport delegates to the installed OpenAI SDK and receives a real HTTP SSE stream', async t => {
  const received = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '来自本地 HTTP 服务的正文。' }, finish_reason: 'stop' }] }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const r = createInterviewRuntime(t, { chunks: [], settings: { ...settings, baseUrl }, liveTransport: {} });
  await r.ask('say', '什么是 HTTP 流式响应？');
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/v1/chat/completions');
  assert.equal(received[0].authorization, 'Bearer ' + settings.apiKeys.custom);
  assert.deepEqual(received[0].body, r.calls[0]);
  assert.equal(r.commits.at(-1).answer, '来自本地 HTTP 服务的正文。');
});

test('live harness rejects output budget and global attempt budget before invoking the external SDK', async t => {
  const sdk = recordingClient(); let attempts = 0;
  const r = createInterviewRuntime(t, { chunks: [], settings, liveTransport: { Client: sdk.Client, maxOutputTokens: 300,
    onAttempt: () => { attempts++; } } });
  await r.ask('say', '什么是数据库？');
  assert.equal(attempts, 0);
  assert.equal(sdk.requests.length, 0);
  assert.equal(r.transportEvents[0].code, 'output-token-budget');
  assert.match(r.events.find(event => event.channel === 'llm:error').message, /budget exceeded/);

  const sdk2 = recordingClient();
  const r2 = createInterviewRuntime(t, { chunks: [], settings, liveTransport: { Client: sdk2.Client,
    onAttempt() { throw new Error('Total request budget exceeded.'); } } });
  await r2.ask('say', '什么是索引？');
  assert.equal(sdk2.requests.length, 0);
  assert.equal(r2.commits.length, 0);
});

test('live first-content deadline excludes reasoning and blank text and preserves partial body on total timeout', async t => {
  const abortable = firstChunk => recordingClient((_body, { signal }) => (async function* () {
    yield firstChunk;
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'));
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  })());
  const sdk = abortable({ choices: [{ delta: { reasoning_content: 'thinking', content: '   ' } }] });
  const r = createInterviewRuntime(t, { chunks: [], settings, liveTransport: { Client: sdk.Client, firstContentTimeoutMs: 10, totalTimeoutMs: 1000 } });
  await r.ask('say', '什么是MVCC？');
  assert.ok(r.transportEvents.some(event => event.code === 'first-content-timeout'));
  assert.ok(r.events.some(event => event.channel === 'llm:error'));
  assert.equal(r.commits.length, 0);

  const sdk2 = abortable({ choices: [{ delta: { content: '已经收到的部分正文。' } }] });
  const r2 = createInterviewRuntime(t, { chunks: [], settings, liveTransport: { Client: sdk2.Client, firstContentTimeoutMs: 1000, totalTimeoutMs: 15 } });
  await r2.ask('say', '什么是乐观锁？');
  assert.ok(r2.transportEvents.some(event => event.code === 'total-timeout'));
  assert.equal(r2.events.filter(event => event.channel === 'llm:token').map(event => event.text).join(''), '已经收到的部分正文。');
  assert.equal(r2.commits.length, 0);
});
