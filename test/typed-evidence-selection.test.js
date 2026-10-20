'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectEvidence, formatEvidenceBlock } = require('../src/evidence-selector');
const { fuseCandidates, groupQuestions } = require('../src/retrieval-coordinator');
const { ActiveProjectContextCache } = require('../src/active-project-context-cache');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');

// Synthetic sources, unrelated to the user's private project/role materials.
const scopes = ['@project:p'];
const source = (id, docType, text, extra = {}) => ({ id, projectId: 'p', projectName: '合成项目',
  sourceType: 'imported', path: id + '.md', startLine: 1, endLine: text.split('\n').length,
  startOffset: 0, endOffset: text.length, text, docType, docTypeDeclared: true,
  truthScope: 'implemented', status: 'confirmed', score: .04, relevanceApproved: true, ...extra });
const question = (id, text, types, extra = {}) => ({ id, text, evidenceNeeds: types.map(type => ({ type })), ...extra });

test('README/code mentions cannot stand in for real incidents, ownership, or measured performance', () => {
  const plan = { subQuestions: [question('q1', '真实线上事故是什么？', ['incident']),
    question('q2', '本人负责什么？', ['ownership']), question('q3', '线上延迟多少？', ['performance'])] };
  const result = selectEvidence({ candidates: [source('readme', 'overview', 'Redis 重试支持项目架构。'),
    source('code', 'implementation', 'try { retry(); } catch(error) { fallback(); }')],
  interviewPlan: plan, projectPlan: { scopes }, contextBudget: 4000 });
  assert.equal(result.evidence.length, 0);
  assert.deepEqual(result.missing.map(item => item.type), ['incident', 'ownership', 'performance']);
});

test('confirmed metadata cannot turn a negative incident, team-only role, or planned component into facts', () => {
  const candidates = [source('incident', 'incident', '没有发生过线上故障；没有真实事故。'),
    source('team', 'ownership', '团队负责整体交付，个人职责尚未确认。'),
    source('planned', 'implementation', '未来计划采用 Kafka。', { truthScope: 'planned' }),
    source('measurement', 'performance', 'Mock 测试 p95 为 30 ms，单机 4 核。', { truthScope: 'test_only' })];
  const interviewPlan = { subQuestions: [question('event', '发生过什么线上事故？', ['incident']),
    question('role', '你本人负责什么？', ['ownership']), question('code', '已经采用 Kafka 吗？', ['implementation']),
    question('perf', '线上真实延迟是多少？', ['performance'])] };
  const result = selectEvidence({ candidates, interviewPlan, projectPlan: { scopes }, contextBudget: 5000 });
  assert.equal(result.evidence.length, 0);
  assert.equal(result.missing.length, 4);
});

test('explicit named personal responsibility remains usable and keeps its team boundary', () => {
  const text = '合成人物小林只负责资源准入；前端由其他成员完成。团队交付不代表个人负责全部。';
  const result = selectEvidence({ candidates: [source('personal', 'ownership', text)],
    interviewPlan: { subQuestions: [question('role', '你个人负责哪些模块？', ['ownership'])] }, projectPlan: { scopes } });
  assert.equal(result.missing.length, 0);
  assert.equal(result.evidence[0].text, text);
});

test('comparison allocates a source to both scopes and generic subquestions inject no project facts', () => {
  const result = selectEvidence({ candidates: [source('p-choice', 'decision', 'P 因为需要事务所以选择 MySQL。'),
    source('other-choice', 'decision', 'Q 因为允许过期所以选择 Redis。', { projectId: 'q', score: .001 })],
  interviewPlan: { subQuestions: [question('compare', '两个项目的选型为什么不同？', ['decision']),
    question('generic', 'Redis 为什么快？', ['general_knowledge'])] },
  projectPlan: { scopes: ['@project:p', '@project:q'], subQuestionScopes: [
    { questionId: 'compare', scopes: ['@project:p', '@project:q'] }, { questionId: 'generic', scopes: [], reason: 'generic-question' }] } });
  assert.deepEqual(result.byQuestion[0].sourceRefs.sort(), ['other-choice', 'p-choice']);
  assert.deepEqual(result.byQuestion[1].sourceRefs, []);
  assert.deepEqual(result.byQuestion[1].missing, []);
});

test('full parents replace duplicate children, while insufficient budget reports missing without clipping a result', () => {
  const raw = '困难是重试丢失任务身份。\n本人增加稳定任务 ID。\n验证结果：旧任务不再提交。';
  const child = source('child', 'challenge', raw.split('\n')[0], { path: 'parent.md', parentId: 'parent', score: .03 });
  const parent = source('parent', 'challenge', raw, { fullParent: true, score: .04 });
  const interviewPlan = { subQuestions: [{ ...question('q', '困难怎么解决并验证？', ['challenge']),
    evidenceNeeds: [{ type: 'challenge', requires: ['personal_action', 'verification'] }] }] };
  const good = selectEvidence({ candidates: [child, parent], interviewPlan, projectPlan: { scopes } });
  assert.deepEqual(good.evidence.map(item => item.id), ['parent']);
  assert.equal(good.evidence[0].text, raw);
  const small = selectEvidence({ candidates: [parent], interviewPlan, projectPlan: { scopes },
    contextBudget: formatEvidenceBlock(parent).length - 1 });
  assert.equal(small.evidence.length, 0);
  assert.equal(small.missing[0].reason, 'budget-or-visibility');
});

test('RRF uses ranks, admits semantic-only candidates and replaces hash votes when learned inference is available', () => {
  const a = source('a', 'decision', '本地为满足资源上限采用租约。');
  const b = source('b', 'decision', 'The design bounds admission through an expiring ownership record.');
  const base = { channels: { bm25: [{ chunk: a, score: 100000, confidence: .9 }],
    hash: [{ chunk: a, score: .98 }, { chunk: b, score: .97 }], exact: [] } };
  const fused = fuseCandidates(base, { rows: [{ chunk: b, score: .78 }] }, scopes);
  assert.ok(fused.every(item => !item.channels.includes('hash')));
  assert.ok(Math.abs(fused[0].score - fused[1].score) < 1e-10);
  const selected = selectEvidence({ candidates: fused, interviewPlan: { subQuestions: [question('q', '选用这种方式的理由？', ['decision'])] }, projectPlan: { scopes } });
  assert.ok(selected.evidence.some(item => item.id === 'b'));
  const learnedEmpty = fuseCandidates(base, { rows: [] }, scopes);
  assert.deepEqual(learnedEmpty.map(item => item.id), ['a']);
});

test('group limit preserves an unretrieved tail question and its typed need', () => {
  const subQuestions = Array.from({ length: 5 }, (_, i) => question('q' + i, '第' + i + '个独立问题？', ['decision']));
  const result = groupQuestions('完整原问', { subQuestions }, { scopes });
  assert.equal(result.groups.length, 4);
  assert.equal(result.missing[0].text, subQuestions[4].text);
  assert.equal(result.missing[0].reason, 'group-limit');
});

test('source cache model/config identity invalidates and never truncates a factual tail', () => {
  const cache = new ActiveProjectContextCache({ maxChars: 150 });
  const large = source('large', 'challenge', '长背景'.repeat(80) + '验证完成');
  cache.put(scopes, 'r1', [large, source('short', 'decision', '选择事务，因为需要原子性。')], { modelVersion: 'm1', retrievalConfigVersion: 'c1' });
  assert.equal(cache.get(scopes, 'r1', { modelVersion: 'm2', retrievalConfigVersion: 'c1' }), null);
  const cached = cache.get(scopes, 'r1', { modelVersion: 'm1', retrievalConfigVersion: 'c1' });
  assert.deepEqual(cached.evidence.map(item => item.id), ['short']);
});

test('formal learned hits resolve to canonical imported source text before SDK messages', async t => {
  const raw = 'LOCAL_CANONICAL 原因是需要限制资源预算，因此选择可过期的租约。';
  const chunks = [{ path: '远帆/decision.md', startLine: 1, endLine: 1, text: raw,
    docType: 'decision', truthScope: 'implemented', status: 'confirmed' }];
  const semanticRetriever = { status: () => ({ ready: true, modelVersion: 'fixture-learned' }),
    queryCandidates: async () => ({ rows: [{ id: 0, score: .9, chunk: { ...chunks[0], projectId: 'fixture-远帆', text: 'FABRICATED_DATA' } }] }),
    invalidate() {}, close() {} };
  const app = createInterviewRuntime(t, { chunks, semanticRetriever });
  await app.ask('say', '远帆项目为什么选择这种租约？');
  const actual = JSON.stringify(app.calls.at(-1).messages);
  assert.match(actual, /LOCAL_CANONICAL/);
  assert.doesNotMatch(actual, /FABRICATED_DATA/);
});

test('deep-mode semantic timeout aborts inference and still sends the base facts to the SDK', async t => {
  let signal;
  const semanticRetriever = { status: () => ({ ready: true, modelVersion: 'fixture-slow' }),
    queryCandidates: request => { signal = request.signal; return new Promise(() => {}); }, invalidate() {}, close() {} };
  const app = createInterviewRuntime(t, { semanticRetriever,
    settings: { smart: true, models: { custom: { smart: 'test-model' } } } });
  const start = performance.now();
  await app.ask('say', 'RepoPilot 项目为什么使用 LangGraph？');
  assert.ok(performance.now() - start < 600, 'a hung semantic worker must not hold the answer request');
  assert.ok(signal.aborted);
  assert.equal(app.calls.length, 1);
  assert.match(app.logs.join('\n'), /semantic-timeout/);
});

test('unlabeled legacy STAR remains unassigned during project-specific retrieval', async t => {
  const app = createInterviewRuntime(t, { settings: { starStories: 'UNASSIGNED_STORY 本人解决了一次图片压缩事故并验证恢复。' } });
  await app.ask('say', 'RepoPilot 项目的最大困难是什么？');
  assert.doesNotMatch(JSON.stringify(app.calls.at(-1).messages), /UNASSIGNED_STORY/);
});
