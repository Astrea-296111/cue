'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectRagSession, retrievalIdentity } = require('../src/project-rag-session');
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (question = '项目甲如何重试？', extras = {}) => ({ question, epoch: 1,
  projectRevision: 'snapshot-a', modelVersion: 'e5-a', sourceKey: 'asr:1', questionVersion: question,
  projectPlan: { retrieve: true, scopes: ['@project:a'] }, contextBudget: 3600, ...extras });

test('prefetch identity binds full corrected text and every session/source/model version', () => {
  const base = input();
  for (const patch of [{ question: '项目甲没有重试，如何处理？' }, { epoch: 2 },
    { projectRevision: 'snapshot-b' }, { modelVersion: 'e5-b' }, { sourceKey: 'asr:2' },
    { questionVersion: 'correction' }, { hashFallback: false }, { projectPlan: { retrieve: true, scopes: ['@project:b'] } }]) {
    assert.notEqual(retrievalIdentity(base), retrievalIdentity({ ...base, ...patch }));
  }
});

test('one running task and newest pending task discard old interim work and late results', async () => {
  const starts = [], resolves = [];
  const session = new ProjectRagSession({ retrieve: request => {
    starts.push(request);
    return new Promise(resolve => resolves.push(resolve));
  } });
  session.schedule(input('初稿'), { immediate: true });
  session.schedule(input('中间稿'), { immediate: true });
  session.schedule(input('纠正后的完整问题'), { immediate: true });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].signal.aborted, true);
  resolves.shift()({ evidence: ['过时来源'] });
  await tick();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].question, '纠正后的完整问题');
  assert.equal(session.take(input('初稿')), null);
  resolves.shift()({ evidence: ['当前来源'] });
  await tick();
  assert.deepEqual(session.take(input('纠正后的完整问题')), { evidence: ['当前来源'] });
  session.reset();
});

test('clear, project switch and reimport reject delayed results without changing formal state', async () => {
  let resolve, currentEpoch = 1;
  const session = new ProjectRagSession({ retrieve: () => new Promise(done => { resolve = done; }),
    isCurrent: request => request.epoch === currentEpoch });
  session.schedule(input(), { immediate: true });
  currentEpoch++;
  session.reset();
  resolve({ evidence: ['old'] });
  await tick();
  assert.equal(session.take(input()), null);
  assert.equal(session.slots.size, 0);
  assert.equal(session.results.size, 0);
  assert.equal(session.schedule(input('通用 Redis', { projectPlan: { retrieve: false, scopes: [] } })), false);
});
