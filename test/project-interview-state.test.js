'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectInterviewState } = require('../src/project-interview-state');
const { planInterviewQuestion } = require('../src/interview-question-planner');
const source = (text, extras = {}) => ({ sourceType: 'imported', projectId: 'repo', path: 'README.md', startLine: 1, endLine: 1, text, ...extras });
const request = id => ({ id, question: '假设QPS提升十倍，为什么选择Redis？', interviewPlan: planInterviewQuestion({ text: '为什么选择Redis？' }) });

test('architecture and reasons retain source references and never become generated assistant facts', () => {
  const state = new ProjectInterviewState({ project: 'RepoPilot', scopes: ['@project:repo'] });
  state.setSourceRevision('index-v1', 'manual-v1');
  state.commit(request(1), [source('项目使用 MySQL。项目选择 Redis，因为要降低数据库压力。'),
    source('使用 Kafka，因为吞吐提高。', { origin: 'assistant', symbol: 'InventedService', startLine: 2, endLine: 2 }),
    source('使用 RabbitMQ，因为是旧项目组件。', { projectId: 'tcs', startLine: 3, endLine: 3 })]);
  const view = state.snapshot();
  assert.equal(view.architecture.database[0].technology, 'MySQL');
  assert.equal(view.architecture.cache[0].technology, 'Redis');
  assert.equal(view.architecture.mq, undefined);
  assert.equal(view.decisions.length, 1, 'MySQL cannot borrow a reason from the Redis statement');
  assert.equal(view.decisions[0].technology, 'Redis');
  assert.ok(view.evidence.some(e => view.decisions[0].sourceRefs.includes(e.id)));
  assert.doesNotMatch(JSON.stringify(view), /吞吐提高|旧项目组件|InventedService/);
});

test('hypothetical, rejected, partial and English negative choices are not actual architecture', () => {
  for (const text of ['如果使用 Redis，可能会降低数据库压力。', '我们不使用 Redis。', '目前并非使用 Redis。', 'We do not use Redis.', "We don't use Redis.", 'We could use Redis.', 'We would choose Redis.']) {
    const state = new ProjectInterviewState({ project: 'RepoPilot', scopes: ['@project:repo'] });
    state.commit(request(1), [source(text)]);
    assert.deepEqual(state.snapshot().architecture, {}, text);
  }
  const state = new ProjectInterviewState({ project: 'RepoPilot', scopes: ['@project:repo'] });
  state.commit(request(1), [source('We use Redis because it reduces database load.', { partial: true })]);
  assert.deepEqual(state.snapshot().architecture, {});
});

test('reimport invalidates source facts while discussion topics survive, and manual changes invalidate only manual facts', () => {
  const state = new ProjectInterviewState({ project: 'RepoPilot', scopes: ['@project:repo'] });
  state.setSourceRevision('index-1', 'manual-1');
  state.commit(request(1), [source('项目使用 MySQL。'), { sourceType: 'manual', path: 'settings.projectKnowledge',
    startLine: 1, endLine: 1, text: '选择 Redis，因为减少数据库压力。', scopes: ['@project:repo'] }]);
  state.setSourceRevision('index-2', 'manual-1');
  assert.equal(state.snapshot().architecture.database, undefined);
  assert.equal(state.snapshot().architecture.cache[0].technology, 'Redis');
  assert.ok(state.snapshot().discussedTopics.includes('Redis'));
  state.setSourceRevision('index-2', 'manual-2');
  assert.deepEqual(state.snapshot().architecture, {});
});

test('state bounds evidence and topics and rejects older direct updates', () => {
  const state = new ProjectInterviewState({ project: 'RepoPilot', scopes: ['@project:repo'] });
  for (let i = 1; i <= 100; i++) state.commit(request(i), [source('项目使用 Redis，因为减少数据库压力。', { startLine: i, endLine: i })]);
  assert.ok(state.snapshot().evidence.length <= 24);
  assert.equal(state.commit(request(2), [source('使用 Kafka。')]), false);
  assert.equal(state.snapshot().architecture.mq, undefined);
});
