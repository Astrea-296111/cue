'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QuestionResolver,
  isLikelyCompleteQuestion,
  isLikelyIncompleteFragment,
  isLikelySupplement
} = require('../src/question-resolver');

function final(resolver, text, extra = {}) {
  resolver.observe({ channel: 'them', text, ...extra }, true);
}

function interim(resolver, text, extra = {}) {
  resolver.observe({ channel: 'them', text, ...extra }, false);
}

test('trailing unfinished fragment does not replace the last complete question', () => {
  const q = new QuestionResolver();
  final(q, '达到100%的恢复率是不是牺牲了什么?');
  final(q, '比如图片变得肉眼可见的模糊，或者需要发特别多张图。');
  final(q, '如果平');
  const resolved = q.resolveForSubmit();
  assert.equal(resolved.text, '达到100%的恢复率是不是牺牲了什么?\n比如图片变得肉眼可见的模糊,或者需要发特别多张图。');
  assert.equal(resolved.pendingText, '如果平');
});

test('unfinished interim is also unable to steal Ctrl+Enter focus', () => {
  const q = new QuestionResolver();
  final(q, '达到100%的恢复率是不是牺牲了什么?');
  interim(q, '如果平');
  const resolved = q.resolveForSubmit();
  assert.equal(resolved.text, '达到100%的恢复率是不是牺牲了什么?');
  assert.equal(resolved.pendingText, '如果平');
});

test('short-pause independent questions replace the previous unanswered target', () => {
  const q = new QuestionResolver({ newQuestionGapMs: 2800 });
  final(q, '为什么用 Function Call？');
  final(q, '为什么用 React 框架？');
  assert.equal(q.resolveForSubmit().text, '为什么用 React 框架?');
});

test('noise after two questions cannot become the answer target', () => {
  const q = new QuestionResolver();
  final(q, '为什么用 Function Call？');
  final(q, '为什么用 React 框架？');
  final(q, 'ops');
  assert.equal(q.resolveForSubmit().text, '为什么用 React 框架?');
});

test('a split conditional fragment can later become a complete question', () => {
  const q = new QuestionResolver();
  final(q, '如果平');
  final(q, '均每张图的生存概率都一样，还需要动态规划吗？');
  assert.equal(q.resolveForSubmit().text, '如果平均每张图的生存概率都一样,还需要动态规划吗?');
});

test('once a question is submitted, a new incomplete tail does not revive the old question', () => {
  const q = new QuestionResolver();
  final(q, '为什么用 React 框架？');
  const first = q.resolveForSubmit();
  q.markSubmitted(first);
  final(q, '如果平');
  const second = q.resolveForSubmit();
  assert.equal(second.text, '');
  assert.equal(second.pendingText, '如果平');
});

test('late final for the same submitted utterance is ignored', () => {
  const q = new QuestionResolver();
  interim(q, '为什么用 RAG？', { sourceId: 'qwen', utteranceKey: 's:7' });
  const snapshot = q.resolveForSubmit();
  assert.equal(snapshot.provisional, true);
  q.markSubmitted(snapshot);
  final(q, '为什么用 RAG？', { sourceId: 'qwen', utteranceKey: 's:7' });
  assert.equal(q.resolveForSubmit().text, '');
});

test('long-gap independent question replaces an older unanswered question', () => {
  const q = new QuestionResolver({ newQuestionGapMs: 1000 });
  final(q, '为什么用 Function Call？');
  q.speechState({ channel: 'them', speaking: false, speechEndedAt: 1000 });
  q.speechState({ channel: 'them', speaking: true, speechStartedAt: 3500 });
  final(q, 'Redis 为什么快?');
  assert.equal(q.resolveForSubmit().text, 'Redis 为什么快?');
});

test('long-gap incomplete tail keeps the previous stable question', () => {
  const q = new QuestionResolver({ newQuestionGapMs: 1000 });
  final(q, '达到100%的恢复率是不是牺牲了什么?');
  q.speechState({ channel: 'them', speaking: false, speechEndedAt: 1000 });
  q.speechState({ channel: 'them', speaking: true, speechStartedAt: 3500 });
  final(q, '如果平');
  assert.equal(q.resolveForSubmit().text, '达到100%的恢复率是不是牺牲了什么?');
});

test('explicit switch phrase retires the previous target', () => {
  const q = new QuestionResolver();
  final(q, '为什么用 Function Call？');
  final(q, '换个问题，Redis 为什么快？');
  assert.equal(q.resolveForSubmit().text, 'Redis 为什么快?');
});

test('question classification handles resume/project interview phrasing', () => {
  for (const text of [
    '为什么用 RAG？',
    'MDS 分包编码具体怎么恢复？',
    '介绍一下 RepoPilot 的检索链路',
    '如果平均生存概率一样，还需要动态规划吗？'
  ]) assert.equal(isLikelyCompleteQuestion(text), true, text);

  for (const text of ['如果平', '为什么用', '还有一个问题']) {
    assert.equal(isLikelyIncompleteFragment(text), true, text);
  }
  assert.equal(isLikelySupplement('比如图片会变模糊，或者需要发更多图。'), true);
});

test('one ASR final keeps complete questions but holds back a trailing unfinished clause', () => {
  const q = new QuestionResolver();
  final(q, '项目是你独立完成的，还是团队合作？你具体负责了哪一部分？在这个过程');
  const resolved = q.resolveForSubmit();
  assert.equal(resolved.text, '项目是你独立完成的,还是团队合作?你具体负责了哪一部分?');
  assert.equal(resolved.pendingText, '在这个过程');
});

test('same-final pending tail can be completed by the next ASR final', () => {
  const q = new QuestionResolver();
  final(q, '项目是你独立完成的，还是团队合作？你具体负责了哪一部分？在这个过程');
  final(q, '中你遇到的最大困难是什么？');
  const resolved = q.resolveForSubmit();
  assert.match(resolved.text, /项目是你独立完成的,还是团队合作\?/);
  assert.match(resolved.text, /在这个过程中你遇到的最大困难是什么\?/);
  assert.equal(resolved.pendingText, '');
});

test('interim with complete questions plus a partial tail also excludes the tail from answer target', () => {
  const q = new QuestionResolver();
  interim(q, '项目是你独立完成的，还是团队合作？你具体负责了哪一部分？在这个过程');
  const resolved = q.resolveForSubmit();
  assert.equal(resolved.text, '项目是你独立完成的,还是团队合作?你具体负责了哪一部分?');
  assert.equal(resolved.pendingText, '在这个过程');
  assert.equal(resolved.provisional, true);
});

test('long scenario keeps several declarative ASR segments before the final question', () => {
  const q = new QuestionResolver();
  final(q, '假设我们有一个订单服务,用 Redis 缓存库存。');
  final(q, '多个订单请求会同时到达,数据库是唯一事实来源。');
  final(q, '还要求不能超卖,并且允许缓存短暂不一致。');
  final(q, '如何设计库存扣减并保证幂等？');
  const text = q.resolveForSubmit().text;
  for (const constraint of ['订单服务', '唯一事实来源', '不能超卖', '缓存短暂不一致', '库存扣减', '幂等']) assert.ok(text.includes(constraint), constraint);
});

test('long pause inside the same scenario does not discard the previous question or constraints', () => {
  const q = new QuestionResolver({ newQuestionGapMs: 1000 });
  final(q, 'Redis 缓存库存时如何避免超卖？');
  q.speechState({ channel: 'them', speaking: false, speechEndedAt: 1000 });
  q.speechState({ channel: 'them', speaking: true, speechStartedAt: 5500 });
  final(q, '如果这个请求需要重试,你怎么保证幂等？');
  assert.match(q.resolveForSubmit().text, /避免超卖[\s\S]*请求需要重试[\s\S]*保证幂等/);
});

test('many short segments in a long question retain its first requirement', () => {
  const q = new QuestionResolver();
  final(q, '如何设计订单服务？');
  for (let i = 0; i < 16; i++) final(q, `另外第${i + 1}个问题,怎么处理场景${i + 1}？`);
  assert.match(q.resolveForSubmit().text, /^如何设计订单服务/);
  assert.match(q.resolveForSubmit().text, /场景16/);
});

test('bare incomplete interim is not a target and its completed final remains available', () => {
  const q = new QuestionResolver();
  interim(q, '如果平', { sourceId: 'qwen', utteranceKey: 'partial:1' });
  const forced = q.resolveForSubmit({ allowPartial: true });
  assert.equal(forced.text, '');
  assert.equal(forced.pendingText, '如果平');
  q.markSubmitted(forced);
  final(q, '如果平均每张图的生存概率都一样,还需要动态规划吗？', { sourceId: 'qwen', utteranceKey: 'partial:1' });
  assert.match(q.resolveForSubmit().text, /还需要动态规划/);
});

test('an unrelated topic does not inherit pending scenario setup', () => {
  const q = new QuestionResolver();
  final(q, '假设我们正在用 Redis 缓存订单状态,数据库作为事实来源。');
  final(q, '什么是 TCP 三次握手？');
  assert.equal(q.resolveForSubmit().text, '什么是 TCP 三次握手?');
});

test('a final constraint after the main question is included without waiting for another question', () => {
  const q = new QuestionResolver();
  final(q, '如何设计库存扣减？');
  final(q, '要求不能超卖,并且数据库必须作为唯一事实来源。');
  assert.match(q.resolveForSubmit({ allowPartial: true }).text, /库存扣减[\s\S]*不能超卖[\s\S]*唯一事实来源/);
});

test('submitting the complete question retains an unsubmitted tail for its next ASR final', () => {
  const q = new QuestionResolver();
  final(q, '你具体负责哪一部分？在这个过程');
  q.markSubmitted(q.resolveForSubmit({ allowPartial: true }));
  final(q, '中遇到的最大困难是什么？');
  assert.equal(q.resolveForSubmit().text, '在这个过程中遇到的最大困难是什么?');
});

test('new recognized speech during generation survives submission of the frozen old snapshot', () => {
  const q = new QuestionResolver();
  final(q, '如何设计订单服务？');
  const snapshot = q.resolveForSubmit();
  final(q, '另外,你怎么保证幂等？');
  q.markSubmitted(snapshot);
  assert.equal(q.resolveForSubmit().text, '另外,你怎么保证幂等?');
});

test('a substantive example after a question in the same final belongs to that question', () => {
  const q = new QuestionResolver();
  final(q, '恢复率是不是牺牲了什么？比如图片变得肉眼可见的模糊,或者需要发特别多张图。');
  const snapshot = q.resolveForSubmit();
  assert.match(snapshot.text, /比如图片变得肉眼可见的模糊/);
  assert.equal(snapshot.pendingText, '');
  q.markSubmitted(snapshot);
  assert.equal(q.resolveForSubmit().text, '');
});

test('a 500ms VAD pause does not glue an independent latest question to the old target', () => {
  const q = new QuestionResolver();
  final(q, 'Redis 的持久化机制是什么？');
  q.speechState({ channel: 'them', speaking: false, speechEndedAt: 1000 });
  q.speechState({ channel: 'them', speaking: true, speechStartedAt: 1500 });
  final(q, '你在 CAE 项目具体负责什么？');
  assert.equal(q.resolveForSubmit().text, '你在 CAE 项目具体负责什么?');
});

for (const isFinal of [false, true]) {
  for (const corrected of ['不是缓存，我问的是团队分工。', '我说的是团队分工', '先不聊缓存，讲团队分工']) {
    test(`${isFinal ? 'final' : 'interim'} explicit correction replaces the old target: ${corrected}`, () => {
      const q = new QuestionResolver();
      final(q, 'Redis 的持久化机制是什么？');
      q.observe({ channel: 'them', text: corrected }, isFinal);
      assert.equal(q.resolveForSubmit({ allowPartial: true }).text, corrected.replaceAll('，', ','));
      assert.doesNotMatch(q.resolveForSubmit().text, /持久化/);
    });
  }
}

test('short meaningful interim is answerable while filler cannot overwrite it', () => {
  const q = new QuestionResolver();
  final(q, '订单缓存怎么实现？');
  interim(q, '团队分工呢');
  assert.equal(q.resolveForSubmit({ allowPartial: true }).text, '团队分工呢');
  interim(q, '嗯');
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
  interim(q, '为什么不用 Kafka');
  assert.equal(q.resolveForSubmit({ allowPartial: true }).text, '为什么不用 Kafka');
});

test('an announced new question with no target blocks implicit replay of an older question', () => {
  const q = new QuestionResolver();
  final(q, '订单缓存怎么实现？');
  q.speechState({ channel: 'them', speaking: false, speechEndedAt: 1000 });
  q.speechState({ channel: 'them', speaking: true, speechStartedAt: 1500 });
  interim(q, '另外一个问题……');
  const snapshot = q.resolveForSubmit({ allowPartial: true });
  assert.equal(snapshot.text, '');
  assert.equal(snapshot.awaitingNewQuestion, true);
  assert.equal(snapshot.reason, 'awaiting-new-question');
  final(q, '你在项目中负责什么？');
  assert.equal(q.resolveForSubmit().text, '你在项目中负责什么?');
});

test('unfinished same-question example keeps the confirmed current subject', () => {
  const q = new QuestionResolver();
  final(q, '订单缓存怎么实现？');
  interim(q, '比如……');
  const snapshot = q.resolveForSubmit({ allowPartial: true });
  assert.equal(snapshot.text, '订单缓存怎么实现?');
  assert.equal(snapshot.awaitingNewQuestion, false);
});

test('scenario constraints and all same-question subquestions survive multiple finals', () => {
  const q = new QuestionResolver();
  final(q, '在库存不能超卖、数据库不能扩容的条件下');
  final(q, '怎么设计？');
  final(q, '为什么？');
  final(q, '失败如何恢复？');
  final(q, '同时要求最多重试 3 次，不允许丢单。');
  const text = q.resolveForSubmit().text;
  for (const part of ['不能超卖', '不能扩容', '怎么设计', '为什么', '失败如何恢复', '最多重试 3 次', '不允许丢单']) assert.ok(text.includes(part), part);
});

test('a new constrained scenario retires an older unrelated target without dropping its own setup', () => {
  const q = new QuestionResolver();
  final(q, '如何解释哈希冲突？');
  final(q, '在库存不能超卖、数据库不能扩容的条件下');
  final(q, '怎么设计？');
  const text = q.resolveForSubmit().text;
  assert.match(text, /不能超卖[\s\S]*不能扩容[\s\S]*怎么设计/);
  assert.doesNotMatch(text, /哈希冲突/);
});

test('same-key newer final revision replaces its original text even when shorter', () => {
  const q = new QuestionResolver();
  final(q, '为什么选择进程内缓存以及 Redis 缓存？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1, revision: 1 });
  const before = q.resolveForSubmit();
  final(q, '为什么不用 Redis？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1, revision: 2 });
  const after = q.resolveForSubmit();
  assert.equal(after.text, '为什么不用 Redis?');
  assert.equal(after.questionId, before.questionId);
  assert.ok(after.revision > before.revision);
  final(q, '为什么选择进程内缓存以及 Redis 缓存？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1, revision: 1 });
  assert.equal(q.resolveForSubmit().text, after.text);
});

test('same-key final can be shorter than its interim without losing current focus', () => {
  const q = new QuestionResolver();
  interim(q, '你在项目中具体负责哪些模块和团队的协作工作？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const before = q.resolveForSubmit();
  final(q, '你负责哪些模块？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const after = q.resolveForSubmit();
  assert.equal(after.text, '你负责哪些模块?');
  assert.equal(after.questionId, before.questionId);
  assert.equal(after.status, 'ready');
});

test('duplicate utterance events do not advance target revision', () => {
  const q = new QuestionResolver();
  final(q, '团队如何分工？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const before = q.resolveForSubmit();
  final(q, '团队如何分工？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  assert.equal(q.resolveForSubmit().revision, before.revision);
});

test('a delayed lower-order final cannot steal focus from the latest interim', () => {
  const q = new QuestionResolver();
  interim(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  interim(q, '团队分工呢', { sourceId: 'asr', utteranceKey: 'u2', utteranceOrder: 2 });
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('orders are scoped to their source and never compared across providers', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？', { sourceId: 'first', utteranceKey: 'a', utteranceOrder: 100 });
  final(q, '团队分工呢', { sourceId: 'second', utteranceKey: 'b', utteranceOrder: 1 });
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('source reconnect retires old-session results even when the old final arrives later', () => {
  const q = new QuestionResolver();
  interim(q, '缓存如何实现？', { sourceId: 'asr', sourceSessionId: 'old', utteranceKey: 'u1', utteranceOrder: 100 });
  final(q, '团队分工呢', { sourceId: 'asr', sourceSessionId: 'new', utteranceKey: 'u1', utteranceOrder: 1 });
  const before = q.resolveForSubmit();
  final(q, '缓存如何实现？', { sourceId: 'asr', sourceSessionId: 'old', utteranceKey: 'u2', utteranceOrder: 101 });
  assert.equal(q.resolveForSubmit().text, before.text);
  assert.deepEqual(q.resolveForSubmit().sourceKeys, ['asr@new:u1']);
});

test('known older key without reliable order cannot regain focus after a newer utterance', () => {
  const q = new QuestionResolver();
  interim(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'old' });
  final(q, '团队分工呢', { sourceId: 'asr', utteranceKey: 'new' });
  final(q, '缓存到底如何实现？', { sourceId: 'asr', utteranceKey: 'old' });
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('frozen snapshot and source identity remain immutable as ASR continues', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const frozen = q.resolveForSubmit();
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.sourceKeys));
  assert.throws(() => { frozen.text = '变更'; }, TypeError);
  frozen.keys.add('poison');
  assert.deepEqual(frozen.sourceKeys, ['asr:u1']);
  final(q, '团队分工呢', { sourceId: 'asr', utteranceKey: 'u2', utteranceOrder: 2 });
  assert.equal(frozen.text, '缓存如何实现?');
  assert.notEqual(q.resolveForSubmit().questionId, frozen.questionId);
});

test('claim consumes only the frozen target and later completion cannot consume a newer target', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？');
  const claimed = q.claim(q.resolveForSubmit(), 'generation-a');
  assert.equal(claimed.status, 'claimed');
  assert.equal(q.resolveForSubmit().text, '');
  final(q, '团队分工呢');
  q.settle(claimed, 'completed');
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('a frozen old snapshot cannot consume a newer identical-text utterance by string coincidence', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const frozen = q.resolveForSubmit();
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u2', utteranceOrder: 2 });
  q.claim(frozen, 'generation-a');
  assert.equal(q.resolveForSubmit().text, '缓存如何实现?');
  assert.deepEqual(q.resolveForSubmit().sourceKeys, ['asr:u2']);
});

test('explicit failed-snapshot retry stays bound to the failed target without consuming newer speech', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？');
  const claimed = q.claim(q.resolveForSubmit(), 'generation-a');
  q.settle(claimed, 'failed');
  final(q, '团队分工呢');
  const retry = q.retrySnapshot();
  assert.equal(retry.text, claimed.text);
  assert.equal(retry.questionId, claimed.questionId);
  assert.ok(retry.revision > claimed.revision);
  q.claim(retry, 'generation-retry');
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('manual snapshot wins and its claim retires only older ASR focus', () => {
  const q = new QuestionResolver();
  interim(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const manual = q.manualSnapshot('请解释线程隔离');
  assert.equal(manual.source, 'manual');
  q.claim(manual, 'manual-generation');
  assert.equal(q.resolveForSubmit().text, '');
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  assert.equal(q.resolveForSubmit().text, '');
});

test('speech arriving between manual freezing and claim remains available', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？', { sourceId: 'asr', utteranceKey: 'u1', utteranceOrder: 1 });
  const manual = q.manualSnapshot('请解释线程隔离');
  final(q, '团队分工呢', { sourceId: 'asr', utteranceKey: 'u2', utteranceOrder: 2 });
  q.claim(manual, 'manual-generation');
  assert.equal(q.resolveForSubmit().text, '团队分工呢');
});

test('referential follow-up keeps only a bounded question reference rather than the old task', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？');
  const claimed = q.claim(q.resolveForSubmit(), 'generation-a');
  q.settle(claimed, 'completed');
  final(q, '为什么这样做？');
  const snapshot = q.resolveForSubmit();
  assert.equal(snapshot.text, '为什么这样做?');
  assert.equal(snapshot.referenceContext, '缓存如何实现?');
});

test('reset epoch invalidates old claims and source identity', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？');
  const frozen = q.resolveForSubmit();
  q.reset({ epoch: 77 });
  assert.equal(q.claim(frozen, 'old-generation'), null);
  assert.equal(q.resolveForSubmit().epoch, 77);
  assert.equal(q.retrySnapshot(), null);
});

test('preview never mutates the target identity and repeated claims are deduplicated', () => {
  const q = new QuestionResolver();
  final(q, '缓存如何实现？');
  const frozen = q.resolveForSubmit();
  const preview = q.previewForPrefetch();
  assert.equal(preview.questionId, frozen.questionId);
  assert.equal(preview.revision, frozen.revision);
  assert.deepEqual(preview.sourceKeys, frozen.sourceKeys);
  assert.ok(q.claim(frozen, 'generation-a'));
  assert.equal(q.claim(frozen, 'generation-b'), null);
});

test('long current question is preserved in full rather than silently middle-clipped', () => {
  const q = new QuestionResolver();
  const text = '在不能丢数据的条件下,' + '必须核验版本和幂等键。'.repeat(1100) + '怎么设计？为什么？失败如何恢复？';
  final(q, text);
  assert.equal(q.resolveForSubmit().text, text.replaceAll('？', '?'));
});

test('source/event and claimed-snapshot state stays bounded during a long session', () => {
  let now = 1000;
  const q = new QuestionResolver({ now: () => now });
  for (let i = 0; i < 500; i++) {
    now += 1000;
    final(q, `第${i}个场景如何处理？`, { sourceId: 'asr', utteranceKey: `u${i}`, utteranceOrder: i });
    const claim = q.claim(q.resolveForSubmit(), `generation-${i}`);
    q.settle(claim, 'completed');
  }
  assert.ok(q.events.size <= 80);
  assert.ok(q.claims.size <= 8);
  assert.ok(q.highWater.size <= 16);
  assert.equal(q.resolveForSubmit().text, '');
});

for (const text of [
  '给定一个整数数组，请用 Java 实现两数之和，返回下标，不能重复使用同一个元素。',
  '请用 Java 实现二叉树的中序递归遍历。',
  '请用 Java 实现一个整数加法函数。'
]) test(`a complete code imperative without a question mark is a target: ${text}`, () => {
  const q = new QuestionResolver();
  final(q, text);
  assert.equal(q.resolveForSubmit().text, text.replaceAll('，', ','));
});

test('manual snapshot preserves fullwidth punctuation and multiline code verbatim', () => {
  const q = new QuestionResolver();
  const text = '请实现：\n```java\n  return Ａ＋Ｂ;\n```\n不许改动参数：Ａ。';
  assert.equal(q.manualSnapshot('  ' + text + '  ').text, text);
});
