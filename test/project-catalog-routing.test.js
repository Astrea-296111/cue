'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectCatalog } = require('../src/project-scope');
const { resolveResumeProject, resolveProjectMentions } = require('../src/resume-project-resolver');
const { planProjectRetrieval, scopeInterviewQuestions } = require('../src/project-query');
const { planInterviewQuestion } = require('../src/interview-question-planner');
const { ProjectInterviewState } = require('../src/project-interview-state');

// Synthetic projects share technologies; names, ordinals and facts are fixtures.
const projects = [
  { id: 'synthetic-b', name: '队列乙', aliases: ['QueueBeta'], resumeOrder: 2, sourceRevision: 'beta-v1', hasManifest: true },
  { id: 'synthetic-a', name: '任务甲', aliases: ['JobAlpha'], resumeOrder: 1, sourceRevision: 'alpha-v1', hasManifest: true }
];
const catalog = buildProjectCatalog({ projects });
const turn = text => [{ channel: 'them', text }];
const route = (text, options = {}) => planProjectRetrieval(turn(text), 'say', { catalog, ...options });

test('manifest catalog routing uses explicit resume order rather than import order or legacy projects', () => {
  assert.equal(resolveResumeProject('介绍第一个项目', catalog).projectId, 'synthetic-a');
  assert.equal(resolveResumeProject('关于第二个，你的agent项目。这个项目最难在哪里？', catalog).projectId, 'synthetic-b');
  assert.equal(resolveResumeProject('the second project', catalog).projectId, 'synthetic-b');
  assert.deepEqual(route('讲讲第二个项目').scopes, ['@project:synthetic-b']);
  assert.equal(resolveResumeProject('第三个项目', catalog), null, 'missing ordinal cannot silently use FlashFlow');
  assert.equal(resolveResumeProject('agent项目', catalog), null, 'unconfigured legacy synonym cannot steal a manifest identity');
  assert.equal(resolveResumeProject('第2个问题怎么实现？', catalog), null);
});

test('aliases retain exact source positions and English boundaries across repeated mentions', () => {
  const text = 'JobAlphaExtra 并非项目；ＪｏｂＡｌｐｈａ 是第一个项目。JobAlpha 如何重试？';
  const mentions = resolveProjectMentions(text, catalog).filter(mention => mention.kind === 'name');
  assert.equal(mentions.length, 2);
  assert.equal(text.slice(mentions[0].start, mentions[0].end), 'ＪｏｂＡｌｐｈａ');
  assert.equal(text.slice(mentions[1].start, mentions[1].end), 'JobAlpha');
  assert.equal(route('JobAlphaExtra 是什么？').retrieve, false);
});

test('a correction excludes the rejected project while preserving source mention ranges', () => {
  const text = '不是任务甲，我问的是队列乙，这个项目为什么不用 Redis？';
  const plan = route(text, { interviewPlan: planInterviewQuestion({ text }) });
  assert.deepEqual(plan.scopes, ['@project:synthetic-b']);
  assert.deepEqual(plan.subQuestionScopes[0].scopes, ['@project:synthetic-b']);
  assert.equal(plan.projectMentions.find(mention => mention.name === '任务甲').excluded, true);
  assert.equal(resolveResumeProject(text, catalog).projectId, 'synthetic-b');
});

test('explicit project switch overrides a manual default and subsequent follow-up retains the explicit project', () => {
  const initial = route('这个项目怎么实现重试？', { currentProjectId: 'synthetic-a' });
  assert.deepEqual(initial.scopes, ['@project:synthetic-a']);
  const switched = route('队列乙这个项目最难在哪里？', { previousPlan: initial, currentProjectId: 'synthetic-a' });
  assert.deepEqual(switched.scopes, ['@project:synthetic-b']);
  assert.equal(switched.projectSwitched, true);
  const followup = route('那为什么这样设计？', { previousPlan: switched, currentProjectId: 'synthetic-a' });
  assert.deepEqual(followup.scopes, ['@project:synthetic-b']);
  const chosen = route('这个项目怎么重试？', { previousPlan: followup, currentProjectId: 'synthetic-a', manualProjectChanged: true });
  assert.deepEqual(chosen.scopes, ['@project:synthetic-a']);
});

test('manual defaults still pause on generic Redis and explicit project return recovers the confirmed thread', () => {
  const initial = route('介绍队列乙', { currentProjectId: 'synthetic-a' });
  const generic = route('Redis 支持哪些数据类型？', { previousPlan: initial, currentProjectId: 'synthetic-a' });
  assert.equal(generic.retrieve, false);
  assert.equal(generic.projectActive, false);
  const pronoun = route('只有五种吗？', { previousPlan: generic, currentProjectId: 'synthetic-a' });
  assert.equal(pronoun.retrieve, false);
  const returned = route('回到刚才那个项目，你为什么选择 MySQL？', { previousPlan: pronoun, currentProjectId: 'synthetic-a' });
  assert.deepEqual(returned.scopes, ['@project:synthetic-b']);
});

test('explicit generic discourse cues detach arbitrary technologies without losing the project thread', () => {
  const initial = route('介绍队列乙的实现');
  for (const text of ['单独问 RabbitMQ 为什么至少一次会重复？', '不结合这个项目，解释一下消息投递语义？',
    '从一般原理角度，为什么需要租约？', '不结合队列乙项目，讲讲消息一致性？', 'In general, why can a lease expire?']) {
    const generic = route(text, { previousPlan: initial });
    assert.equal(generic.retrieve, false, text);
    assert.deepEqual(generic.scopes, [], text);
    const following = route('那如何处理呢？', { previousPlan: generic });
    assert.equal(following.retrieve, false, text);
    assert.deepEqual(route('回到刚才那个项目，租约怎么实现？', { previousPlan: following }).scopes, ['@project:synthetic-b']);
  }
  assert.deepEqual(route('单独问任务甲为什么用 MySQL？', { previousPlan: initial }).scopes, ['@project:synthetic-a'],
    'an explicitly named project remains a project question');
  assert.deepEqual(route('不聊技术，我们只问这个项目最大的困难？', { previousPlan: initial }).scopes, ['@project:synthetic-b'],
    'a constraint on technical detail does not detach a project experience question');
});

test('routing sees tail project mentions after a long interviewer setup', () => {
  const text = '先说明约束。'.repeat(400) + '讲讲队列乙这个项目为什么选择 MySQL？';
  const plan = route(text);
  assert.deepEqual(plan.scopes, ['@project:synthetic-b']);
  assert.equal(plan.question, text);
  assert.ok(plan.query.endsWith('为什么选择 MySQL？'));
  assert.ok(plan.projectMentions[0].start > 1200);
});

test('each question binds its own project while generic principles remain outside project scope', () => {
  const text = '任务甲为什么选 MySQL？队列乙如何实现重试？Redis 支持哪些数据类型？';
  const interviewPlan = planInterviewQuestion({ text });
  const plan = route(text, { interviewPlan });
  assert.deepEqual(plan.scopes, ['@project:synthetic-a', '@project:synthetic-b']);
  assert.deepEqual(plan.subQuestionScopes.map(question => question.scopes), [
    ['@project:synthetic-a'], ['@project:synthetic-b'], []
  ]);
  assert.equal(plan.subQuestionScopes[2].reason, 'generic-question');
});

test('names in a scenario heading bind later question spans, and explicit comparisons stay scoped to both projects', () => {
  const text = '接下来聊队列乙。假设流量翻倍，怎么保证幂等？为什么不选 Redis？';
  const interviewPlan = planInterviewQuestion({ text });
  const plan = route(text, { interviewPlan });
  assert.ok(plan.subQuestionScopes.every(question => question.scopes.length === 1 && question.scopes[0] === '@project:synthetic-b'));
  const compare = '比较任务甲和队列乙的重试实现有什么不同？';
  const comparison = planInterviewQuestion({ text: compare });
  assert.deepEqual(route(compare, { interviewPlan: comparison }).subQuestionScopes[0].scopes,
    ['@project:synthetic-a', '@project:synthetic-b']);
});

test('multi-intent evidence needs preserve typed decision, source, difficulty, metrics and personal/team requirements', () => {
  const text = '这个项目为什么选 MySQL，具体如何实现缓存？最大的困难是什么，你负责什么，团队怎么协作？QPS 和延迟提升多少？';
  const plan = planInterviewQuestion({ text });
  const types = new Set(plan.subQuestions.flatMap(question => question.evidenceNeeds.map(need => need.type)));
  for (const type of ['decision', 'implementation', 'challenge', 'ownership', 'collaboration', 'performance', 'environment']) assert.ok(types.has(type), type);
  const ownership = plan.subQuestions.flatMap(question => question.evidenceNeeds).find(need => need.type === 'ownership');
  assert.deepEqual(ownership.docTypes, ['ownership']);
  assert.ok(ownership.requires.includes('explicit_personal_contribution'));
  const generic = planInterviewQuestion({ text: 'Redis 为什么快？' });
  assert.deepEqual(generic.subQuestions[0].evidenceNeeds.map(need => need.type), ['general_knowledge']);
  assert.deepEqual(generic.subQuestions[0].evidenceNeeds[0].truthScopes, ['general_knowledge']);
});

test('hypothetical failures request current baseline without pretending a real incident happened', () => {
  const plan = planInterviewQuestion({ text: '假设 Redis 挂了，如何恢复？' });
  const needs = plan.subQuestions[0].evidenceNeeds;
  assert.ok(needs.find(need => need.type === 'implementation').requires.includes('implemented_baseline'));
  assert.equal(needs.find(need => need.type === 'incident').hypothetical, true);
  assert.equal(needs.find(need => need.type === 'hypothetical').hypothetical, true);
});

test('source location is implementation while current adoption and abandoned choices stay conservatively typed', () => {
  const location = planInterviewQuestion({ text: '定位项目的资源准入实现，给出接口和调用链？' });
  assert.deepEqual(location.subQuestions[0].evidenceNeeds.map(need => need.type), ['implementation']);
  const adoption = planInterviewQuestion({ text: '这个项目已经采用 Kafka 了吗？' });
  assert.ok(adoption.subQuestions[0].evidenceNeeds.some(need => need.type === 'implementation'));
  const abandoned = planInterviewQuestion({ text: '这个项目曾经放弃哪个方案，为什么？' });
  assert.ok(abandoned.subQuestions[0].evidenceNeeds.find(need => need.type === 'decision').truthScopes.includes('abandoned'));
  const pending = planInterviewQuestion({ text: '哪些设计目前尚未实现？' });
  assert.ok(pending.subQuestions[0].evidenceNeeds.find(need => need.type === 'limitation').truthScopes.includes('planned'));
});

test('architecture and ownership compose, and state/recovery asks request implementation without inventing incidents', () => {
  const architecture = planInterviewQuestion({ text: '介绍项目的架构和你的职责？' });
  const combined = architecture.subQuestions[0].evidenceNeeds;
  assert.ok(combined.find(need => need.type === 'implementation').requires.includes('architecture_components'));
  assert.ok(combined.some(need => need.type === 'ownership'));
  for (const text of ['缓存被清空后，TaskScheduler 中的 CPU 预占依据还存在吗？',
    '为什么结果汇总失败后不能重新启动 EngineRunner？', 'RESULT_FAILED 重试是否保留 executionId？']) {
    const plan = planInterviewQuestion({ text });
    const needs = plan.subQuestions.flatMap(question => question.evidenceNeeds);
    const state = needs.find(need => need.type === 'implementation');
    assert.ok(state.requires.includes('state_transition'), text);
    assert.ok(state.requires.includes('verification'), text);
    assert.equal(needs.some(need => need.type === 'incident'), false, text);
    assert.equal(needs.some(need => need.type === 'context'), false, text);
  }
  const first = route('介绍队列乙');
  assert.equal(route('Redis 为什么快？', { previousPlan: first }).retrieve, false);
});

test('overflow questions retain source spans, tail requirements and tail project identities for explicit missing reports', () => {
  const text = Array.from({ length: 40 }, (_, i) => `第${i + 1}个问题怎么实现重试？`).join('\n') + '\n队列乙的真实故障如何排查？';
  const plan = planInterviewQuestion({ text });
  assert.equal(plan.subQuestions.length, 32);
  assert.equal(plan.omittedSubQuestions.length, 9);
  const last = plan.omittedSubQuestions.at(-1);
  assert.equal(text.slice(last.start, last.end), last.text);
  assert.ok(last.evidenceNeeds.some(need => need.type === 'incident'));
  const routing = route(text, { interviewPlan: plan });
  const scopes = scopeInterviewQuestions(plan, routing, catalog);
  assert.equal(scopes.length, 41);
  assert.deepEqual(scopes[0].scopes, [], 'a future project name must not silently bind earlier ambiguous asks');
  assert.deepEqual(scopes.at(-1).scopes, ['@project:synthetic-b']);
});

test('project state preserves evidence offsets/types and rejects hypothetical metadata as implemented architecture', () => {
  const state = new ProjectInterviewState({ project: '队列乙', scopes: ['@project:synthetic-b'] });
  state.setSourceRevision('beta-v1', 'manual-v1');
  const request = { id: 1, question: '为什么选择 Redis？', interviewPlan: planInterviewQuestion({ text: '为什么选择 Redis？' }) };
  state.commit(request, [{ sourceType: 'imported', projectId: 'synthetic-b', path: 'interview/decision.md', startLine: 10, endLine: 10,
    startOffset: 100, endOffset: 118, text: '项目使用 Redis，因为需要缓存。', docType: 'decision', truthScope: 'hypothetical', status: 'confirmed' }]);
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.architecture, {});
  assert.equal(snapshot.evidence[0].startOffset, 100);
  assert.equal(snapshot.evidence[0].truthScope, 'hypothetical');
  assert.ok(snapshot.currentFocus.sourceRefs.length);
  assert.equal(snapshot.currentEntity, 'Redis');
});
