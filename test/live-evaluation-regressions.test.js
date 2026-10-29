'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isolateUnknownProject } = require('../src/instant-answer-policy');
const { isClearProjectExit } = require('../src/project-query');
const { planProjectEvidence } = require('../src/project-evidence-policy');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { fixture } = require('./helpers/material-fixture');

const catalog = [{ id: 'arclight', name: 'Arclight', aliases: [] }, { id: 'cae', name: 'CAE', aliases: [] }];
function resolved(question) {
  const start = question.indexOf('Arclight');
  return { projectIds: ['arclight'], scopes: ['@project:arclight'], activeProject: 'arclight', projectLabel: 'Arclight',
    projectMentions: start < 0 ? [] : [{ start, end: start + 'Arclight'.length, excluded: false }], subQuestionScopes: [] };
}
test('known project generic descriptions remain resolved while distinct unknown names and conjunctions stay isolated', () => {
  for (const question of ['你在 Arclight 个人实验项目负责哪些部分？', 'Arclight个人开源项目的职责是什么？', '介绍一下 Arclight 的练习项目。',
    '沿Arclight继续：一个共享平台承接两个项目，现在项目甲已启动，负责人要求在项目内核对，资源不能借给项目乙。不要把岗位要求当成项目已有功能。',
    'Arclight 的一个普通项目成员换成了另一个项目的任务，两个项目的权限边界不能混用。']) {
    assert.deepEqual(isolateUnknownProject(question, resolved(question), catalog).projectIds, ['arclight'], question);
  }
  for (const question of ['Arclight 和 Orion 项目各有什么职责？', 'Arclight 的背景不重要，Orion 项目做什么？',
    'Arclight，还有个人实验项目负责什么？', 'Arclight SuperUnknown项目介绍', 'Arclight 和 天枢平台项目怎样对比？',
    'Arclight之外，名为星河的数据平台项目如何恢复？', 'Arclight和“星河的数据平台”项目如何恢复？']) {
    const plan = isolateUnknownProject(question, resolved(question), catalog);
    assert.deepEqual(plan.projectIds, [], question); assert.deepEqual(plan.scopes, [], question);
  }
  assert.equal(isClearProjectExit('离开这两个项目，单独解释事务与至少一次消息。'), true);
  assert.equal(isClearProjectExit('不用引用个人项目经历，讨论一般的幂等原理。'), true);
});

test('real instant and standard session retain Arclight generic-description ownership and its follow-up', async t => {
  for (const mode of ['instant', 'standard']) {
    const runtime = createInterviewRuntime(t, { chunks: [], settings: { realtimeAnswerMode: mode,
      sourceRagPolicies: { instant: 'off', standard: 'off' }, manualProjectKnowledgeEnabled: false } });
    const preview = await runtime.invoke('materials:prepare', { index: fixture(), mode: 'replace-all' });
    await runtime.invoke('materials:commit', preview);
    await runtime.ask('say', '你在 Arclight 个人实验项目负责哪些部分？');
    await runtime.ask('say', '那这个项目有几位同事？');
    for (const request of runtime.requests) assert.deepEqual(request.plan.projectIds, ['arclight']);
    assert.ok(runtime.events.filter(event => event.channel === 'llm:materials').every(event =>
      event.sentFactIds.every(id => id.startsWith('arclight.'))));
  }
});

test('standard source evidence survives a full fact-card candidate list without breaking count, token, scope or off limits', () => {
  const facts = Array.from({ length: 12 }, (_, index) => ({ id: 'cae.fact-' + index, projectId: 'cae',
    sourceType: 'project-pack', path: 'facts.json', docType: 'overview', text: 'A documented fact ' + index }));
  const source = { id: 'cae-source', projectId: 'cae', sourceType: 'imported', path: 'src/outbox.js', text: 'function dispatch(eventId) { return deduplicate(eventId); }' };
  const note = { id: 'manual-note', projectId: 'cae', sourceType: 'manual', path: 'settings.projectKnowledge', text: 'A manual note.' };
  const foreign = { ...source, id: 'arclight-source', projectId: 'arclight' };
  const config = { question: 'CAE Outbox 和 Inbox 如何避免重复？', resolution: { kind: 'resolved', canonicalProjectIds: ['cae'],
    scopes: ['@project:cae'], retrieveFacts: true, retrieveSources: true }, facts, sources: [note, foreign, source],
    sourcePolicy: 'standard', maxSources: 7, evidenceTokens: 2800 };
  const plan = planProjectEvidence(config);
  assert.equal(plan.evidence.length, 7);
  assert.ok(plan.evidence.some(item => item.id === source.id));
  assert.ok(!plan.evidence.some(item => item.id === foreign.id));
  assert.ok(plan.estimatedTokens <= 2800);
  const tiny = planProjectEvidence({ ...config, maxSources: 2, evidenceTokens: 80 });
  assert.ok(tiny.evidence.length <= 2 && tiny.estimatedTokens <= 80);
  const off = planProjectEvidence({ ...config, sourcePolicy: 'off' });
  assert.ok(!off.evidence.some(item => item.sourceType === 'imported'));
  const general = planProjectEvidence({ ...config, resolution: { kind: 'general' } });
  assert.equal(general.evidence.length, 0);
});

test('identical same-scope evidence is deduplicated without merging distinct provenance or versions',()=>{
  const item={id:'one',projectId:'cae',sourceType:'project-pack',path:'facts.json',docType:'overview',provenance:'USER',status:'source-claim',applicableVersion:'v1',text:'相同的背景。'};
  const plan=planProjectEvidence({question:'介绍 CAE',resolution:{kind:'resolved',canonicalProjectIds:['cae'],retrieveFacts:true},facts:[item,{...item,id:'two'},{...item,id:'other-origin',provenance:'CODE'},{...item,id:'other-version',applicableVersion:'v2'}],maxSources:8,evidenceTokens:3000});
  assert.deepEqual(plan.evidence.map(x=>x.id),['one','other-origin','other-version']);
  assert.ok(plan.dropped.some(x=>x.id==='two'&&x.reason==='duplicate'));
});
