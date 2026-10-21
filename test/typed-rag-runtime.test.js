'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewRuntime, currentText, deferred } = require('./helpers/interview-agent-runtime');

// Synthetic projects: these fixtures describe no user project or personal work.
const card = (name, file, docType, text, truthScope = 'implemented') => ({ path: `${name}/${file}`,
  startLine: 1, endLine: text.split('\n').length, text, docType, truthScope, status: 'confirmed', provenance: 'user_authored' });
const chunks = [
  card('星舟', 'decision.md', 'decision', 'STAR_DECISION 星舟：我选择 MySQL 保存任务租约，因为需要同一事务核验资源额度；没有用 Redis 保存租约。'),
  card('星舟', 'claim.js', 'implementation', 'STAR_CODE function claimLease(id) { return mysql.transaction(id); } MySQL 在事务中锁定任务并预留额度。'),
  card('星舟', 'challenge.md', 'challenge', 'STAR_CHALLENGE 星舟遇到困难是结果导出失败后误重跑计算。我负责将计算与结果导出拆成两阶段，验证重试沿用原 executionId。'),
  card('星舟', 'performance.md', 'performance', 'STAR_METRIC 星舟测试：单机 4 核 8 GiB、Mock 求解器、100 个任务，导出重试 p95 为 83 ms。只代表该测试环境。', 'test_only'),
  card('星舟', 'incident.md', 'incident', 'STAR_NO_INCIDENT 星舟没有发生过线上事故；此处只有故障注入测试。'),
  card('星舟', 'ownership.md', 'ownership', 'STAR_TEAM_ONLY 团队完成整体交付；个人职责尚未确认。'),
  card('杉木', 'decision.md', 'decision', 'BIRCH_DECISION 杉木：我选择 Redis 保存轻量租约，因为记录允许过期；未采用 MySQL 事务锁。'),
  card('杉木', 'claim.js', 'implementation', 'BIRCH_CODE function claimLease(id) { return redis.set(id, "lease", "NX", "PX", 3000); }'),
  card('杉木', 'challenge.md', 'challenge', 'BIRCH_CHALLENGE 杉木困难是租约续期抖动；我负责加截止时间检查，验证旧任务不能提交结果。')
];
const projects = [{ name: '星舟', aliases: ['StarBoat'], resumeOrder: 2, hasManifest: true },
  { name: '杉木', aliases: ['BirchTree'], resumeOrder: 1, hasManifest: true }];

test('formal Ctrl+Enter honors catalog ordinal and excludes old project assistant history at SDK', async t => {
  const r = createInterviewRuntime(t, { chunks, projects });
  r.answer('旧杉木回答 BIRCH_ASSISTANT Redis 租约');
  await r.ask('say', '介绍第一个项目杉木的实现？');
  await r.ask('say', '关于第二个项目，这个项目为什么选择 MySQL？');
  const request = r.calls.at(-1);
  assert.ok(request);
  assert.doesNotMatch(JSON.stringify(request.messages), /BIRCH_ASSISTANT|BIRCH_DECISION|BIRCH_CODE/);
  assert.match(JSON.stringify(request.messages), /STAR_DECISION/);
  assert.equal(r.commits.at(-1).request.plan.projectIds[0], 'fixture-星舟');
  assert.ok(r.searches.filter(s => s.method === 'getProjectCandidates').every(s => s.scopes?.length));
  r.answer('Redis 通常在内存中处理数据，速度受操作类型和部署条件影响。');
  await r.ask('say', 'Redis 为什么快？');
  assert.doesNotMatch(JSON.stringify(r.calls.at(-1).messages), /STAR_DECISION|BIRCH_DECISION/);
  await r.ask('say', '那它的空值缓存有什么问题？');
  assert.doesNotMatch(JSON.stringify(r.calls.at(-1).messages), /BIRCH_ASSISTANT|STAR_DECISION|BIRCH_DECISION/);
  await r.ask('say', '回到刚才那个项目，为什么没用 Redis 保存租约？');
  assert.match(JSON.stringify(r.calls.at(-1).messages), /STAR_DECISION/);
});

test('negative incident and unconfirmed team ownership remain missing in final prompt', async t => {
  const r = createInterviewRuntime(t, { chunks, projects });
  r.answer('1. 我通过恢复 MySQL 数据解决了线上故障。\n2. 我负责采用事务实现任务租约并完成整个团队交付。');
  await r.ask('say', '星舟发生过什么线上事故？你本人负责了哪些工作？');
  const evidenceEvent = r.events.findLast(event => event.channel === 'llm:evidence');
  assert.ok(evidenceEvent.missing.length >= 2);
  assert.ok(evidenceEvent.sources.every(item => !/STAR_NO_INCIDENT|STAR_TEAM_ONLY/.test(item.text)));
  assert.match(JSON.stringify(r.calls.at(-1).messages), /缺|未找到|不足/);
  assert.ok(r.snapshot('conversation.checklist.view().questions').every(item => item.status !== 'covered'),
    'Missing real evidence cannot be covered by a fabricated complete answer');
});

test('final window removes whole source blocks and commits only SDK-visible references', async t => {
  const longDecision = card('星舟', 'long-decision.md', 'decision',
    '星舟选择 MySQL 因为需要在同一事务核验资源额度。' + '这是原始资料中的约束与取舍说明。'.repeat(80));
  const r = createInterviewRuntime(t, { chunks: [...chunks, longDecision], projects,
    settings: { contextWindowTokens: 4096 } });
  r.answer('我选择 MySQL，因为需要在同一事务核验额度，代价是事务锁竞争。');
  await r.ask('say', '星舟为什么选择 MySQL？');
  assert.equal(r.calls.length, 1);
  const sent = JSON.stringify(r.calls[0].messages);
  for (const source of r.commits.at(-1).config.evidence) assert.ok(sent.includes(source.text));
  const promptLog = r.logs.find(args => String(args[0]).startsWith('[latency][prompt]'));
  const stats = JSON.parse(promptLog[0].slice('[latency][prompt] '.length));
  assert.ok(stats.finalBudget.estimatedTokens + stats.finalBudget.reservedOutputTokens + stats.finalBudget.safetyTokens <= 4096);
  assert.match(currentText(r.calls[0]), /星舟为什么选择 MySQL/);
});

test('deep-mode formal async path aborts delayed semantic work before clear and preserves only new SDK messages', async t => {
  const wait = deferred();
  let r, sawSignal;
  const semantic = { status: () => ({ ready: true, modelVersion: 'controlled-worker-v1' }),
    queryCandidates: async request => { sawSignal = request.signal; await wait.promise; return { rows: [], reason: 'test-late' }; },
    invalidate() {}, close() {} };
  r = createInterviewRuntime(t, { chunks, projects, semanticRetriever: semantic,
    settings: { smart: true, models: { custom: { smart: 'test-model' } } } });
  await r.ready;
  const first = r.ask('say', '星舟为什么选择 MySQL？');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(sawSignal);
  r.clear();
  assert.equal(sawSignal.aborted, true);
  await r.ask('say', 'Redis是什么？');
  wait.resolve();
  await first;
  assert.equal(r.calls.length, 1);
  assert.match(currentText(r.calls[0]), /Redis是什么/);
  assert.equal(r.commits.length, 1);
  assert.equal(r.commits[0].committed, true);
});

test('explicit local project selection does not override named switch or generic pause', async t => {
  const r = createInterviewRuntime(t, { chunks, projects });
  await r.invoke('project:current', 'fixture-星舟');
  await r.ask('say', '这个项目如何实现任务租约？');
  assert.match(JSON.stringify(r.calls.at(-1).messages), /STAR_CODE/);
  await r.ask('say', '杉木这个项目如何实现租约？');
  assert.match(JSON.stringify(r.calls.at(-1).messages), /BIRCH_CODE/);
  assert.doesNotMatch(JSON.stringify(r.calls.at(-1).messages), /STAR_CODE/);
  await r.ask('say', 'Redis 的 RDB 和 AOF 原理是什么？');
  assert.equal(r.commits.at(-1).request.plan.retrieve, false);
});
