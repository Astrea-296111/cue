'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationMemory } = require('../src/conversation-memory');
const { planInterviewQuestion } = require('../src/interview-question-planner');
const { formatInterviewChecklist } = require('../src/interview-checklist');
const catalog = [{ name: 'RepoPilot', prefix: 'RepoPilot/', aliases: ['RepoPilot'] }, { name: 'TCS', prefix: 'TCS/', aliases: ['TCS'] }];
const stopped = { complete: true, truncated: false, finishReason: 'stop' };
const question = '假设 RepoPilot 的QPS提升十倍，如何扩容？为什么不用分库分表？Redis挂了怎么办？';
function begin(memory, text, extras = {}) {
  return memory.begin({ mode: 'say', question: text, catalog,
    interviewPlan: planInterviewQuestion({ text, ...extras }), ...extras });
}

test('only an actually answered subject is covered, even after a natural model stop', () => {
  const memory = new ConversationMemory();
  const request = begin(memory, question);
  memory.commit(request, 'Redis故障时通过熔断限流降级到数据库回源，恢复后逐步预热缓存，避免数据库过载。', { completion: stopped });
  const rows = memory.checklist.view().questions;
  assert.deepEqual(rows.map(q => q.status), ['unknown', 'unknown', 'covered']);
  assert.ok(rows[2].answerEvidence.includes('Redis'));
  assert.equal(memory.getInterviewState().unresolvedTopics.length, 2);
});

test('normal completion, missing completion, refusal and truncation cannot automatically cover every question', () => {
  for (const [answer, completion] of [
    [question, stopped], ['不知道，缺少项目实现证据。', stopped],
    ['1. 采用水平扩容和读写分离，因为瓶颈在吞吐。', { complete: false, truncated: true, finishReason: 'length' }],
    ['1. 采用水平扩容和读写分离，因为瓶颈在吞吐。', undefined]
  ]) {
    const memory = new ConversationMemory(), request = begin(memory, question);
    memory.commit(request, answer, { completion });
    assert.ok(memory.checklist.view().questions.every(q => q.status === 'unknown'));
  }
});

test('same-topic omitted questions can be supplemented, but a new project and generic interlude stay isolated', () => {
  const memory = new ConversationMemory();
  memory.commit(begin(memory, question), '1. 水平扩容无状态服务，并拆分计算任务提高吞吐。\n2. 不采用分库分表，因为跨分片事务和维护成本过高。', { completion: stopped });
  const next = begin(memory, '第三个问题呢？');
  assert.equal(next.checklist.pending.length, 1);
  assert.match(next.checklist.pending[0].text, /Redis/);
  memory.commit(next, 'Redis故障时通过熔断限流降级回源，并逐步预热恢复后的缓存。', { completion: stopped });
  assert.equal(begin(memory, '继续解释这个方案。').checklist.pending.some(q => /Redis/.test(q.text)), false);
  const switched = begin(memory, '介绍 TCS 项目？');
  assert.equal(switched.checklist.pending.length, 0);
  assert.doesNotMatch(JSON.stringify(switched.projectInterviewState), /RepoPilot/);
  memory.commit(switched, 'TCS 是源码材料中的隐写项目。', { completion: stopped });
  const generic = begin(memory, 'Redis为什么快？');
  assert.equal(generic.projectInterviewState, null);
  assert.equal(generic.checklist.pending.length, 0);
});

test('failed requests remain asked, reliable partial refinement never becomes prematurely covered', () => {
  const memory = new ConversationMemory();
  const partial = begin(memory, '如果平', { partial: true, sourceKey: 'local:42' });
  memory.commit(partial, '使用容错和重试降低风险。', { completion: stopped });
  assert.equal(memory.checklist.view().questions[0].status, 'unknown');
  const complete = begin(memory, '如果平台压缩，你怎么恢复？', { sourceKey: 'local:42' });
  assert.equal(complete.checklist.questions.length, 1);
  assert.equal(complete.checklist.questions[0].partial, false);
  assert.equal(memory.checklist.stats().storedQuestions, 1);
  const failed = begin(memory, '为什么这样设计？');
  assert.equal(memory.checklist.view().questions.some(q => q.current), false);
  assert.ok(memory.checklist.view().questions.some(q => q.text === failed.question && q.status === 'pending'));
});

test('latest request, reset, skipped topics and screen edit replacement preserve transaction boundaries', () => {
  const memory = new ConversationMemory();
  const old = begin(memory, '介绍 RepoPilot 项目？');
  const latest = begin(memory, '介绍 TCS 项目？');
  assert.equal(memory.commit(old, '旧答案', { completion: stopped }), false);
  assert.equal(memory.commit(latest, '有效答案', { completion: stopped }), true);
  assert.equal(memory.commit(latest, '重复答案', { completion: stopped }), false);
  assert.match(memory.activeProjectPlan.label, /TCS/);
  memory.reset();
  assert.equal(memory.commit(latest, '迟到答案'), false);
  assert.equal(memory.checklist.stats().storedQuestions, 0);
  const edit = memory.begin({ mode: 'assist', question: '改成迭代法实现', catalog });
  memory.commit(edit, '请看改后的代码。');
  const explanation = memory.begin({ mode: 'assist', question: '这段代码复杂度是多少？', catalog });
  assert.equal(explanation.checklist.pending.length, 0);
  const screen = memory.begin({ mode: 'leetcode', question: '请解决当前屏幕上的技术题', catalog });
  assert.equal(screen.checklist, null);
});

test('checklist bounds long sessions and formats complete items within the prompt budget', () => {
  const memory = new ConversationMemory();
  for (let i = 0; i < 300; i++) begin(memory, `独立问题${i}怎么实现？`);
  assert.ok(memory.checklist.stats().storedQuestions <= 256);
  assert.ok(memory.checklist.stats().threadCount <= 48);
  const checklist = { questions: [{ current: true, text: '短问题怎么实现？' }, { current: false, status: 'unknown', text: '长'.repeat(300) }] };
  const prompt = formatInterviewChecklist(checklist, { maxChars: 150 });
  assert.ok(prompt.length <= 150);
  assert.match(prompt, /短问题怎么实现/);
  assert.doesNotMatch(prompt, /长/);
});
