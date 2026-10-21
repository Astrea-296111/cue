'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReplyLatency } = require('../src/reply-latency');

function clocked() {
  let clock = 0;
  const logs = [];
  const tracker = createReplyLatency({ now: () => clock, wallNow: () => 10000 + clock, log: value => logs.push(value) });
  return { tracker, logs, at(value) { clock = value; } };
}

test('trigger, SDK dispatch, reasoning, actual content and useful sentence retain one identity', () => {
  const t = clocked();
  t.at(8);
  const turn = t.tracker.start('say', '不记录原始问题', { triggerAt: 0, executionProfile: 'instant',
    questionSnapshot: { epoch: 3, questionId: 'q-1', revision: 2, observedAt: 9990, source: 'interim', timeBase: 'wall' },
    buildCommit: 'a'.repeat(40) });
  t.at(20); turn.dispatched({ model: 'qwen-flash', ragPolicy: 'ready-only', readyEvidenceHit: false, sourceCount: 0 });
  t.at(45); turn.activity({ phase: 'provider-response' });
  t.at(50); turn.activity({ phase: 'reasoning' });
  t.at(100); assert.equal(turn.content('  \n', 20), false);
  assert.equal(turn.metrics().firstContentMs, null);
  t.at(120); assert.equal(turn.content('采用版本校验', 20), true);
  t.at(140); turn.content('，失败时重载。', 20);
  turn.usage({ actualInputTokens: 931, actualOutputTokens: 20, bogus: 'secret' });
  t.at(150); const result = turn.finish();
  assert.equal(result.triggerToDispatchMs, 20);
  assert.equal(result.providerResponseMs, 25);
  assert.equal(result.firstReasoningMs, 30);
  assert.equal(result.firstContentMs, 100);
  assert.equal(result.triggerToFirstContentMs, 120);
  assert.equal(result.triggerToFirstUsefulSentenceMs, 140);
  assert.equal(result.questionAgeMs, 10);
  assert.equal(result.actualInputTokens, 931);
  assert.equal(result.model, 'qwen-flash');
  assert.equal(result.epoch, 3);
  assert.equal(result.questionRevision, 2);
  assert.equal(result.aborted, false);
  assert.ok(t.logs.every(line => !line.includes('不记录原始问题') && !line.includes('采用版本校验') && !line.includes('secret')));
});

test('no reasoning event stays null and cancellation before content does not fabricate first-token latency', () => {
  const t = clocked(), turn = t.tracker.start('say', '问题');
  t.at(10); turn.dispatched();
  t.at(30); turn.activity({ phase: 'provider-event' });
  t.at(40); turn.content('\n');
  t.at(50); const result = turn.finish({ aborted: true });
  assert.equal(result.firstReasoningMs, null);
  assert.equal(result.firstContentMs, null);
  assert.equal(result.triggerToFirstContentMs, null);
  assert.equal(result.aborted, true);
  t.at(100); turn.content('晚到的正文。');
  assert.equal(turn.metrics().firstContentMs, null);
});

test('formatting-only code fences, headings and wait placeholders do not count as useful sentences', () => {
  const t = clocked(), turn = t.tracker.start('technical', '代码题');
  turn.dispatched();
  t.at(10); turn.content('```java\n');
  t.at(20); turn.content('# 实现\n');
  t.at(30); turn.content('正在检索。');
  assert.equal(turn.metrics().triggerToFirstUsefulSentenceMs, null);
  t.at(40); turn.content('通过双指针在一次遍历中完成。');
  assert.equal(turn.metrics().triggerToFirstUsefulSentenceMs, 40);
  assert.equal(turn.metrics().triggerToFirstContentMs, 10);
});

test('DOM and double-rAF acknowledgements use main clock and only renderer duration crosses clocks', () => {
  const t = clocked(), turn = t.tracker.start('say', '问题');
  t.at(10); turn.dispatched();
  t.at(50); turn.content('结论。');
  t.at(55); turn.renderAck({ stage: 'dom', rendererTimestamp: 987654321 });
  t.at(80); const result = turn.renderAck({ stage: 'paint-approx', rendererElapsedMs: 21, rendererTimestamp: 987654342 });
  assert.equal(result.renderAckMs, 55);
  assert.equal(result.paintApproxMs, 80);
  assert.equal(result.tokenToRenderAckMs, 5);
  assert.equal(result.rendererFrameDelayMs, 21);
  assert.match(result.paintMeasurement, /not-pixel-presentation/);
  t.at(99); turn.renderAck({ stage: 'paint-approx', rendererElapsedMs: 40 });
  assert.equal(turn.metrics().paintApproxMs, 80);
  assert.equal(t.logs.filter(line => line.startsWith('[latency][ui]')).length, 2);
});

test('ASR lag requires a matching utterance identity; anonymous VAD remains explicitly approximate', () => {
  const t = clocked();
  t.tracker.observe('vad:state', { channel: 'them', speaking: false });
  t.at(20); t.tracker.observe('stt:final', { channel: 'them', text: '旧问题？', sourceId: 'asr', utteranceKey: '1' });
  t.at(30); const approximate = t.tracker.start('say', '旧问题？', { sourceKeys: ['asr:1'] }).metrics();
  assert.equal(approximate.asrLagMs, null);
  assert.equal(approximate.asrAssociation, 'local-vad-approximation');
  assert.equal(approximate.vadEndToFinalMs, 20);
  t.at(100); t.tracker.observe('vad:state', { channel: 'them', speaking: false, sourceId: 'asr', sourceSessionId: 'new', utteranceKey: '2' });
  t.at(130); t.tracker.observe('stt:final', { channel: 'them', text: '当前问题？', sourceId: 'asr', sourceSessionId: 'new', utteranceKey: '2' });
  t.at(140); const reliable = t.tracker.start('say', '当前问题？', { sourceKeys: ['asr@new:2'] }).metrics();
  assert.equal(reliable.asrLagMs, 30);
  assert.equal(reliable.asrAssociation, 'utterance-key');
  const manual = t.tracker.start('say', '当前问题？', { questionSource: 'manual' }).metrics();
  assert.equal(manual.asrLagMs, null);
  assert.equal(manual.questionSource, 'manual');
});
