'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluatePrivate, validatePrivatePayload, importPrivateMaterials } = require('../scripts/evaluate-private-projects.cjs');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { fixture, sourceFixture } = require('./helpers/material-fixture');
const payload = () => ({ schemaVersion: 1, facts: fixture(), profile: { resumeText: '合成测试简历：我负责CAE Java后端。', jobDescription: '合成测试JD：Java与可靠性工程。' } });

test('private payload accepts bounded data only and never allows caller paths, settings, code or oracle regexes', () => {
  assert.equal(validatePrivatePayload(payload()).facts.cards.length, 8);
  for (const extra of [{ path: '/home/private' }, { suite: [] }, { code: 'throw new Error()' }]) assert.throws(() => validatePrivatePayload({ ...payload(), ...extra }));
  assert.throws(() => validatePrivatePayload({ ...payload(), profile: { ...payload().profile, apiKeys: { custom: 'secret' } } }));
  assert.throws(() => validatePrivatePayload({ ...payload(), caseIds: Array.from({ length: 13 }, (_, index) => 'case-' + index) }));
  assert.throws(() => validatePrivatePayload({ ...payload(), profile: { ...payload().profile, resumeText: 'a'.repeat(256 * 1024 + 1) } }));
});

test('missing private live configuration fails with zero external calls and never writes private data to Actions Summary', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-private-evaluation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const summary = path.join(directory, 'public-summary.md');
  const report = await evaluatePrivate({ payload: payload(), outputDir: directory,
    env: { QWEN_API_KEY: 'secret-test-only-never-report', GITHUB_STEP_SUMMARY: summary } });
  assert.equal(report.kind, 'live'); assert.equal(report.status, 'failed'); assert.equal(report.budget.attemptedCalls, 0);
  assert.equal(report.providers.length, 2); assert.equal(report.privacy.publicAnswerArtifactsAllowed, false);
  assert.equal(fs.existsSync(summary), false);
  const saved = fs.readFileSync(path.join(directory, 'report.json'), 'utf8');
  assert.ok(!saved.includes('secret-test-only-never-report'));
  assert.ok(report.providers.every(provider => provider.error.code === 'configuration'));
});

test('private compiled facts/sources and resume/JD enter the actual production material service and text question path', async t => {
  const runtime = createInterviewRuntime(t, { chunks: [], inMemorySettings: true, realTime: true });
  const input = validatePrivatePayload(payload());
  const imported = await importPrivateMaterials(runtime, input, sourceFixture());
  assert.equal(imported.counts.facts, input.facts.cards.length);
  assert.equal(imported.counts.sourceProjects, 2); assert.equal(imported.resumeImported, true); assert.equal(imported.jobDescriptionImported, true);
  await runtime.ask('say', '你在 CAE 项目负责什么？');
  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.requests[0].plan.projectIds, ['cae']);
  const settings = runtime.exports('src/store.js').getSettings();
  assert.equal(settings.resumeText, input.profile.resumeText); assert.equal(settings.jobDescription, input.profile.jobDescription);
  assert.ok(!fs.readFileSync(path.join(runtime.temp, 'cue-data.json'), 'utf8').includes(input.profile.resumeText));
});
