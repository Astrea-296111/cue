'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { createEvidenceRuntime, CASES, FIXTURES } = require('./helpers/realtime-evidence-runtime');
const { RETRIEVAL_CONFIG_VERSION } = require('../src/project-prefetch-policy');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const [index, item] of CASES.entries()) test(`source replay ${index + 1} ${item.split}: ${item.project} ${item.question}`, async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', item.project + '的缓存如何实现？');
  r.answer('本轮只依据已提供的来源解释实现、选择、职责、验证与限制。');
  await r.ask('say', item.project + '的' + item.question);
  assert.equal(r.calls.length, 2, 'one generation per answer');
  const sent = r.sdkText(), event = r.evidence();
  if (item.missing) {
    assert.ok(event.missing.length, 'unknown personal/history facts stay missing');
    assert.equal(r.metrics().retrieval.poolSufficientHit, false);
  } else for (const fact of item.facts) assert.ok(sent.includes(item.prefix + '_' + fact), fact);
  for (const source of event.sources) {
    assert.ok(sent.includes(source.text));
    assert.ok(source.projectName === item.project);
    const original = fs.readFileSync(path.join(FIXTURES, item.prefix === 'PINE' ? 'pine' : 'stellar', source.path), 'utf8');
    const located = original.replace(/\r\n?/g, '\n').split('\n').slice(source.startLine - 1, source.endLine).join('\n');
    assert.ok(located.includes(source.text.trim()), 'reported lines contain the exact source excerpt');
  }
  assert.ok(!event.sources.some(source => source.text.includes(item.prefix === 'PINE' ? 'STELLAR_' : 'PINE_')));
});

test('paraphrased follow-up uses current canonical sources and skips full-project retrieval', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  await r.ask('say', '松塔订单的缓存版本校验具体如何实现？');
  assert.equal(r.metrics().retrieval.retrievalPath, 'pool-covered');
  assert.equal(r.metrics().retrieval.searchCalls, 0);
  assert.match(r.sdkText(), /PINE_CACHE/);
});

test('approved old semantic scores cannot approve a new entity, state or negative premise', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  r.value(`for (const entry of activeProjectContextCache.entries.values()) for (const source of entry.evidence) {
    source.relevanceApproved = true; source.channels = ['semantic', 'exact']; source.confidence = 1; source.questionIds = [];
  }`);
  for (const question of ['松塔订单为什么不用 Redis？', '松塔订单的 Kafka 缓存如何实现？', '松塔订单的 CLOSED_FINAL 状态如何实现？']) {
    await r.ask('say', question);
    assert.equal(r.metrics().retrieval.poolSufficientHit, false);
    assert.ok(r.metrics().retrieval.searchCalls > 0);
  }
});

test('implementation-only pool supplements ownership and collaboration instead of claiming coverage', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  r.value(`for (const entry of activeProjectContextCache.entries.values()) {
    entry.evidence = entry.evidence.filter(source => source.docType === 'implementation'); delete entry.search;
  }`);
  await r.ask('say', '松塔订单的缓存是你和同事分别负责什么、如何协作？');
  assert.ok(r.metrics().retrieval.searchCalls > 0);
  assert.match(r.sdkText(), /PINE_OWNERSHIP/); assert.match(r.sdkText(), /PINE_COLLABORATION/);
});

test('completed exact prefetch reaches SDK with zero new search or query embedding', async t => {
  let embeddings = 0;
  const r = await createEvidenceRuntime(t, { semanticRetriever: { status: () => ({ modelVersion: 'controlled' }),
    queryCandidates: async () => { embeddings++; return { rows: [], reason: 'fixture' }; }, resetSession() {} } });
  const question = '松塔订单的缓存如何实现？';
  r.final(question, { sourceId: 'meeting', utteranceKey: 'u1' });
  for (let i = 0; i < 12; i++) await tick();
  const before = embeddings;
  await r.shortcut('CommandOrControl+Return');
  assert.equal(r.metrics().retrieval.exactPrefetchHit, true);
  assert.equal(r.metrics().retrieval.searchCalls, 0);
  assert.equal(embeddings, before);
  assert.match(r.sdkText(), /PINE_CACHE/);
});

test('background can finish a 350ms semantic query while fast foreground never waits for it', async t => {
  let deadlineBudget = 0, calls = 0;
  const r = await createEvidenceRuntime(t, { semanticRetriever: { status: () => ({ modelVersion: 'delayed' }),
    queryCandidates: async request => {
      calls++; deadlineBudget = request.deadlineAt - r.value('Date.now()');
      await new Promise(resolve => setTimeout(resolve, 350));
      return { rows: [], reason: 'fixture-done' };
    }, resetSession() {} } });
  r.final('松塔订单的缓存怎么实现？');
  await tick();
  const started = performance.now();
  await r.shortcut('CommandOrControl+Return');
  assert.ok(performance.now() - started < 250);
  assert.equal(calls, 1); assert.ok(deadlineBudget > 300 && deadlineBudget <= 1000);
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.ok(r.value('ragSession.results.size') > 0);
  assert.equal(r.calls.length, 1, 'late sources do not regenerate the answer');
});

test('multi-final ASR preview keeps scenario and source keys without committing a question', async t => {
  const r = await createEvidenceRuntime(t);
  r.final('松塔订单的缓存如何实现？', { sourceId: 'meeting', utteranceKey: 'one' });
  r.final('同时要求保留原来的 TTL，不能改成新的时长。', { sourceId: 'meeting', utteranceKey: 'two' });
  assert.equal(r.value('conversation.recent.length'), 0);
  const preview = r.snapshot('questionResolver.previewForPrefetch()');
  assert.match(preview.text, /缓存/); assert.match(preview.text, /TTL/);
  await r.shortcut('CommandOrControl+Return');
  assert.match(r.sdkText(), /不能改成新的时长/);
  assert.match(r.requests.at(-1).interviewPlan.sourceKey, /one/);
  assert.match(r.requests.at(-1).interviewPlan.sourceKey, /two/);
});

test('source budget and final SDK trimming cannot turn partial evidence into complete coverage', async t => {
  const r = await createEvidenceRuntime(t, { settings: { contextWindowTokens: 2048 } });
  await r.ask('say', '松塔订单的缓存如何实现？为什么这样选？你和同事分别负责什么？测试指标和环境是什么？');
  const event = r.evidence(), sent = r.sdkText();
  assert.ok(event?.missing.length || r.events.some(e => e.channel === 'llm:error'));
  for (const source of r.commits.at(-1)?.config.evidence || []) assert.ok(sent.includes(source.text));
  assert.ok(r.snapshot('conversation.checklist.view().questions').some(q => q.status !== 'covered'));
});

test('fast cold index is explicit, never synchronously built; async warm restores source retrieval', async t => {
  const r = createInterviewRuntime(t, { coldIndex: true });
  const knowledge = r.exports('src/project-knowledge.js');
  // Catalog read during startup is outside the formal path; postings remain cold.
  knowledge.getProjectCatalog();
  const search = r.exports('src/project-search.js').ProjectSearch;
  const original = search.build;
  search.build = () => { throw new Error('unexpected synchronous cold build'); };
  await r.ask('say', 'RepoPilot 的检索缓存如何实现？');
  const line = r.logs.find(a => String(a[0]).startsWith('[latency][prompt] '))[0];
  assert.equal(JSON.parse(line.slice(18)).retrieval.retrievalPath, 'index-not-ready');
  search.build = original;
  await knowledge.warmProjectIndex();
  await r.ask('say', 'RepoPilot 的检索缓存如何实现？');
  assert.match(JSON.stringify(r.calls.at(-1)), /REPO_RETRIEVAL/);
});

test('a project question without a known material identity asks for clarification', async t => {
  const r = createInterviewRuntime(t, { coldIndex: true });
  r.answer('缓存读取由当前版本实现，失效后重新加载并校验版本。');
  await r.ask('say', '介绍松塔订单项目的缓存如何实现？');
  const event = r.events.findLast(e => e.channel === 'llm:evidence');
  assert.equal(event.sources.length, 0);
  assert.equal(r.requests.at(-1).plan.kind,'unresolved');
  assert.match(JSON.stringify(r.calls[0]), /项目不明确/);
  assert.ok(r.snapshot('conversation.checklist.view().questions').every(question => question.status !== 'covered'));
});

test('external published clear invalidates ready snapshots, cache and pending source ownership', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  const knowledge = r.exports('src/project-knowledge.js'), before = knowledge.getProjectIndexRevision({ preparedOnly: true });
  const {ProjectMaterialService}=require('../src/project-material-service');
  const external=new ProjectMaterialService({directory:r.temp,bundled:r.snapshot('materialService.snapshot.facts')});
  await external.clearSources();
  await knowledge.refreshProjectIndex();
  assert.notEqual(knowledge.getProjectIndexRevision({ preparedOnly: true }), before);
  assert.equal(r.value('activeProjectContextCache.entries.size'), 0);
});

test('same-scope model/config entries coexist, while settings toggles clear incompatible work', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  const cache = r.value('activeProjectContextCache'), entry = [...cache.entries.values()][0];
  cache.put(entry.scopes, entry.revision, entry.evidence, { modelVersion: 'another-model', retrievalConfigVersion: RETRIEVAL_CONFIG_VERSION });
  assert.equal(cache.entries.size, 2);
  await r.invoke('settings:set', { smart: true });
  assert.equal(cache.entries.size, 2, 'ordinary answer-mode switching keeps isolated raw-source pools');
  await r.invoke('settings:set', { smart: false });
  await r.invoke('settings:set', { realtimeEvidencePrefetch: false });
  assert.equal(cache.entries.size, 0);
  await r.ask('say', '松塔订单的缓存如何实现？');
  assert.match(r.sdkText(), /PINE_CACHE/);
  assert.equal(r.metrics().retrieval.poolSufficientHit, false);
});

test('related-source predictions run after the first body token without becoming questions or answers', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  const questions = r.snapshot('conversation.checklist.view().questions').map(q => q.text);
  r.value(`for (const entry of activeProjectContextCache.entries.values()) {
    entry.evidence = entry.evidence.filter(source => source.docType === 'implementation'); delete entry.search;
  }`);
  for (let i = 0; i < 50 && !r.value('ragSession.metrics.completed'); i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(r.value('ragSession.metrics.started') >= 1);
  assert.ok(r.value(`[...activeProjectContextCache.entries.values()].some(entry => entry.evidence.some(source => source.docType === 'decision'))`));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.snapshot('conversation.checklist.view().questions').map(q => q.text), questions);
  assert.equal(r.value('conversation.recent.length'), 1);
  assert.ok(!JSON.stringify(r.logs).includes('PINE_CACHE'));
});

test('a new generic request prevents a previously queued project prediction from restarting work', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  await r.ask('say', 'Redis 的 RDB 和 AOF 原理是什么？');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(r.value('ragSession.predictions.length'), 0);
  assert.equal(r.value('ragSession.running'), null);
  assert.doesNotMatch(r.sdkText(), /PINE_CACHE/);
});

test('model-window pruning revokes a sufficient pool hit and preserves missing state', async t => {
  const r = await createEvidenceRuntime(t);
  const question = '松塔订单的缓存如何实现？为什么选择这个缓存方案？本人负责什么？';
  await r.ask('say', question);
  await r.invoke('settings:set', { contextWindowTokens: 4096 });
  await r.ask('say', question);
  assert.ok(r.metrics().finalBudget.droppedEvidence > 0);
  assert.equal(r.metrics().retrieval.poolSufficientHit, false);
  assert.ok(r.evidence().missing.some(gap => gap.reason === 'final_request_budget'));
  assert.ok(r.snapshot('conversation.checklist.view().questions').some(q => q.status !== 'covered'));
});

test('explicit two-project comparison retains independently scoped facts', async t => {
  const r = await createEvidenceRuntime(t);
  await r.ask('say', '松塔订单的缓存如何实现？');
  await r.ask('say', '星桥调度的缓存如何实现？');
  await r.ask('say', '对比松塔订单和星桥调度，松塔订单为什么选择 Redis？星桥调度为什么选择 MySQL？');
  assert.match(r.sdkText(), /PINE_DECISION/); assert.match(r.sdkText(), /STELLAR_DECISION/);
  assert.ok(r.evidence().sources.some(s => s.projectName === '松塔订单'));
  assert.ok(r.evidence().sources.some(s => s.projectName === '星桥调度'));
});

test('reimport rejects delayed old-revision work and never restores removed sources', async t => {
  let release;
  const r = await createEvidenceRuntime(t, { semanticRetriever: { status: () => ({ modelVersion: 'controlled' }), resetSession() {},
    queryCandidates: () => new Promise(resolve => { release = resolve; }) } });
  r.final('松塔订单的缓存如何实现？'); await tick();
  const knowledge = r.exports('src/project-knowledge.js');
  const {ProjectMaterialService}=require('../src/project-material-service');
  const external=new ProjectMaterialService({directory:r.temp,bundled:r.snapshot('materialService.snapshot.facts')});
  const index=JSON.parse(JSON.stringify(external.snapshot.sources));
  index.chunks = index.chunks.filter(source => source.projectId !== 'synthetic-pine');
  index.projects = index.projects.filter(project => project.id !== 'synthetic-pine');
  await external.publishSource(index);
  await knowledge.refreshProjectIndex(); await knowledge.warmProjectIndex();
  release({ rows: [], reason: 'old' }); await tick();
  assert.equal(r.value('ragSession.results.size'), 0); assert.equal(r.value('activeProjectContextCache.entries.size'), 0);
  await r.ask('say', '星桥调度的缓存如何实现？');
  assert.doesNotMatch(r.sdkText(), /PINE_CACHE/);
});
