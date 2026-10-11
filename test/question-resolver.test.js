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
