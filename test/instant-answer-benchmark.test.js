'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { parseArguments, normalizeQuestion, selectLiveConfiguration, summarizeRecords } = require('../scripts/benchmark-instant-answer.cjs');

test('instant benchmark requires an explicit live flag and a configured settings file', () => {
  const offline = parseArguments([]);
  assert.equal(offline.live, false);
  assert.equal(offline.samples, 30);
  assert.deepEqual(offline.triggers, ['text', 'asr-replay']);
  assert.throws(() => parseArguments(['--live']), /--settings/);
  const live = parseArguments(['--live', '--settings', '/tmp/existing-cue-data.json']);
  assert.equal(live.live, true);
  assert.deepEqual(live.triggers, ['text']);
  assert.deepEqual(live.scenarios, ['no-doc']);
});

test('live CLI fails before provider setup when no existing settings were provided', () => {
  assert.throws(() => execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/benchmark-instant-answer.cjs'), '--live'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /No provider call was sent/);
    assert.equal(error.stdout, '');
    return true;
  });
});

test('benchmark reports failed/canceled attempts without folding them into successful timing percentiles', () => {
  const rows = [
    { outcome: 'success', questionCorrect: true, sdkCalls: 1, sourceCount: 1, sourceChars: 20, triggerToDispatchMs: 3, readyEvidenceHit: true },
    { outcome: 'success', questionCorrect: true, sdkCalls: 1, sourceCount: 0, sourceChars: 0, triggerToDispatchMs: 7 },
    { outcome: 'timeout', sdkCalls: 1, triggerToDispatchMs: 9000 },
    { outcome: 'aborted', sdkCalls: 1, triggerToDispatchMs: 5000 }
  ];
  const summary = summarizeRecords(rows);
  assert.equal(summary.attempts, 4);
  assert.equal(summary.validSamples, 2);
  assert.equal(summary.failureRate, .5);
  assert.equal(summary.timeoutRate, .25);
  assert.equal(summary.cancellationRate, .25);
  assert.equal(summary.questionCorrect, 2);
  assert.equal(summary.readyEvidenceHits, 1);
  assert.deepEqual(summary.metrics.triggerToDispatchMs, { n: 2, p50: 3, p95: 7, max: 7 });
  assert.deepEqual(summary.metrics.firstContentMs, { n: 0, p50: null, p95: null, max: null });
});

test('question correctness normalizes punctuation without dropping conditions or subquestions', () => {
  assert.equal(normalizeQuestion(' 不能扩容，怎么设计？为什么？ '), normalizeQuestion('不能扩容,怎么设计?为什么?'));
  assert.notEqual(normalizeQuestion('不能扩容，怎么设计？为什么？'), normalizeQuestion('怎么设计？'));
  assert.notEqual(normalizeQuestion('不能超卖，怎么恢复？'), normalizeQuestion('允许超卖，怎么恢复？'));
});

test('live settings import excludes private profiles, project facts, history and unrelated keys', () => {
  const selected = selectLiveConfiguration({ provider: 'custom', baseUrl: 'https://example.invalid/v1', smart: true,
    apiKeys: { custom: 'synthetic-selected-key', unrelated: 'synthetic-other-key' },
    models: { custom: { fast: 'configured-fast' }, unrelated: { fast: 'do-not-import' } },
    providerOptions: { custom: { enable_thinking: true } }, contextWindowTokens: 16384,
    resumeText: 'PRIVATE_PROFILE', projectKnowledge: 'PRIVATE_PROJECT', starStories: 'PRIVATE_STORY',
    customInstructions: 'PRIVATE_STYLE', instantExperiment: 'stale-control', currentProjectId: 'private-project',
    conversationHistory: ['PRIVATE_HISTORY'] });
  assert.deepEqual(Object.keys(selected).sort(), ['provider', 'baseUrl', 'smart', 'contextWindowTokens', 'apiKeys', 'models', 'providerOptions'].sort());
  assert.deepEqual(selected.apiKeys, { custom: 'synthetic-selected-key' });
  assert.deepEqual(selected.models, { custom: { fast: 'configured-fast' } });
  assert.ok(!JSON.stringify(selected).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(selected).includes('unrelated'));
});
