'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { QuestionResolver } = require('../src/question-resolver');

function providers() {
  const sockets = [], modules = new Map();
  class Socket extends EventEmitter {
    constructor() { super(); this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.emit('open'); }
    message(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
    send(value) { this.sent.push(value); }
    close(code = 1000) { this.readyState = 3; this.emit('close', code); }
    terminate() { this.close(1006); }
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const native = createRequire(file), module = { exports: {} }; modules.set(file, module);
    const requireLocal = id => id === 'ws' ? Socket :
      id === './stt-providers/qwen' ? load(native.resolve(id)) : native(id);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports,
      require: requireLocal, __dirname: path.dirname(file), __filename: file,
      Buffer, URLSearchParams, Date, setTimeout, clearTimeout, setInterval, clearInterval,
      console: { log() {}, warn() {}, error() {} } }, { filename: file });
    return module.exports;
  }
  return { ...load(path.resolve(__dirname, '../src/stt-streaming.js')), sockets };
}

function message(provider, text, final, id = 1, taskId) {
  if (provider === 'qwen') return { header: { event: 'result-generated', ...(taskId ? { task_id: taskId } : {}) },
    payload: { output: { sentence: { text, sentence_end: final, sentence_id: id } } } };
  if (provider === 'deepgram') return { type: 'Results', start: id, is_final: final, speech_final: final,
    channel: { alternatives: [{ transcript: text }] } };
  return final ? { type: 'conversation.item.input_audio_transcription.completed', item_id: String(id), transcript: text }
    : { type: 'conversation.item.input_audio_transcription.delta', item_id: String(id), delta: text };
}

function instance(provider, loaded, callbacks) {
  return provider === 'qwen' ? new loaded.QwenStreamingSTT({ apiKey: 'fixture-only', websocketUrl: 'wss://invalid.example' }, callbacks)
    : provider === 'deepgram' ? new loaded.DeepgramStreamingSTT('fixture-only', callbacks)
      : new loaded.OpenAIRealtimeSTT('fixture-only', callbacks);
}

for (const provider of ['qwen', 'deepgram', 'openai']) {
  test(`${provider}: connection session owns interim/final identity and retired socket events cannot refocus`, async t => {
    const loaded = providers(), resolver = new QuestionResolver(), emitted = [], errors = [];
    const report = (text, meta, final) => {
      emitted.push({ text, ...meta, final });
      resolver.observe({ channel: 'them', sourceId: provider, text, ...meta }, final);
    };
    const stt = instance(provider, loaded, { onTranscript: (text, meta) => report(text, meta, true),
      onInterim: (text, meta) => report(text, meta, false), onError: error => errors.push(error) });
    t.after(() => stt.disconnect());
    await stt.connect();
    const old = loaded.sockets[0]; old.open();
    old.message(message(provider, '缓存如何实现？', false, 7, stt.taskId));
    old.message(message(provider, '缓存如何实现？', true, 7, stt.taskId));
    const oldFinal = emitted.findLast(event => event.final);
    assert.ok(oldFinal.sourceSessionId);
    assert.equal(emitted.find(event => event.text === '缓存如何实现？' && !event.final).sourceSessionId, oldFinal.sourceSessionId);
    assert.equal(emitted.find(event => event.text === '缓存如何实现？' && !event.final).utteranceKey, oldFinal.utteranceKey);
    assert.equal(emitted.find(event => event.text === '缓存如何实现？' && !event.final).utteranceOrder, oldFinal.utteranceOrder);
    const oldTask = stt.taskId;
    old.close(1006);
    // No message may be processed in the disconnect/reconnect gap, either.
    const gapCount = emitted.length;
    old.message(message(provider, '旧缓存又如何实现？', true, 9, oldTask));
    assert.equal(emitted.length, gapCount);
    await stt.connect();
    const current = loaded.sockets[1]; current.open();
    current.message(message(provider, '团队如何分工？', false, 0, stt.taskId));
    current.message(message(provider, '团队如何分工？', true, 0, stt.taskId));
    const currentFinal = emitted.findLast(event => event.final);
    assert.notEqual(currentFinal.sourceSessionId, oldFinal.sourceSessionId);
    assert.match(resolver.resolveForSubmit({ allowPartial: true }).text, /团队.*分工/);
    assert.doesNotMatch(resolver.resolveForSubmit({ allowPartial: true }).text, /缓存/);
    const count = emitted.length;
    old.message(message(provider, '迟到旧问题是什么？', true, 99, oldTask));
    old.emit('error', new Error('retired socket failure'));
    old.emit('close', 1006); old.emit('open');
    assert.equal(emitted.length, count);
    assert.equal(errors.length, 0);
    assert.equal(stt.connected, true);
    assert.equal(stt.ws, current);
    assert.match(resolver.resolveForSubmit().text, /团队.*分工/);
  });

  test(`${provider}: internal reconnect creates a new session and explicit disconnect cancels retry`, async t => {
    const loaded = providers(), stt = instance(provider, loaded, {});
    stt._reconnectDelay = 1;
    t.after(() => stt.disconnect());
    await stt.connect(); loaded.sockets[0].open();
    const before = stt.sourceSessionId;
    loaded.sockets[0].close(1006);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(loaded.sockets.length, 2);
    assert.notEqual(stt.sourceSessionId, before);
    loaded.sockets[1].open(); loaded.sockets[1].close(1006);
    stt.disconnect();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(loaded.sockets.length, 2);
  });
}

test('Qwen identical sentence/text after reconnect is not dropped by old session dedupe', async t => {
  const loaded = providers(), finals = [];
  const stt = instance('qwen', loaded, { onTranscript: (text, meta) => finals.push({ text, meta }) });
  t.after(() => stt.disconnect());
  await stt.connect(); loaded.sockets[0].open();
  loaded.sockets[0].message(message('qwen', '团队如何分工？', true, 1, stt.taskId));
  loaded.sockets[0].close(1006);
  await stt.connect(); loaded.sockets[1].open();
  loaded.sockets[1].message(message('qwen', '团队如何分工？', true, 1, stt.taskId));
  assert.equal(finals.length, 2);
  assert.notEqual(finals[0].meta.sourceSessionId, finals[1].meta.sourceSessionId);
});

test('OpenAI reconnect clears partial delta state even if item IDs are reused', async t => {
  const loaded = providers(), interim = [];
  const stt = instance('openai', loaded, { onInterim: text => interim.push(text) });
  t.after(() => stt.disconnect());
  await stt.connect(); loaded.sockets[0].open();
  loaded.sockets[0].message(message('openai', '旧缓存问题', false, 1));
  loaded.sockets[0].close(1006);
  await stt.connect(); loaded.sockets[1].open();
  loaded.sockets[1].message(message('openai', '团队如何分工？', false, 1));
  assert.equal(interim.at(-1), '团队如何分工？');
});
