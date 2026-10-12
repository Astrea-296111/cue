'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const file = path.resolve(__dirname, '../src/llm.js');
const nativeRequire = createRequire(file);
const image = 'data:image/png;base64,c2NyZWVu';
const answer = '先回答设计结论。';
const turns = [
  { role: 'user', text: '原始问题' },
  { role: 'assistant', text: '上一轮回答' },
  { role: 'user', text: '当前问题与覆盖清单' }
];

// Load the actual provider adapter; only replace SDK/network transports.
// Separate VM instances keep these mocks independent from other test files.
function runtime(provider, frames, options = {}) {
  const calls = [], completions = [], tokens = [];
  const iterable = () => (async function* () {
    for (const frame of frames) {
      if (frame instanceof Error) throw frame;
      if (typeof frame === 'function') frame();
      else yield frame;
    }
  })();
  class OpenAI {
    constructor(clientOptions) {
      this.chat = { completions: { create: async (request, transport) => {
        calls.push({ clientOptions, request, transport });
        return iterable();
      } } };
    }
  }
  OpenAI.AzureOpenAI = OpenAI;
  class Anthropic {
    constructor(clientOptions) {
      this.messages = { create: async (request, transport) => {
        calls.push({ clientOptions, request, transport });
        return iterable();
      } };
    }
  }
  class GoogleGenAI {
    constructor(clientOptions) {
      this.models = { generateContentStream: async request => {
        calls.push({ clientOptions, request });
        return iterable();
      } };
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, Buffer, URL, Headers, TextDecoder,
    require: id => id === 'openai' ? OpenAI : id === '@anthropic-ai/sdk' ? Anthropic
      : id === '@google/genai' ? { GoogleGenAI } : nativeRequire(id),
    fetch: async (url, init) => {
      calls.push({ url, request: JSON.parse(init.body), transport: init });
      const bytes = Buffer.from(frames.map(frame => JSON.stringify(frame)).join('\n') + (options.trailingNewline ? '\n' : ''));
      const pieces = options.bytePieces || [bytes];
      return { ok: true, body: (async function* () {
        for (const piece of pieces) {
          if (piece instanceof Error) throw piece;
          if (typeof piece === 'function') piece();
          else yield piece;
        }
      })() };
    }
  }, { filename: file });
  const settings = {
    provider, smart: false, baseUrl: 'https://example.invalid/v1',
    azureEndpoint: options.azureEndpoint || 'https://example.openai.azure.com',
    apiKeys: { [provider]: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'unit-key' },
    models: { [provider]: { fast: 'test-model' } }
  };
  const llm = module.exports.createLLM(settings);
  return {
    calls, completions, tokens,
    async stream(extra = {}) {
      const result = await llm.stream({ system: '系统与项目证据', turns, imageDataUrl: image,
        maxTokens: 777, onToken: text => tokens.push(text),
        onCompletion: metadata => completions.push(JSON.parse(JSON.stringify(metadata))), ...extra });
      return result;
    }
  };
}

function frames(provider, reason, extra = {}) {
  if (provider === 'anthropic') return [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } },
    ...(extra.frames || []),
    { type: 'message_delta', delta: reason ? { stop_reason: reason } : {} },
    { type: 'message_stop' }
  ];
  if (provider === 'gemini') return [
    { text: answer, candidates: [{ content: { parts: [{ text: answer }] } }] },
    ...(extra.frames || []),
    { text: '', candidates: [{ ...(reason ? { finishReason: reason } : {}), ...extra.candidate }], ...extra.chunk }
  ];
  if (provider === 'ollama') return [
    { message: { content: answer }, done: false },
    ...(extra.frames || []),
    { message: { content: '' }, done: true, ...(reason ? { done_reason: reason } : {}) }
  ];
  return [
    { choices: [{ index: 0, delta: { content: answer, ...extra.delta } }] },
    ...(extra.frames || []),
    { choices: [{ index: 0, delta: {}, ...(reason ? { finish_reason: reason } : {}) }] },
    { choices: [], usage: { completion_tokens: 9 } }
  ];
}

function expected(finishReason, overrides = {}) {
  return { finishReason, complete: false, truncated: false, refused: false, ...overrides };
}

for (const provider of ['custom', 'azure', 'anthropic', 'gemini', 'ollama']) {
  const natural = provider === 'anthropic' ? 'end_turn' : provider === 'gemini' ? 'STOP' : 'stop';
  const truncated = provider === 'anthropic' ? 'max_tokens' : provider === 'gemini' ? 'MAX_TOKENS' : 'length';
  const refusal = provider === 'anthropic' ? 'refusal' : provider === 'gemini' ? 'SAFETY' : 'content_filter';

  test(`${provider}: natural termination reports completion once and preserves the final multimodal payload`, async () => {
    const app = runtime(provider, frames(provider, natural));
    assert.equal(await app.stream(), answer);
    assert.deepEqual(app.tokens, [answer]);
    assert.deepEqual(app.completions, [expected(natural, { complete: true })]);
    assert.equal(app.calls.length, 1);
    const { request, transport } = app.calls[0];
    if (provider === 'anthropic') {
      assert.equal(request.system, '系统与项目证据');
      assert.equal(request.messages[1].role, 'assistant');
      assert.equal(request.messages.at(-1).content[0].source.data, 'c2NyZWVu');
      assert.equal(request.messages.at(-1).content[1].text, turns.at(-1).text);
      assert.equal(request.max_tokens, 777);
    } else if (provider === 'gemini') {
      assert.equal(request.config.systemInstruction, '系统与项目证据');
      assert.equal(request.contents[1].role, 'model');
      assert.equal(request.contents.at(-1).parts[0].text, turns.at(-1).text);
      assert.equal(request.contents.at(-1).parts[1].inlineData.data, 'c2NyZWVu');
      assert.equal(request.config.maxOutputTokens, 777);
    } else {
      assert.equal(request.messages[0].content, '系统与项目证据');
      assert.equal(request.messages[2].role, 'assistant');
      if (provider === 'ollama') {
        assert.equal(request.messages.at(-1).content, turns.at(-1).text);
        assert.equal(request.messages.at(-1).images[0], 'c2NyZWVu');
        assert.equal(request.options.num_predict, 777);
      } else {
        assert.equal(request.messages.at(-1).content[0].text, turns.at(-1).text);
        assert.equal(request.messages.at(-1).content[1].image_url.url, image);
        assert.equal(request[provider === 'azure' ? 'max_completion_tokens' : 'max_tokens'], 777);
      }
    }
    if (provider !== 'gemini') assert.equal(request.stream, true);
    assert.equal(Object.hasOwn(request, 'onCompletion'), false);
    if (transport) assert.equal(Object.hasOwn(transport, 'onCompletion'), false);
  });

  test(`${provider}: missing termination metadata remains unknown instead of marking questions answered`, async () => {
    const app = runtime(provider, frames(provider, null));
    assert.equal(await app.stream(), answer);
    assert.deepEqual(app.completions, [expected(null)]);
  });

  test(`${provider}: truncation returns original text, streams its existing notice and never reports complete`, async () => {
    const app = runtime(provider, frames(provider, truncated));
    assert.equal(await app.stream(), answer);
    assert.match(app.tokens.at(-1), /输出达到模型长度上限/);
    assert.deepEqual(app.completions, [expected(truncated, { truncated: true })]);
  });

  test(`${provider}: refusal termination is not successful question coverage`, async () => {
    const app = runtime(provider, frames(provider, refusal));
    assert.equal(await app.stream(), answer);
    assert.deepEqual(app.completions, [expected(refusal, { refused: true })]);
  });

  test(`${provider}: cancellation after the final frame cannot publish successful completion`, async () => {
    const controller = new AbortController();
    const events = frames(provider, natural);
    const options = provider === 'ollama' ? {
      bytePieces: [Buffer.from(events.map(event => JSON.stringify(event)).join('\n')), () => controller.abort()]
    } : {};
    if (provider !== 'ollama') events.push(() => controller.abort());
    const app = runtime(provider, events, options);
    await assert.rejects(app.stream({ signal: controller.signal }), /回答已取消/);
    assert.deepEqual(app.completions, []);
  });
}

for (const provider of ['custom', 'azure']) {
  test(`${provider}: streamed refusal stays refused even when the terminal reason is stop`, async () => {
    const app = runtime(provider, frames(provider, 'stop', { delta: { refusal: '无法回答该请求' } }));
    await app.stream();
    assert.deepEqual(app.completions, [expected('stop', { refused: true })]);
  });

  test(`${provider}: multiple streamed tool calls are not a finished candidate answer`, async () => {
    const app = runtime(provider, frames(provider, 'stop', { delta: { tool_calls: [
      { index: 0, function: { name: 'search' } }, { index: 1, function: { name: 'readFile' } }
    ] } }));
    await app.stream();
    assert.deepEqual(app.completions, [expected('stop')]);
  });

  test(`${provider}: a tool-call termination remains incomplete without text deltas`, async () => {
    for (const reason of ['tool_calls', 'function_call']) {
      const app = runtime(provider, [{ choices: [{ delta: {}, finish_reason: reason }] }]);
      assert.equal(await app.stream(), '');
      assert.deepEqual(app.completions, [expected(reason)]);
    }
  });
}

for (const provider of ['openai', 'groq', 'minimax']) {
  test(`${provider}: official and compatible gateways preserve completion metadata`, async () => {
    const app = runtime(provider, frames(provider, 'stop'));
    assert.equal(await app.stream(), answer);
    assert.deepEqual(app.completions, [expected('stop', { complete: true })]);
  });
}

test('Anthropic tool-use blocks remain incomplete even if end_turn follows', async () => {
  const app = runtime('anthropic', frames('anthropic', 'end_turn', { frames: [
    { type: 'content_block_start', content_block: { type: 'tool_use', name: 'readFile' } },
    { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } }
  ] }));
  await app.stream();
  assert.deepEqual(app.completions, [expected('end_turn')]);
});

test('Anthropic stop_sequence is an explicit successful end and pause_turn is incomplete', async () => {
  for (const reason of ['stop_sequence', 'pause_turn']) {
    const app = runtime('anthropic', frames('anthropic', reason));
    await app.stream();
    assert.deepEqual(app.completions, [expected(reason, { complete: reason === 'stop_sequence' })]);
  }
});

test('Gemini function-call parts are not successful question coverage even with STOP', async () => {
  const app = runtime('gemini', frames('gemini', 'STOP', {
    candidate: { content: { parts: [{ functionCall: { name: 'readFile', args: {} } }] } }
  }));
  await app.stream();
  assert.deepEqual(app.completions, [expected('STOP')]);
});

test('Gemini prompt blocking without candidate finishReason still reports refused and incomplete', async () => {
  const app = runtime('gemini', frames('gemini', null, { chunk: { promptFeedback: { blockReason: 'SAFETY' } } }));
  await app.stream();
  assert.deepEqual(app.completions, [expected(null, { refused: true })]);
});

test('Ollama parses terminal metadata and UTF-8 text across arbitrary byte boundaries without trailing newline', async () => {
  const events = frames('ollama', 'stop');
  const bytes = Buffer.from(events.map(event => JSON.stringify(event)).join('\n'));
  const app = runtime('ollama', events, { bytePieces: Array.from(bytes, byte => Buffer.from([byte])) });
  assert.equal(await app.stream(), answer);
  assert.deepEqual(app.completions, [expected('stop', { complete: true })]);
});

test('Ollama tool calls and an abruptly ended stream do not count as complete', async () => {
  const tools = runtime('ollama', frames('ollama', 'stop', { frames: [
    { message: { tool_calls: [{ function: { name: 'readFile' } }] }, done: false }
  ] }));
  await tools.stream();
  assert.deepEqual(tools.completions, [expected('stop')]);
  const abrupt = runtime('ollama', [{ message: { content: answer }, done: false, done_reason: 'stop' }]);
  await abrupt.stream();
  assert.deepEqual(abrupt.completions, [expected(null)]);
});

test('provider errors after partial output never publish completion metadata', async () => {
  const app = runtime('custom', [frames('custom', 'stop')[0], new Error('stream failed')]);
  await assert.rejects(app.stream(), /stream failed/);
  assert.deepEqual(app.tokens, [answer]);
  assert.deepEqual(app.completions, []);
  const local = runtime('ollama', [{ message: { content: answer } }, { error: 'local stream failed' }]);
  await assert.rejects(local.stream(), /local stream failed/);
  assert.deepEqual(local.completions, []);
});

test('an empty response with a natural stop is not a complete answer, and onCompletion is optional', async () => {
  const empty = runtime('custom', [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
  assert.equal(await empty.stream(), '');
  assert.deepEqual(empty.completions, [expected('stop')]);
  const app = runtime('custom', frames('custom', 'stop'));
  assert.equal(await app.stream({ onCompletion: undefined }), answer);
  assert.deepEqual(app.completions, []);
});
