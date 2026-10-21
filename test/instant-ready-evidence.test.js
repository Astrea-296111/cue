'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActiveProjectContextCache } = require('../src/active-project-context-cache');
const { ProjectRagSession, retrievalIdentity } = require('../src/project-rag-session');
const { peekReadyEvidence } = require('../src/instant-ready-evidence');

const scopes = ['@project:alpha'];
const config = 'realtime-evidence-v2:threshold=0.7';
const snapshot = { epoch: 4, questionId: 'q-1', revision: 2, text: '缓存如何实现？' };
const projectPlan = { retrieve: true, scopes, projectLabel: 'Alpha' };
const source = (id, text = '缓存读取先检查版本，命中缓存返回，没有命中则查询数据库。') => ({
  id, projectId: 'alpha', projectName: 'Alpha', path: `src/${id}.md`, startLine: 1, endLine: 1,
  sourceType: 'imported', revision: 'r-1', kind: 'section', docType: 'implementation', text
});
const input = (patch = {}) => ({ epoch: 4, projectRevision: 'r-1', modelVersion: 'base',
  questionId: 'q-1', questionRevision: 2, question: snapshot.text, projectPlan,
  contextBudget: 3600, ...patch });
function setup(extra = {}) {
  const rows = [source('cache')], cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r-1', rows, { retrievalConfigVersion: config });
  let resolutions = 0;
  const resident = { ready: true, revision: 'r-1', resolveSource(candidate) {
    resolutions++;
    return rows.find(row => row.id === candidate.id && row.path === candidate.path && row.text === candidate.text) || null;
  } };
  const options = { snapshot, projectPlan, epoch: 4, projectRevision: 'r-1', modelVersion: 'base',
    projectIndexSnapshot: resident, cache, retrievalInput: input(), ...extra };
  return { rows, cache, options, resolutions: () => resolutions };
}

test('ready-only inspects bounded resident raw sources without selector, lexical search, disk or expansion', () => {
  const r = setup();
  const fail = () => { throw new Error('forbidden foreground retrieval'); };
  r.cache.readCandidatesForQuestion = fail;
  r.options.projectIndexSnapshot.index = new Proxy({}, { get: fail });
  r.options.ragSession = { take: () => null, retrieve: fail };
  const bundle = peekReadyEvidence(r.options);
  assert.equal(bundle.evidence.length, 1);
  assert.equal(bundle.stats.searchCalls, 0);
  assert.equal(bundle.stats.queryEmbeddingCalls, 0);
  assert.equal(bundle.stats.readyOrigin, 'raw-pool');
  assert.equal(bundle.evidence[0].text, r.rows[0].text);
  assert.equal(bundle.evidence[0].sourceType, 'imported');
  assert.equal(bundle.evidence[0].revision, 'r-1');
  assert.equal(r.resolutions(), 1);
});

test('diagnostic off and cold/no-scope states skip optional material immediately', () => {
  const r = setup();
  for (const patch of [{ policy: 'off' }, { projectPlan: { retrieve: false } },
    { projectIndexSnapshot: { ready: false, revision: 'r-1' } }]) {
    const result = peekReadyEvidence({ ...r.options, ...patch });
    assert.equal(result.evidence.length, 0);
    assert.equal(result.stats.readyEvidenceHit, false);
    assert.ok(result.skippedReason);
  }
  assert.equal(r.resolutions(), 0);
});

test('exact completed results require frozen question and source identities; never await pending promises', async () => {
  const r = setup();
  const session = new ProjectRagSession({ retrieve: async () => ({ revision: 'r-1', evidence: r.rows }) });
  session.schedule(input(), { immediate: true });
  await new Promise(resolve => setImmediate(resolve));
  const good = peekReadyEvidence({ ...r.options, cache: null, ragSession: session });
  assert.equal(good.stats.readyOrigin, 'exact-ready');
  for (const patch of [{ questionId: 'q-2' }, { questionRevision: 3 }, { projectRevision: 'r-2' }, { modelVersion: 'other' }]) {
    const result = peekReadyEvidence({ ...r.options, cache: null, ragSession: session,
      retrievalInput: input(patch) });
    assert.equal(result.evidence.length, 0);
  }
  assert.notEqual(retrievalIdentity(input()), retrievalIdentity(input({ questionRevision: 3 })));
  assert.notEqual(retrievalIdentity(input()), retrievalIdentity(input({ retrievalConfigVersion: 'new-config' })));
  session.reset();
});

test('wrong epoch, scope, source revision, model/config or expired pool never publishes stale evidence', () => {
  let now = 0;
  const cache = new ActiveProjectContextCache({ ttlMs: 10, now: () => now });
  const r = setup({ cache });
  cache.put(scopes, 'r-1', r.rows, { retrievalConfigVersion: config });
  for (const patch of [{ epoch: 5 }, { projectRevision: 'r-2' }, { modelVersion: 'other' },
    { retrievalConfigVersion: 'other' }, { projectPlan: { ...projectPlan, scopes: ['@project:beta'] } }]) {
    assert.equal(peekReadyEvidence({ ...r.options, ...patch }).evidence.length, 0);
  }
  now = 11;
  assert.equal(peekReadyEvidence(r.options).evidence.length, 0);
});

test('large source units are skipped whole, selection never inspects beyond eight or attaches more than three', () => {
  const r = setup();
  r.rows.splice(0, 1, ...Array.from({ length: 15 }, (_, i) => source('cache-' + i)));
  r.cache.put(scopes, 'r-1', r.rows, { retrievalConfigVersion: config });
  const result = peekReadyEvidence({ ...r.options, maxCandidates: 1000, maxSources: 1000, maxChars: 10000 });
  assert.equal(result.stats.candidateCount, 8);
  assert.equal(r.resolutions(), 8);
  assert.equal(result.evidence.length, 3);
  assert.ok(result.evidence.every(row => row.text === r.rows[0].text));
  const limited = peekReadyEvidence({ ...r.options, maxChars: 10 });
  assert.equal(limited.evidence.length, 0);
});

test('unrelated and negated corrected targets skip old approvals instead of claiming coverage', () => {
  const r = setup();
  for (const text of ['团队如何分工？', '不用缓存，如何处理数据库读请求？', 'Kafka 的消费如何实现？']) {
    const result = peekReadyEvidence({ ...r.options, snapshot: { ...snapshot, text } });
    assert.equal(result.evidence.length, 0, text);
    assert.equal(result.stats.poolSufficientHit, false);
  }
  r.rows[0].questionIds = ['old']; r.rows[0].score = 1e9; r.rows[0].relevanceApproved = true;
  r.cache.put(scopes, 'r-1', r.rows, { retrievalConfigVersion: config });
  const result = peekReadyEvidence(r.options);
  for (const property of ['questionIds', 'score', 'relevanceApproved', 'channels', 'retrievalText']) {
    assert.equal(result.evidence[0][property], undefined);
  }
});

test('foreground ownership suspends queued/background starts until the matching request resumes', async () => {
  const starts = [];
  const session = new ProjectRagSession({ retrieve: async request => { starts.push(request); return { evidence: [] }; } });
  session.suspend('A');
  session.schedule(input(), { immediate: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts.length, 0);
  session.suspend('B');
  assert.equal(session.resume('A'), false);
  assert.equal(starts.length, 0);
  session.resume('B');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(starts.length, 1);
  session.reset();
});

test('suspension cancels active work and never publishes its late result', async () => {
  let complete;
  const session = new ProjectRagSession({ retrieve: () => new Promise(resolve => { complete = resolve; }) });
  session.schedule(input(), { immediate: true });
  session.suspend('request');
  assert.equal(session.running.controller.signal.aborted, true);
  complete({ revision: 'r-1', evidence: [source('old')] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.take(input()), null);
  session.resume('request'); session.reset();
});
