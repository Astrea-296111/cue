'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');

function runtime(provider, overrides = {}, { fail = false, frames: customFrames } = {}) {
  const requests = [], clients = [], diagnostics = [], activity = [], tokens = [];
  let attempts = 0;
  const file = path.resolve(__dirname, '../src/llm.js'), requireActual = createRequire(file);
  const frames = customFrames || (provider === 'anthropic'
    ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '直接给结论。' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]
    : provider === 'gemini'
      ? [{ text: '直接给结论。', candidates: [{ finishReason: 'STOP' }] }]
      : [{ choices: [{ delta: { content: '直接给结论。' }, finish_reason: 'stop' }] }]);
  async function create(request) {
    requests.push(request); attempts++;
    if (fail) throw Object.assign(new Error('controlled unavailable'), { status: 503 });
    return (async function* () { yield* frames; })();
  }
  class OpenAI {
    constructor(options) { clients.push(options); this.chat = { completions: { create } }; }
  }
  OpenAI.AzureOpenAI = OpenAI;
  class Anthropic {
    constructor(options) { clients.push(options); this.messages = { create }; }
  }
  class GoogleGenAI {
    constructor(options) { clients.push(options); this.models = { generateContentStream: create }; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, Buffer, URL, Headers, TextDecoder,
    require: id => id === 'openai' ? OpenAI : id === '@anthropic-ai/sdk' ? Anthropic
      : id === '@google/genai' ? { GoogleGenAI } : requireActual(id),
    fetch: async (_url, init) => {
      attempts++; requests.push(JSON.parse(init.body));
      if (fail) return { ok: false, status: 503, statusText: 'controlled unavailable' };
      return { ok: true, body: (async function* () {
        yield Buffer.from(JSON.stringify({ message: { content: '直接给结论。' }, done: true, done_reason: 'stop' }) + '\n');
      })() };
    }
  }, { filename: file });
  const settings = { provider, smart: true, baseUrl: 'https://gateway.invalid/v1',
    azureEndpoint: 'https://fixture.openai.azure.com', apiKeys: { [provider]: 'private-test-secret' },
    models: { [provider]: { fast: 'fixture-fast', smart: 'fixture-deep' } }, ...overrides };
  const before = JSON.stringify(settings);
  const llm = module.exports.createLLM(settings, { executionProfile: 'instant' });
  return { llm, settings, before, requests, clients, diagnostics, activity, tokens,
    get attempts() { return attempts; },
    standard: () => module.exports.createLLM(settings, { executionProfile: 'standard' }),
    make: next => module.exports.createLLM(next, { executionProfile: 'instant' }),
    stream: extra => llm.stream({ mode: 'say', system: '固定规则', turns: [{ role: 'user', text: '当前问题' }],
      maxTokens: 640, onToken: text => tokens.push(text), onActivity: event => activity.push(event),
      onDiagnostics: value => diagnostics.push(value), ...extra }) };
}

for (const provider of ['custom', 'openai', 'azure', 'groq', 'minimax', 'anthropic', 'gemini', 'ollama']) {
  test(`${provider}: instant profile uses configured fast model and one stream without mutating global deep mode`, async () => {
    const app = runtime(provider);
    assert.equal(app.llm.model, 'fixture-fast');
    assert.equal(app.llm.executionProfile, 'instant');
    assert.equal(app.llm.tier, 'fast');
    assert.equal(app.standard().model, 'fixture-deep');
    assert.equal(await app.stream(), '直接给结论。');
    assert.equal(app.attempts, 1);
    assert.equal(app.requests[0].model, 'fixture-fast');
    if (provider === 'gemini') assert.equal(app.requests[0].config.httpOptions.retryOptions.attempts, 1);
    else if (provider !== 'ollama') assert.equal(app.clients[0].maxRetries, 0);
    assert.equal(JSON.stringify(app.settings), app.before);
    assert.equal(app.diagnostics.length, 1);
    assert.equal(app.diagnostics[0].model, 'fixture-fast');
    assert.equal(app.diagnostics[0].executionProfile, 'instant');
    assert.equal(app.diagnostics[0].automaticRetriesDisabled, true);
    const safe = JSON.stringify(app.diagnostics[0]);
    assert.ok(!safe.includes('private-test-secret'));
    assert.ok(!safe.includes('gateway.invalid'));
    assert.ok(!safe.includes('当前问题'));
    assert.deepEqual(app.tokens, ['直接给结论。']);
  });

  test(`${provider}: adapter failure performs one attempt and never starts an application retry`, async () => {
    const app = runtime(provider, {}, { fail: true });
    await assert.rejects(app.stream(), /controlled unavailable/);
    assert.equal(app.attempts, 1);
    if (provider === 'gemini') assert.equal(app.requests[0].config.httpOptions.retryOptions.attempts, 1);
    else if (provider !== 'ollama') assert.equal(app.clients[0].maxRetries, 0);
  });
}

test('DashScope qwen3.5-flash receives documented thinking control on the actual serialized request', async () => {
  const app = runtime('custom', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { custom: { fast: 'qwen3.5-flash', smart: 'qwen3.5-flash' } } });
  await app.stream();
  assert.equal(app.requests[0].enable_thinking, false);
  assert.equal(app.requests[0].reasoning_effort, undefined);
  assert.equal(app.llm.diagnostics.thinkingStatus, 'disabled');
  assert.equal(app.diagnostics[0].enableThinking, false);
  assert.equal(app.diagnostics[0].endpointClass, 'dashscope-official');
});

test('instant thinking preferences are independent; inherited explicit thinking is never called disabled', async () => {
  const base = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { custom: { fast: 'qwen-flash', smart: 'qwen-flash' } },
    providerOptions: { custom: { enable_thinking: true } } };
  const inherited = runtime('custom', base);
  await inherited.stream();
  assert.equal(inherited.requests[0].enable_thinking, true);
  assert.equal(inherited.diagnostics[0].thinkingStatus, 'enabled');
  assert.equal(inherited.diagnostics[0].thinkingSource, 'user-explicit');
  const independent = runtime('custom', { ...base, instantProviderOptions: { custom: { enable_thinking: false } } });
  await independent.stream();
  assert.equal(independent.requests[0].enable_thinking, false);
  assert.equal(independent.diagnostics[0].thinkingStatus, 'disabled');
  assert.equal(independent.diagnostics[0].thinkingSource, 'instant-explicit');
  assert.equal(independent.settings.providerOptions.custom.enable_thinking, true);
});

test('stream-level explicit thinking is reflected in actual request diagnostics rather than the default profile', async () => {
  const app = runtime('custom', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { custom: { fast: 'qwen-flash', smart: 'qwen-flash' } } });
  assert.equal(app.llm.diagnostics.thinkingStatus, 'disabled');
  await app.stream({ enable_thinking: true });
  assert.equal(app.requests[0].enable_thinking, true);
  assert.equal(app.diagnostics[0].enableThinking, true);
  assert.equal(app.diagnostics[0].thinkingStatus, 'enabled');
});

test('instant custom profile never silently selects a configured deep model when no fast model exists', async () => {
  const app = runtime('custom', { models: { custom: { fast: '', smart: 'only-deep' } } });
  assert.equal(app.llm.ready, false);
  await assert.rejects(app.stream(), /设置.*模型/);
  assert.equal(app.attempts, 0);
});

test('unknown gateways do not receive inferred protocol fields or a promise that thinking is disabled', async () => {
  for (const model of ['qwen-flash', 'qwen3.5-flash', 'totally-unknown']) {
    const app = runtime('custom', { models: { custom: { fast: model } } });
    await app.stream();
    assert.equal(app.requests[0].enable_thinking, undefined);
    assert.equal(app.requests[0].reasoning_effort, undefined);
    assert.equal(app.diagnostics[0].thinkingStatus, 'unknown');
  }
});

test('documented thinking-only checkpoints are reported as required without false disabling parameters', async () => {
  for (const model of ['qwq-32b', 'qwen3-235b-a22b-thinking-2507']) {
    const app = runtime('custom', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: { custom: { fast: model } } });
    await app.stream();
    assert.equal(app.requests[0].enable_thinking, undefined);
    assert.equal(app.diagnostics[0].thinkingStatus, 'required');
  }
});

test('new configuration and keys select a fresh correct request without retaining stale clients', async () => {
  const app = runtime('custom');
  await app.stream();
  const next = app.make({ ...app.settings, baseUrl: 'https://other-gateway.invalid/v1',
    apiKeys: { custom: 'changed-private-test-secret' }, models: { custom: { fast: 'changed-fast' } } });
  await next.stream({ mode: 'say', system: '', turns: [] });
  assert.equal(app.clients[1].apiKey, 'changed-private-test-secret');
  assert.equal(app.clients[1].baseURL, 'https://other-gateway.invalid/v1');
  assert.equal(app.requests[1].model, 'changed-fast');
});

test('Gemini thought parts and empty events never become answer content even if chunk.text includes thoughts', async () => {
  const app = runtime('gemini', {}, { frames: [
    { text: '私有推理', candidates: [{ content: { parts: [{ text: '私有推理', thought: true }] } }] },
    { text: '私有推理直接给结论。', candidates: [{ content: { parts: [
      { text: '私有推理', thought: true }, { text: '直接给结论。' }
    ] }, finishReason: 'STOP' }] }
  ] });
  assert.equal(await app.stream(), '直接给结论。');
  assert.deepEqual(app.tokens, ['直接给结论。']);
  assert.ok(app.activity.some(event => event?.phase === 'reasoning'));
});

test('real OpenAI SDK respects instant maxRetries=0 even when global settings select deep mode', async t => {
  let attempts = 0;
  const service = http.createServer((_request, response) => {
    attempts++;
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'controlled unavailable' } }));
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => { service.closeAllConnections(); service.close(); });
  const { createLLM } = require('../src/llm');
  const llm = createLLM({ provider: 'custom', smart: true,
    baseUrl: `http://127.0.0.1:${service.address().port}/v1`, apiKeys: { custom: 'local-only' },
    models: { custom: { fast: 'fixture-fast', smart: 'fixture-deep' } } }, { executionProfile: 'instant' });
  await assert.rejects(llm.stream({ mode: 'say', system: '', turns: [{ role: 'user', text: '当前问题' }] }), /controlled unavailable/);
  assert.equal(attempts, 1);
});

for (const provider of ['anthropic', 'gemini']) {
  test(`real ${provider} SDK sends one HTTP attempt for an instant failure`, async t => {
    let attempts = 0;
    const service = http.createServer((_request, response) => {
      attempts++;
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'api_error', code: 503, message: 'controlled unavailable' } }));
    });
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
    t.after(() => { service.closeAllConnections(); service.close(); });
    const baseUrl = `http://127.0.0.1:${service.address().port}`;
    const file = path.resolve(__dirname, '../src/llm.js'), requireActual = createRequire(file);
    const module = { exports: {} };
    const Anthropic = requireActual('@anthropic-ai/sdk');
    const { GoogleGenAI } = requireActual('@google/genai');
    // Preserve the actual SDK and configured retry options; only route its
    // destination to this local HTTP fixture instead of a live supplier.
    class LocalAnthropic {
      constructor(options) { return new Anthropic({ ...options, baseURL: baseUrl }); }
    }
    class LocalGoogleGenAI {
      constructor(options) { return new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, baseUrl } }); }
    }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, exports: module.exports, Buffer, URL, Headers, TextDecoder, fetch,
      require: id => id === '@anthropic-ai/sdk' ? LocalAnthropic
        : id === '@google/genai' ? { GoogleGenAI: LocalGoogleGenAI } : requireActual(id)
    }, { filename: file });
    const llm = module.exports.createLLM({ provider, smart: true,
      apiKeys: { [provider]: 'local-only' }, models: { [provider]: { fast: 'fixture-fast', smart: 'fixture-deep' } }
    }, { executionProfile: 'instant' });
    await assert.rejects(llm.stream({ mode: 'say', system: '', turns: [{ role: 'user', text: '当前问题' }],
      signal: AbortSignal.timeout(2500) }), /controlled unavailable/);
    assert.equal(attempts, 1);
  });
}
