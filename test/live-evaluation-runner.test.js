'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, providerConfig, createBudget, loadFixtures, runCase, run } = require('../scripts/e2e-live-llm.cjs');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { evaluateCase } = require('../src/live-evaluation-quality');

function output(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-live-runner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('runner rejects budgets beyond ceilings, requires explicit live config and accepts only safe HTTPS endpoints', () => {
  for (const args of [['--max-calls', '61'], ['--max-calls-per-provider', '31'], ['--max-output-tokens', '1801'],
    ['--first-content-timeout-ms', '30001'], ['--total-timeout-ms', '60001'], ['--max-calls', '-1'], ['--mode', 'unknown']]) assert.throws(() => parseArgs(args));
  const base = { QWEN_API_KEY: 'key-in-memory-only', QWEN_MODEL: 'configured-model', QWEN_BASE_URL: 'https://compatible.example/v1' };
  assert.equal(providerConfig('qwen', base, false).hostname, 'compatible.example');
  assert.equal(providerConfig('qwen', {}, false).error.code, 'configuration');
  for (const endpoint of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/?key=secret',
    'https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.1.1.2/v1', 'https://[::1]/v1', 'https://[fe80::1]/v1']) {
    assert.equal(providerConfig('qwen', { ...base, QWEN_BASE_URL: endpoint }, false).error.code, 'configuration', endpoint);
  }
  assert.equal(providerConfig('qwen', {}, true).model, 'mock-qwen');
});

test('global and per-provider attempt budgets remain bounded even when calls fail', () => {
  const budget = createBudget({ ...parseArgs([]), maxCalls: 3, maxCallsPerProvider: 2 }, ['qwen', 'deepseek']);
  budget.attempt('qwen'); budget.attempt('qwen');
  assert.throws(() => budget.attempt('qwen'), /budget exceeded/);
  budget.attempt('deepseek');
  assert.throws(() => budget.attempt('deepseek'), /budget exceeded/);
  assert.deepEqual(budget.snapshot().callsByProvider, { qwen: 2, deepseek: 1 });
  assert.equal(budget.snapshot().attemptedCalls, 3);
});

test('missing live config fails explicitly while retaining both providers, selected cases and job summary', async t => {
  const directory = output(t), summary = path.join(directory, 'summary.md');
  const result = await run({ ...parseArgs([]), outputDir: directory }, {
    QWEN_API_KEY: 'secret-never-write-even-on-failure', GITHUB_STEP_SUMMARY: summary });
  assert.equal(result.kind, 'live'); assert.equal(result.status, 'failed'); assert.equal(result.budget.attemptedCalls, 0);
  assert.equal(result.providers.length, 2);
  assert.ok(result.providers.every(provider => provider.status === 'failed' && provider.cases.length === 6));
  const json = fs.readFileSync(path.join(directory, 'report.json'), 'utf8');
  assert.ok(!json.includes('secret-never-write-even-on-failure'));
  const report = JSON.parse(json);
  assert.equal(report.summary.requestCount, 0);
  assert.equal(report.summary.callFailureRate, null);
  assert.match(fs.readFileSync(summary, 'utf8'), /Missing environment configuration/);
  assert.match(fs.readFileSync(path.join(directory, 'report.md'), 'utf8'), /LIVE/);
});

test('hash-approved smoke fixtures traverse real material import, project memory and both providers without network in explicit mock mode', async t => {
  const directory = output(t);
  const fixtures = loadFixtures();
  assert.equal(fixtures.suite.cases.length, 24);
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('Mock evaluation must not use external API.'); };
  let report;
  try { report = await run({ ...parseArgs(['--mock']), outputDir: directory }, {}); }
  finally { globalThis.fetch = previousFetch; }
  assert.equal(fetches, 0);
  assert.equal(report.status, 'passed', JSON.stringify(report.failures));
  assert.equal(report.kind, 'mock'); assert.equal(report.budget.attemptedCalls, 12);
  for (const provider of report.providers) {
    assert.deepEqual(provider.materialImport.imports.map(item => item.kind), ['json', 'folder', 'folder']);
    assert.equal(provider.materialImport.projects.length, 2);
    assert.equal(provider.cases.length, 6);
    assert.ok(provider.cases.every(item => item.attempted && item.sdkRequestCount === 1 && item.quality.scored === false));
    assert.ok(provider.cases.some(item => item.mode === 'instant') && provider.cases.some(item => item.mode === 'standard'));
    const cae = provider.cases[0], arclight = provider.cases[3], general = provider.cases[5];
    assert.deepEqual(cae.projectIds, ['cae']); assert.ok(cae.sentFactIds.length); assert.equal(cae.sentSourceIds.length, 0);
    assert.deepEqual(arclight.projectIds, ['arclight']); assert.ok(arclight.sentSourceIds.length);
    assert.ok(arclight.sentSources.every(source => source.projectId === 'arclight'));
    assert.deepEqual(general.projectIds, []); assert.deepEqual(general.sentFactIds, []);
    assert.ok(provider.cases.every(item => item.answer.includes('MOCK') && item.metrics.firstContentMs >= 0 && item.metrics.doneMs >= 0));
  }
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
  assert.equal(saved.summary.requestCount, 12);
  assert.equal(saved.summary.qualityScoredCases, 0);
  assert.equal(saved.summary.usage.actualTotalTokens, null);
  assert.match(fs.readFileSync(path.join(directory, 'report.md'), 'utf8'), /MOCK/);
});

test('budget rejection reports no sent evidence while retaining serialized diagnostics', async t => {
  const options = { ...parseArgs([]), maxOutputTokens: 300 }, budget = createBudget(options, ['qwen']);
  let externalCalls = 0;
  const runtime = createInterviewRuntime(t, { chunks: [], settings: { projectKnowledge: '' }, liveTransport: {
    maxOutputTokens: 300, onAttempt: () => budget.attempt('qwen'), Client: class {
      constructor() { this.chat = { completions: { create: async () => { externalCalls++; throw new Error('must not be called'); } } }; }
    } } });
  const preview = await runtime.invoke('materials:prepare', { mode: 'replace-all', index: require('../evaluation/cue-live/materials/facts.json') });
  await runtime.invoke('materials:commit', preview);
  const item = loadFixtures().suite.cases[0];
  const result = await runCase(runtime, item, { id: 'qwen' }, options, budget, evaluateCase);
  assert.equal(result.error.code, 'output-token-budget');
  assert.equal(result.attempted, false); assert.equal(result.transportStatus, 'not-attempted'); assert.equal(externalCalls, 0);
  assert.deepEqual(result.sentFactIds, []); assert.deepEqual(result.sentSourceIds, []);
  assert.ok(result.evidenceDiagnostics.serializedFactIds.length);
});

test('timeout stays a transport failure and retains full partial output even if SDK ignores abort and finishes', async t => {
  const options = { ...parseArgs([]), totalTimeoutMs: 15 }, budget = createBudget(options, ['qwen']);
  const runtime = createInterviewRuntime(t, { chunks: [], settings: { projectFactsEnabled: false }, liveTransport: {
    firstContentTimeoutMs: 1000, totalTimeoutMs: 15, onAttempt: () => budget.attempt('qwen'), Client: class {
      constructor() { this.chat = { completions: { create: async () => (async function* () {
        yield { choices: [{ delta: { content: '已产生的正文。' } }] };
        await new Promise(resolve => setTimeout(resolve, 25));
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      })() } }; }
    } } });
  const item = loadFixtures().suite.cases.at(-1);
  const result = await runCase(runtime, item, { id: 'qwen' }, options, budget, evaluateCase);
  assert.equal(result.error.code, 'total-timeout'); assert.equal(result.transportStatus, 'failed');
  assert.equal(result.attempted, true); assert.equal(result.answer, '已产生的正文。');
});
