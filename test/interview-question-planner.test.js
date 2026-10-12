'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planInterviewQuestion } = require('../src/interview-question-planner');

for (const text of [
  '假设订单系统QPS提升10倍，你怎么优化？为什么不用分库分表？Redis挂了怎么办？',
  'Suppose order traffic grows tenfold. How would you scale it? Why not shard the database? What happens if Redis fails?'
]) {
  test('scenario keeps exact ordered source spans: ' + text.slice(0, 30), () => {
    const plan = planInterviewQuestion({ text });
    assert.equal(plan.type, 'scenario');
    assert.equal(plan.originalText, text);
    assert.equal(plan.subQuestions.length, 3);
    assert.ok(plan.scenario);
    assert.equal(new Set(plan.subQuestions.map(q => q.id)).size, 3);
    for (const question of plan.subQuestions) assert.equal(text.slice(question.start, question.end), question.text);
    assert.deepEqual(plan.subQuestions.map(q => q.id), planInterviewQuestion({ text }).subQuestions.map(q => q.id));
    assert.equal(plan.subQuestions[2].intent, 'failure');
  });
}

test('setup and constraints stay separate from actual questions without dropping their original text', () => {
  const text = '订单缓存使用Redis。要求不能超卖，并且不能丢订单。必须保留方法签名。如何扣减库存？怎么保证幂等？';
  const plan = planInterviewQuestion({ text });
  assert.equal(plan.subQuestions.length, 2);
  assert.ok(plan.constraints.some(constraint => constraint.includes('不能丢订单')));
  assert.ok(plan.constraints.some(constraint => constraint.includes('保留方法签名')));
  assert.equal(plan.originalText, text);
});

test('reliable partial source IDs survive completion while missing provenance does not invent a link', () => {
  const partial = planInterviewQuestion({ text: '如果平', partial: true, sourceKey: 'local:utterance-42' });
  const complete = planInterviewQuestion({ text: '如果平台再次压缩，你怎么恢复？', sourceKey: 'local:utterance-42' });
  assert.equal(partial.partial, true);
  assert.equal(partial.originalText, '如果平');
  assert.equal(partial.subQuestions[0].text, '如果平');
  assert.equal(partial.subQuestions[0].id, complete.subQuestions[0].id);
  assert.notEqual(partial.subQuestions[0].id, planInterviewQuestion({ text: '如果平台再次压缩，你怎么恢复？' }).subQuestions[0].id);
});

test('Function Call and React stay two ordered asks and code editing remains a valid target', () => {
  const plan = planInterviewQuestion({ text: '为什么用 Function Call？为什么用 React？' });
  assert.equal(plan.subQuestions.length, 2);
  assert.deepEqual(plan.subQuestions.map(q => q.topics[0]), ['Function Call', 'React']);
  const edit = planInterviewQuestion({ text: '改成迭代法实现，保留中序顺序。', mode: 'assist' });
  assert.match(edit.mainQuestion, /改成迭代/);
  assert.ok(edit.constraints.some(q => q.includes('保留中序')));
});

test('large question lists remain bounded and report omissions while keeping the source', () => {
  const text = Array.from({ length: 70 }, (_, i) => `第${i + 1}个问题怎么实现？`).join('\n');
  const plan = planInterviewQuestion({ text });
  assert.equal(plan.subQuestions.length, 32);
  assert.equal(plan.omittedQuestions, 38);
  assert.equal(plan.originalText, text);
});
