'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeText, sanitizeReport, summarize, markdown, writeReports } = require('../scripts/lib/live-evaluation-report.cjs');

function fixture() {
  return { schemaVersion: 1, kind: 'live', status: 'failed', mode: 'smoke', startedAt: '2026-10-23T00:00:00.000Z',
    finishedAt: '2026-10-23T00:00:01.000Z', build: { commit: 'fixture-commit', node: 'v24' },
    approval: { id: 'public-synthetic' }, budget: { maxCalls: 60, attemptedCalls: 2 },
    providers: [{ id: 'qwen', model: 'configured-model', status: 'failed', cases: [
      { id: 'first', sessionId: 'session-a', mode: 'instant', question: '怎样恢复任务？', status: 'passed',
        attempted: true, transportStatus: 'passed',
        answer: '通过 checkpoint 恢复任务。\n保留完整回答。\n```javascript\nresume();\n```', projectIds: ['cae'], sentFactIds: ['cae-checkpoint'], sentSourceIds: ['cae/worker.js:1'],
        metrics: { firstContentMs: 50, triggerToFirstContentMs: 60, doneMs: 100 }, usage: { actualInputTokens: 20, actualOutputTokens: 10, actualTotalTokens: 30 },
        completion: { complete: true }, quality: { passed: true, deterministic: { passed: true }, qualityStatus: 'passed-listed-checks' } },
      { id: 'second', sessionId: 'session-a', mode: 'standard', question: '随后呢？', status: 'failed', answer: '已收到的部分回答。',
        attempted: true, transportStatus: 'failed',
        metrics: { firstContentMs: 100, triggerToFirstContentMs: 130, doneMs: 200 }, error: { code: 'timeout', message: 'Timed out.' } }
    ] }], failures: [{ provider: 'qwen', caseId: 'second', code: 'timeout', message: 'Timed out.' }],
    codePositions: [{ path: 'main.js', line: 900, role: '真实问答入口' }] };
}

test('report sanitizer removes configured secrets, headers and local paths recursively', () => {
  const value = sanitizeReport({ answer: 'approved answer', error: 'Bearer unknown-header-token\nQWEN_API_KEY=unknown-key\nAuthorization: raw-header\n/workspace/cue/private/data.json\nC:\\Users\\person\\data.json\n/tmp/cue-runtime/a.json\nkey-from-env',
    headers: { authorization: 'private', 'x-api-key': 'private' }, apiKey: 'private', actualInputTokens: 30,
    codePositions: [{ path: 'main.js', line: 4 }] }, { secrets: ['key-from-env'], workspaceRoot: '/workspace/cue', tempRoots: ['/tmp/cue-runtime'] });
  const text = JSON.stringify(value);
  for (const secret of ['unknown-header-token', 'unknown-key', 'raw-header', 'key-from-env', '/workspace/cue', 'C:\\\\Users', '/tmp/cue-runtime']) assert.ok(!text.includes(secret), secret);
  assert.equal(value.apiKey, '[REDACTED]');
  assert.equal(value.headers.authorization, '[REDACTED]');
  assert.equal(value.headers['x-api-key'], '[REDACTED]');
  assert.equal(value.actualInputTokens, 30);
  assert.equal(value.codePositions[0].path, 'main.js');
  assert.equal(sanitizeText('safe xyx safe', { secrets: ['xyx'] }), 'safe [REDACTED] safe');
  assert.equal(sanitizeText('{"x-api-key":"unknown-json-key"}'), '{"x-api-key":[REDACTED]}');
  assert.equal(sanitizeText('encoded=abc%2Bdef', { secrets: ['abc+def'] }), 'encoded=[REDACTED]');
});

test('statistics use observed first-content values and leave unavailable usage unknown', () => {
  const result = summarize(fixture());
  assert.deepEqual(result.firstContentMs, { count: 2, p50: 50, p95: 100 });
  assert.deepEqual(result.triggerToFirstContentMs, { count: 2, p50: 60, p95: 130 });
  assert.equal(result.usage.actualInputTokens, 20);
  assert.equal(result.usage.actualReasoningTokens, null);
  assert.equal(result.usageObservedCases, 1);
  assert.equal(result.passedCases, 1);
  assert.equal(result.failedCases, 1);
  assert.equal(result.requestCount, 2);
  assert.equal(result.timeoutCount, 1);
  assert.equal(result.timeoutRate, 0.5);
  assert.equal(result.callFailureCount, 1);
  assert.equal(result.callFailureRate, 0.5);
  assert.equal(result.qualityScoredCases, 1);
  assert.equal(result.deterministicPassedCases, 1);
  assert.equal(result.coveredListedChecksCases, 1);
  assert.equal(result.qualityNeedsReviewCases, 0);
  assert.equal(summarize({ providers: [{ cases: [{}] }] }).usage.actualInputTokens, null);
});

test('call rates separate model quality from transport failures and unattempted cases', () => {
  const cases = [
    { status: 'failed', attempted: true, transportStatus: 'passed', error: { code: 'quality-failed' } },
    { status: 'failed', attempted: true, transportStatus: 'failed', error: { code: 'network-error' } },
    { status: 'failed', attempted: true, transportStatus: 'failed', error: { code: 'first-content-timeout' } },
    { status: 'failed', attempted: true, transportStatus: 'failed', error: { code: 'total-timeout' } },
    { status: 'failed', attempted: true, error: { code: 'pipeline-evidence-missing' } },
    { status: 'pending', attempted: false, transportStatus: 'not-attempted' },
    { status: 'failed', attempted: false, transportStatus: 'not-attempted', error: { code: 'config-missing' } }
  ];
  const summary = summarize({ providers: [{ id: 'qwen', cases }] });
  assert.equal(summary.requestCount, 5);
  assert.equal(summary.timeoutCount, 2);
  assert.equal(summary.timeoutRate, 2 / 5);
  assert.equal(summary.callFailureCount, 3);
  assert.equal(summary.callFailureRate, 3 / 5);
  assert.equal(summary.uncompletedCases, 1);
  assert.equal(summary.providers[0].requestCount, 5);
  const noCalls = summarize({ providers: [{ cases: [{ status: 'pending', attempted: false }] }] });
  assert.equal(noCalls.requestCount, 0);
  assert.equal(noCalls.timeoutRate, null);
  assert.equal(noCalls.callFailureRate, null);
});

test('quality summary distinguishes listed coverage, review and hard failures and never scores mock', () => {
  const cases = [
    { attempted: true, status: 'passed', quality: { deterministic: { passed: true }, qualityStatus: 'passed-listed-checks' } },
    { attempted: true, status: 'passed', quality: { deterministic: { passed: true }, qualityStatus: 'needs-review' } },
    { attempted: true, status: 'failed', quality: { deterministic: { passed: false }, qualityStatus: 'failed' } },
    { attempted: true, status: 'passed', quality: { scored: false, deterministic: { passed: true }, qualityStatus: 'passed-listed-checks' } },
    { attempted: false, status: 'pending', quality: { deterministic: { passed: true }, qualityStatus: 'passed-listed-checks' } }
  ];
  const report = { kind: 'live', providers: [{ id: 'qwen', cases }] };
  const real = summarize(report);
  assert.equal(real.qualityScoredCases, 3);
  assert.equal(real.deterministicPassedCases, 2);
  assert.equal(real.qualityNeedsReviewCases, 1);
  assert.equal(real.coveredListedChecksCases, 1);
  assert.equal(real.providers[0].qualityNeedsReviewCases, 1);
  const text = markdown(report);
  assert.match(text, /确定契约通过：2/);
  assert.match(text, /需要人工复核：1/);
  assert.match(text, /列举规则覆盖：1/);
  assert.match(text, /不能证明模型回答质量完全通过/);
  const mock = summarize({ ...report, kind: 'mock' });
  assert.equal(mock.qualityScoredCases, 0);
  assert.equal(mock.deterministicPassedCases, null);
  assert.equal(mock.qualityNeedsReviewCases, null);
  assert.equal(mock.coveredListedChecksCases, null);
  assert.equal(summarize({ kind: 'live', providers: [] }).deterministicPassedCases, null);
});

test('markdown retains full answers, evidence and failure list and labels mock explicitly', () => {
  const report = fixture();
  report.kind = 'mock';
  const text = markdown(report);
  assert.match(text, /MOCK：使用本地合成传输，没有调用外部模型/);
  assert.ok(text.includes(report.providers[0].cases[0].answer));
  assert.match(text, /cae-checkpoint/);
  assert.match(text, /cae\/worker.js:1/);
  assert.match(text, /qwen \/ second：timeout/);
  assert.match(text, /main.js:900/);
  assert.match(text, /````\n通过 checkpoint/);
});

test('partial and final artifacts survive failed runs and never contain secret values', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputDir = path.join(dir, 'artifacts');
  const summaryPath = path.join(dir, 'summary.md');
  const report = fixture();
  report.status = 'running';
  report.providers[0].cases[1].error.message = 'env-only-credential /tmp/cue-runtime/private.json';
  writeReports(report, { outputDir, sanitize: { secrets: ['env-only-credential'] } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8')).status, 'running');
  report.status = 'failed';
  writeReports(report, { outputDir, summaryPath, sanitize: { secrets: ['env-only-credential'] } });
  const names = fs.readdirSync(outputDir);
  assert.deepEqual(names.sort(), ['report.json', 'report.md']);
  const json = fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8');
  const md = fs.readFileSync(path.join(outputDir, 'report.md'), 'utf8');
  const summary = fs.readFileSync(summaryPath, 'utf8');
  for (const output of [json, md, summary]) {
    assert.ok(!output.includes('env-only-credential'));
    assert.ok(!output.includes('/tmp/cue-runtime'));
    assert.ok(output.includes('failed'));
  }
  assert.ok(json.includes('已收到的部分回答'));
  assert.ok(md.includes('已收到的部分回答'));
  assert.match(summary, /首正文 p50 \/ p95/);
});
