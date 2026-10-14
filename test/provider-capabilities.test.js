'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizeUsage } = require('../src/provider-metrics');
const { DATA_START, DATA_END, prepareFinalRequest, requestText, visibleEvidence } = require('../src/final-request-budget');
const { resolveChatRequestOptions } = require('../src/openai-compatible');

function runtime(provider, frames, overrides = {}) {
  const sdk = [], observed = [], usage = [], tokens = [];
  const file = path.resolve(__dirname, '../src/llm.js'), requireActual = createRequire(file);
  const iterable = () => (async function* () { for (const frame of frames) yield frame; })();
  class OpenAI {
    constructor() { this.chat = { completions: { create: async request => { sdk.push(request); return iterable(); } } }; }
  }
  OpenAI.AzureOpenAI = OpenAI;
  class Anthropic {
    constructor() { this.messages = { create: async request => { sdk.push(request); return iterable(); } }; }
  }
  class GoogleGenAI {
    constructor() { this.models = { generateContentStream: async request => { sdk.push(request); return iterable(); } }; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, Buffer, URL, Headers, TextDecoder,
    require: id => id === 'openai' ? OpenAI : id === '@anthropic-ai/sdk' ? Anthropic
      : id === '@google/genai' ? { GoogleGenAI } : requireActual(id),
    fetch: async (_url, init) => {
      sdk.push(JSON.parse(init.body));
      return { ok: true, body: (async function* () { yield Buffer.from(frames.map(frame => JSON.stringify(frame)).join('\n')); })() };
    }
  }, { filename: file });
  const settings = { provider, smart: false, baseUrl: 'https://example.invalid/v1',
    azureEndpoint: 'https://example.openai.azure.com', apiKeys: { [provider]: 'unit-key' },
    models: { [provider]: { fast: 'qwen3-8b', smart: 'qwen3-8b' } }, ...overrides };
  return { sdk, observed, usage, tokens, async stream(extra = {}) {
    return module.exports.createLLM(settings).stream({ system: '固定规则', turns: [{ role: 'user', text: '问题' }],
      maxTokens: 400, onRequest: request => observed.push(request), onUsage: value => usage.push(value),
      onToken: text => tokens.push(text), ...extra });
  } };
}

test('Qwen options depend on exact endpoint and hybrid capability; explicit settings remain authoritative', () => {
  const dashscope = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  assert.deepEqual(resolveChatRequestOptions({ baseURL: dashscope, model: 'qwen3-8b', smart: false }), { enable_thinking: false });
  assert.deepEqual(resolveChatRequestOptions({ baseURL: dashscope, model: 'qwen3-8b', smart: true }), { enable_thinking: true });
  for (const model of ['qwen3-8b-thinking-2507', 'qwen3-235b-a22b-thinking-2507', 'qwq-32b', 'qwen3-max', 'qwen-future']) {
    assert.deepEqual(resolveChatRequestOptions({ baseURL: dashscope, model }), {});
  }
  assert.deepEqual(resolveChatRequestOptions({ baseURL: 'https://dashscope.aliyuncs.com.attacker.invalid/compatible-mode/v1', model: 'qwen3-8b' }), {});
  assert.deepEqual(resolveChatRequestOptions({ baseURL: 'http://localhost:1234/v1', model: 'qwen3-8b' }), {});
  assert.deepEqual(resolveChatRequestOptions({ baseURL: dashscope, model: 'qwen3-8b', explicit: { enable_thinking: true, reasoning_effort: 'high' } }),
    { enable_thinking: true, reasoning_effort: 'high' });
});

test('final compatible SDK request uses supported thinking fields and never blindly reasoning_effort:none', async () => {
  const frames = [{ choices: [{ delta: { reasoning_content: '私有推理', content: '正文' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 123, completion_tokens: 8, total_tokens: 131,
      prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 2 } } }];
  const local = runtime('custom', frames);
  await local.stream();
  assert.equal(local.sdk[0].reasoning_effort, undefined);
  assert.equal(local.sdk[0].enable_thinking, undefined);
  assert.equal(local.sdk[0].stream_options, undefined, 'Unknown compatible servers get no inferred optional protocol fields');
  assert.equal(local.sdk[0].cache_control, undefined);
  assert.deepEqual(local.tokens, ['正文']);
  assert.deepEqual(local.usage, [{ actualInputTokens: 123, actualOutputTokens: 8, actualTotalTokens: 131,
    cachedInputTokens: 50, actualReasoningTokens: 2 }]);
  const known = runtime('custom', frames, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
  await known.stream();
  assert.equal(known.sdk[0].enable_thinking, false);
  assert.equal(known.sdk[0].reasoning_effort, undefined);
  assert.equal(known.sdk[0].stream_options.include_usage, true);
  const explicit = runtime('custom', frames, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    providerOptions: { custom: { enable_thinking: true } } });
  await explicit.stream();
  assert.equal(explicit.sdk[0].enable_thinking, true);
});

for (const provider of ['custom', 'azure', 'anthropic', 'gemini', 'ollama']) {
  test(`${provider}: onRequest observes exact final protocol payload and real usage without exposing reasoning`, async () => {
    const source = { id: 'source', text: '导入资料\nJava identifier 保持原样。' };
    const system = `固定规则\n[来源 source]\n--- 来源 source 开始 ---\n${source.text}\n--- 来源 source 结束 ---`;
    let frames;
    if (provider === 'anthropic') frames = [
      { type: 'message_start', message: { usage: { input_tokens: 90, output_tokens: 0, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '私有推理' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '正文' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }
    ];
    else if (provider === 'gemini') frames = [{ text: '正文', candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 105, candidatesTokenCount: 7, totalTokenCount: 112, cachedContentTokenCount: 10, thoughtsTokenCount: 3 } }];
    else if (provider === 'ollama') frames = [{ message: { content: '正文', thinking: '私有推理' }, done: true, done_reason: 'stop', prompt_eval_count: 105, eval_count: 7 }];
    else frames = [{ choices: [{ delta: { content: '正文', reasoning_content: '私有推理' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 105, completion_tokens: 7, total_tokens: 112, prompt_tokens_details: { cached_tokens: 10 } } }];
    const app = runtime(provider, frames);
    assert.equal(await app.stream({ system, imageDataUrl: 'data:image/png;base64,c2NyZWVu' }), '正文');
    assert.equal(app.observed.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(app.observed[0])), JSON.parse(JSON.stringify(app.sdk[0])));
    assert.deepEqual(visibleEvidence([source], app.observed[0]), [source]);
    assert.equal(app.usage.at(-1).actualInputTokens, 105);
    assert.equal(app.usage.at(-1).actualOutputTokens, 7);
    assert.deepEqual(app.tokens, ['正文']);
    assert.equal(app.sdk[0].cache_control, undefined);
  });
}

test('actual usage parsing does not invent unsupported cache hits or zero counts', () => {
  assert.deepEqual(normalizeUsage('openai', { completion_tokens: 7 }), { actualOutputTokens: 7 });
  assert.deepEqual(normalizeUsage('anthropic', { input_tokens: 12, output_tokens: 0 }),
    { uncachedInputTokens: 12, actualInputTokens: 12, actualOutputTokens: 0 });
});

test('the actual SDK prompt contains a budgeted omission notice and complete original question', async () => {
  const a = { id: 'selected', text: '已展示的实现依据。' };
  const b = { id: 'excluded', text: '测试环境和指标。'.repeat(160) };
  const block = item => `[来源 ${item.id}]\n--- 来源 ${item.id} 开始 ---\n${item.text}\n--- 来源 ${item.id} 结束 ---`;
  const question = '当前完整问题：解释实现与指标，并保留末尾约束：只使用 MySQL。';
  const prepared = prepareFinalRequest({ system: `固定事实规则\n${DATA_START}\n${block(a)}\n${block(b)}\n${DATA_END}`,
    evidence: [a, b], contextWindow: 2048, maxTokens: 400,
    currentSections: [{ id: 'question', text: question, protected: true }] });
  const app = runtime('custom', [{ choices: [{ delta: { content: '正文' }, finish_reason: 'stop' }] }]);
  await app.stream({ system: prepared.system, turns: prepared.turns, maxTokens: prepared.maxTokens });
  assert.equal(prepared.fits, true);
  assert.ok(requestText(app.sdk[0]).includes(question));
  assert.match(requestText(app.sdk[0]), /本轮资料缺口/);
  assert.ok(!requestText(app.sdk[0]).includes('[来源 excluded]'));
  assert.deepEqual(visibleEvidence([a, b], app.observed[0]), [a]);
  assert.ok(prepared.stats.estimatedTokens + 400 + prepared.stats.safetyTokens <= 2048);
});
