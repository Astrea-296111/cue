'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createInterviewRuntime, currentText, deferred } = require('./helpers/interview-agent-runtime');
const { createEvidenceRuntime } = require('./helpers/realtime-evidence-runtime');
const { buildInstantContext, InstantContextCards } = require('../src/instant-answer-context');
const { INSTANT_LIMITS, resolveInstantPolicy } = require('../src/instant-answer-policy');
const { estimateTokens } = require('../src/final-request-budget');
const make = (t, options = {}) => createInterviewRuntime(t, { ...options,
  settings: { realtimeAnswerMode: 'instant', ...options.settings } });
const prompt = r => JSON.stringify(r.calls.at(-1)?.messages);
const metric = r => r.events.filter(e => e.channel === 'llm:metrics').at(-1);

test('production defaults instant while screenshot and full code policies keep their own budgets', t => {
  const r = make(t);
  assert.equal(r.exports('src/store.js').getSettings().realtimeAnswerMode, 'instant');
  assert.equal(resolveInstantPolicy({}, 'say', '').instant, true);
  assert.equal(resolveInstantPolicy({}, 'technical', '').instant, false);
  assert.equal(resolveInstantPolicy({}, 'assist', '').instant, false);
  assert.equal(resolveInstantPolicy({}, 'ask', '看看屏幕上的代码').instant, false);
  assert.equal(resolveInstantPolicy({ realtimeAnswerMode: 'standard' }, 'say', '').instant, false);
});

for (const type of ['final', 'interim']) test(`latest ${type} correction replaces Redis and old pending tasks in actual SDK messages`, async t => {
  const r = make(t);
  r.final('Redis 的持久化机制是什么？');
  r.value("questionResolver.speechState({channel:'them',speaking:false})"); r.advance(500);
  r[type]('不是缓存，我问的是团队分工。');
  await r.shortcut('CommandOrControl+Return');
  assert.equal(r.calls.length, 1);
  assert.match(currentText(r.calls[0]), /团队分工/);
  assert.doesNotMatch(currentText(r.calls[0]), /Redis.*持久化|CURRENT_QUESTION[\s\S]*Redis/);
  assert.equal(r.calls[0].messages.filter(m => m.role === 'assistant').length, 0);
  assert.doesNotMatch(prompt(r), /本轮问题清单|同话题仍适用的遗漏/);
});

test('500ms unrelated target and compact meaningful interim win; noise and consumed target never call again', async t => {
  const r = make(t);
  r.final('Redis 的持久化机制是什么？'); r.advance(500);
  r.interim('你在 CAE 项目具体负责什么？');
  await r.ask('say');
  assert.match(currentText(r.calls[0]), /CAE.*负责/);
  assert.doesNotMatch(prompt(r), /Redis.*持久化/);
  r.interim('嗯'); await r.ask('say');
  assert.equal(r.calls.length, 1);
  await r.ask('say'); assert.equal(r.calls.length, 1);
  r.interim('团队分工呢'); await r.ask('say');
  assert.match(currentText(r.calls[1]), /团队分工/);
});

test('same-question multi-final preserves negative/numeric conditions and all subquestions', async t => {
  const r = make(t);
  r.final('现在库存系统不能超卖，数据库不能扩容。');
  r.final('流量达到原来的10倍，在这些条件下怎么设计？为什么？失败如何恢复？');
  await r.ask('say');
  const q = currentText(r.calls[0]);
  for (const term of ['不能超卖', '不能扩容', '10倍', '怎么设计', '为什么', '如何恢复']) assert.ok(q.includes(term), term);
  assert.ok(r.calls[0].max_tokens >= 1000);
  assert.doesNotMatch(q, /中间部分已省略/);
});

test('real publication handles shorter final revision, older ordered final and retired source session', async t => {
  const r = make(t);
  const identity = { sourceId: 'asr', sourceSessionId: 'one', utteranceKey: 'same', utteranceOrder: 7 };
  r.interim('请完整介绍缓存的一致性与失效设计，为什么采用这个方案？', identity);
  r.final('团队分工呢', { ...identity, revision: 1 });
  r.final('不是分工，我问的是你负责什么。', { ...identity, revision: 2 });
  r.final('Redis 的持久化原理是什么？', { sourceId: 'asr', sourceSessionId: 'one', utteranceKey: 'old', utteranceOrder: 6 });
  await r.ask('say');
  assert.match(currentText(r.calls[0]), /负责什么/);
  assert.doesNotMatch(currentText(r.calls[0]), /Redis|完整介绍缓存/);
  r.final('数据库不能扩容时如何优化？', { sourceId: 'asr', sourceSessionId: 'two', utteranceKey: 'new', utteranceOrder: 0 });
  r.final('Redis 如何持久化？', { sourceId: 'asr', sourceSessionId: 'one', utteranceKey: 'late', utteranceOrder: 99 });
  await r.ask('say');
  assert.match(currentText(r.calls[1]), /数据库不能扩容/);
  assert.doesNotMatch(currentText(r.calls[1]), /Redis/);
});

test('new question announcement blocks old target; unfinished example preserves confirmed subject', async t => {
  const r = make(t);
  r.final('Redis 持久化机制是什么？');
  r.value("questionResolver.speechState({channel:'them',speaking:false})");
  r.advance(500); r.interim('另外一个问题……');
  await r.ask('say'); assert.equal(r.calls.length, 0);
  assert.ok(r.events.some(e => e.channel === 'status' && /尚未识别完整/.test(e.message)));
  r.clear(); r.final('缓存如何失效？'); r.interim('比如……');
  await r.ask('say'); assert.equal(r.calls.length, 1);
  assert.match(currentText(r.calls[0]), /缓存如何失效/);
});

test('manual target wins, explicit retry owns its frozen target, and voice does not resurrect it', async t => {
  const r = make(t);
  r.final('Redis 如何持久化？');
  r.answer('', { error: new Error('controlled failure') });
  await r.ask('say', '我手动问：数据库不能扩容，如何优化？');
  assert.match(currentText(r.calls[0]), /我手动问/);
  r.answer('我会先优化查询和索引。');
  await r.invoke('question:retry');
  assert.equal(r.calls.length, 2);
  assert.match(currentText(r.calls[1]), /数据库不能扩容/);
  await r.ask('say'); assert.equal(r.calls.length, 2);
});

test('explicit retry preserves complete technical output mode and the frozen target shown to the user', async t => {
  const r = make(t);
  r.answer('完整函数。');
  await r.ask('technical', '请用 Java 实现二叉树的中序递归遍历。');
  const before = r.calls[0].max_tokens;
  await r.invoke('question:retry');
  assert.equal(r.calls.length, 2);
  assert.equal(r.commits.at(-1).request.mode, 'technical');
  assert.equal(r.calls[1].max_tokens, before);
  assert.ok(before >= 4096);
  assert.match(currentText(r.calls[1]), /中序递归遍历/);
});

test('ASR B updates preview without canceling A; explicit B cancels immediately and rejects every late A event', async t => {
  const r = make(t); const gate = deferred();
  r.behavior(() => (async function* () { await gate.promise;
    yield { choices: [{ delta: { content: 'OLD_LATE_CONTENT' }, finish_reason: 'stop' }], usage: { prompt_tokens: 99999 } };
  })());
  const a = r.ask('say', 'Redis 如何持久化？'); await r.waitForCalls(1);
  const aId = r.events.find(e => e.channel === 'llm:start').requestId;
  r.final('你在 CAE 项目具体负责什么？');
  assert.equal(r.requestOptions[0].signal.aborted, false);
  assert.match((await r.invoke('question:get-target')).snapshot.text, /CAE/);
  r.answer('我会先明确职责边界，再说明交付与协作。');
  await r.ask('say');
  assert.equal(r.calls.length, 2); assert.equal(r.requestOptions[0].signal.aborted, true);
  assert.match(currentText(r.calls[1]), /CAE/); assert.doesNotMatch(currentText(r.calls[1]), /Redis/);
  const lastId = metric(r).requestId;
  gate.resolve(); await a;
  assert.equal(r.events.some(e => e.text?.includes('OLD_LATE_CONTENT')), false);
  assert.equal(r.events.filter(e => e.channel === 'llm:done' && e.requestId === aId).length, 0);
  r.value(`ipcMain.emit('llm:rendered', null, {requestId:${JSON.stringify(aId)},epoch:conversation.epoch,stage:'dom'})`);
  assert.equal(metric(r).requestId, lastId);
  assert.equal(r.value('conversation.recent.length'), 1);
});

test('no material, cold index and a hung semantic prefetch still issue one streamed request', async t => {
  let embeddings = 0;
  const semanticRetriever = { status: () => ({ modelVersion: 'hang' }), queryCandidates() { embeddings++; return new Promise(() => {}); }, resetSession() {} };
  for (const coldIndex of [false, true]) {
    const r = make(t, { coldIndex, semanticRetriever });
    r.final('TCS 项目的缓存怎么设计？');
    await r.ask('say');
    assert.equal(r.calls.length, 1);
    assert.match(prompt(r), /无资料也给具体方案/);
    assert.doesNotMatch(currentText(r.calls[0]), /本轮资料缺口|本轮问题清单/);
    assert.equal(metric(r).ragPolicy, 'ready-only');
  }
  assert.ok(embeddings <= 2, 'only optional background work may query; formal path never waits');
});

test('ready-only never invokes lexical candidates, parent expansion or index disk I/O even when old prefetch flag is off', async t => {
  const r = make(t, { settings: { realtimeEvidencePrefetch: false } }); await r.ready;
  const search = r.exports('src/project-search.js').ProjectSearch.prototype;
  const originalSearch = search.getCandidates, read = fs.readFileSync, stat = fs.statSync;
  search.getCandidates = () => { throw new Error('forbidden foreground search'); };
  fs.readFileSync = () => { throw new Error('forbidden foreground disk read'); };
  fs.statSync = () => { throw new Error('forbidden foreground disk stat'); };
  try { await r.ask('say', 'TCS 项目的缓存如何实现？'); }
  finally { search.getCandidates = originalSearch; fs.readFileSync = read; fs.statSync = stat; }
  assert.equal(r.calls.length, 1);
  assert.equal(r.searches.length, 0);
  assert.match(r.events.find(e => e.channel === 'llm:token').text, /测试答案/);
});

test('standard rollback still performs scoped retrieval; diagnostic off preserves standard prompt/model', async t => {
  const r = make(t, { settings: { realtimeAnswerMode: 'standard' } });
  await r.ask('say', 'RepoPilot 的检索如何实现？');
  assert.ok(r.searches.length > 0);
  assert.match(prompt(r), /REPO_RETRIEVAL/);
  await r.invoke('settings:set', { instantExperiment: 'rag-off' });
  const count = r.searches.length;
  await r.ask('say', 'RepoPilot 的检索如何实现？');
  assert.equal(r.searches.length, count);
  assert.doesNotMatch(prompt(r), /REPO_RETRIEVAL/);
  assert.equal(r.calls[0].model, r.calls[1].model);
});

test('warm ready evidence is whole, bounded and actually visible to SDK; off diagnostic skips it', async t => {
  const r = await createEvidenceRuntime(t, { settings: { realtimeAnswerMode: 'standard' } });
  await r.ask('say', '松塔订单的缓存如何实现？');
  await r.invoke('settings:set', { realtimeAnswerMode: 'instant' });
  // A settings reset may keep safe raw sources; exact completed jobs are optional.
  await r.ask('say', '松塔订单的缓存版本校验如何实现？');
  const sources = r.evidence().sources;
  assert.ok(sources.length <= 3);
  assert.ok(sources.length > 0, 'ready-only should use matching resident raw source');
  for (const source of sources) assert.ok(r.sdkText().includes(source.text));
  assert.ok(r.metrics().instantContext.readyEvidenceTokensEstimate <= 650);
  assert.equal(metric(r).readyEvidenceHit, true);
  await r.invoke('settings:set', { instantRagPolicy: 'off' });
  await r.ask('say', '松塔订单的缓存版本校验如何实现？');
  assert.equal(r.evidence().sources.length, 0);
  assert.equal(metric(r).ragPolicy, 'off');
  assert.equal(metric(r).readyEvidenceHit, false);
});

test('source budget removes oversized ready source and reports actual used hit rather than candidate hit', async t => {
  const r = make(t, { settings: { realtimeAnswerMode: 'standard' }, chunks: [{ path: 'TCS/Cache.md', startLine: 1, endLine: 1,
    docType: 'implementation', truthScope: 'implemented', status: 'confirmed', text: '缓存版本校验读取和失效恢复实现。'.repeat(36) }] });
  await r.ask('say', 'TCS 的缓存如何实现？');
  await r.invoke('settings:set', { realtimeAnswerMode: 'instant' });
  await r.ask('say', 'TCS 的缓存版本校验如何实现？');
  const event = r.events.filter(e => e.channel === 'llm:evidence').at(-1);
  const log = r.logs.findLast(args => String(args[0]).startsWith('[latency][prompt]'))[0];
  const diagnostic = JSON.parse(log.slice('[latency][prompt] '.length));
  assert.ok(diagnostic.retrieval.candidateCount > 0);
  assert.equal(event.sources.length, 0);
  assert.equal(metric(r).readyEvidenceHit, false);
  assert.equal(metric(r).sourceCount, 0);
});

test('independent instant gets zero history and pending; referential target has bounded reference only', async t => {
  const r = make(t); r.answer('我会采用事件驱动。它通过回放恢复状态。');
  await r.ask('say', 'RepoPilot 的架构如何设计？');
  assert.ok(r.value("[...conversation.checklist.entries.values()].some(entry => /架构/.test(entry.text) && ['pending','unknown'].includes(entry.status))"),
    'the previous project question really remains unresolved in the checklist');
  await r.ask('say', '那团队如何分工？');
  assert.equal(r.calls[1].messages.filter(m => m.role === 'assistant').length, 0);
  assert.doesNotMatch(currentText(r.calls[1]), /架构如何设计|事件驱动/);
  assert.equal(r.calls[1].max_tokens, 640, 'old unresolved design question cannot enlarge the new single-target answer');
  await r.ask('say', '为什么这样做？');
  assert.match(currentText(r.calls[2]), /REFERENCE_ONLY/);
  assert.ok(metric(r).optionalContextTokensEstimate <= 900);
  await r.ask('say', '什么是数据库事务？');
  assert.doesNotMatch(prompt(r), /事件驱动|团队如何分工|REFERENCE_ONLY/);
});

test('manual cards are compiled once and heading-bound; cross-project mentions cannot grant scope', () => {
  const settings = { projectKnowledge: '# Alpha\n缓存 ALPHA_ONLY\n# Beta\n缓存 BETA_ONLY，用于替代 Alpha 的实现' };
  const cards = new InstantContextCards(settings);
  const request = { plan: { retrieve: true, projectLabel: 'Alpha', scopes: ['a'] }, turns: [] };
  const result = buildInstantContext({ settings, cards, question: 'Alpha 的缓存如何实现？', request });
  assert.match(result.system, /ALPHA_ONLY/); assert.doesNotMatch(result.system, /BETA_ONLY/);
  const generic = buildInstantContext({ settings, cards, question: '什么是缓存？', request: { plan: {}, turns: [] } });
  assert.doesNotMatch(generic.system, /ALPHA_ONLY|BETA_ONLY/);
  assert.ok(result.stats.fixedInstructionTokensEstimate <= INSTANT_LIMITS.fixedTokens);
  assert.ok(result.stats.optionalContextTokensEstimate <= 650);
});

test('explicit unknown project never inherits previous project facts or label', async t => {
  const r = make(t);
  await r.ask('say', 'TCS 项目的缓存怎么设计？');
  await r.ask('say', '你在 Nebula 项目具体负责什么？');
  assert.equal(r.requests[1].plan.scopes.length, 0);
  assert.equal(r.requests[1].plan.projectLabel, 'Nebula');
  assert.doesNotMatch(prompt(r), /TCS_ONLY|当前项目：TCS/);
});

test('current full question and custom style win over optional soft budget, evidence remains whole', () => {
  const question = '数据库不能扩容，' + '还有一个必要条件，不允许丢失订单；'.repeat(60) + '失败怎么恢复？为什么？';
  const settings = { aiRules: '使用我配置的风格。'.repeat(100) };
  const result = buildInstantContext({ settings, question, request: { plan: {}, turns: [] }, readyEvidence: { evidence: [] } });
  assert.equal(result.currentSections.find(s => s.id === 'question').text, 'CURRENT_QUESTION\n' + question);
  assert.match(result.system, /使用我配置的风格/);
  assert.ok(estimateTokens(result.system + question) > 2200);
});

test('instant forces configured fast model without changing persistent depth preference', async t => {
  const r = make(t, { settings: { smart: true, models: { custom: { fast: 'qwen-flash', smart: 'slow-model' } },
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' } });
  let transportOptions;
  r.behavior((_body, _options, _index, config) => {
    transportOptions = config;
    return (async function* () { yield { choices: [{ delta: { content: '事务保证一组操作原子完成。' }, finish_reason: 'stop' }] }; })();
  });
  await r.ask('say', '什么是事务？');
  assert.equal(r.calls[0].model, 'qwen-flash'); assert.equal(r.calls[0].enable_thinking, false);
  assert.equal(r.exports('src/store.js').getSettings().smart, true);
  assert.equal(transportOptions.maxRetries, 0);
  assert.equal(metric(r).model, 'qwen-flash');
  assert.equal(metric(r).thinkingStatus, 'disabled');
  assert.equal(metric(r).automaticRetriesDisabled, true);
});
