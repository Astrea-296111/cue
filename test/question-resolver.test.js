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

test('short-pause complete questions are accumulated in order', () => {
  const q = new QuestionResolver({ newQuestionGapMs: 2800 });
  final(q, '为什么用 Function Call？');
  final(q, '为什么用 React 框架？');
  assert.equal(q.resolveForSubmit().text, '为什么用 Function Call?\n为什么用 React 框架?');
});

test('noise after two questions cannot become the answer target', () => {
  const q = new QuestionResolver();
  final(q, '为什么用 Function Call？');
  final(q, '为什么用 React 框架？');
  final(q, 'ops');
  assert.equal(q.resolveForSubmit().text, '为什么用 Function Call?\n为什么用 React 框架?');
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

test('forced partial interim can be followed by its completed final using the same utterance key', () => {
  const q = new QuestionResolver();
  interim(q, '如果平', { sourceId: 'qwen', utteranceKey: 'partial:1' });
  const forced = q.resolveForSubmit({ allowPartial: true });
  assert.equal(forced.text, '如果平');
  assert.equal(forced.partial, true);
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
