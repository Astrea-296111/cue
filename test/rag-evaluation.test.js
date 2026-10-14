'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateCase, summarize, percentile } = require('../scripts/lib/rag-eval-metrics');
const fixtureRoot = path.join(__dirname, 'fixtures/rag-evaluation');

test('evaluation gold references actual synthetic facts and keeps development/heldout questions outside indexed aliases', () => {
  const projects = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'project-list.json'), 'utf8'));
  const gold = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'gold.json'), 'utf8'));
  assert.equal(gold.synthetic, true);
  assert.equal(gold.cases.length, 60);
  assert.equal(new Set(gold.cases.map(item => item.id)).size, 60);
  for (const project of projects) {
    const cases = gold.cases.filter(item => item.projectId === project.id);
    assert.equal(cases.filter(item => item.split === 'development').length, 20);
    assert.equal(cases.filter(item => item.split === 'heldout').length, 10);
    const projectRoot = path.join(fixtureRoot, 'projects', project.directory);
    const manifest = fs.readFileSync(path.join(projectRoot, 'interview/project.md'), 'utf8');
    assert.match(manifest, /合成项目|合成身份/);
    assert.equal(cases.some(item => manifest.includes(item.question)), false, 'gold wording must not become indexed aliases');
    for (const item of cases) for (const need of item.needs) for (const alternative of need.anyOf) {
      assert.equal(alternative.path.includes('..'), false);
      const source = fs.readFileSync(path.join(projectRoot, alternative.path), 'utf8');
      for (const marker of alternative.contains) assert.ok(source.includes(marker), `${item.id} missing source marker ${marker}`);
    }
  }
});

test('prompt-visible coverage rejects hidden evidence, wrong project and missing metric environment', () => {
  const gold = { id: 'quality', projectId: 'a', split: 'heldout', expectedMissing: [], needs: [
    { type: 'performance', anyOf: [{ path: 'performance.md', contains: ['96', '4 vCPU'] }] }
  ] };
  const full = { projectId: 'a', path: 'performance.md', text: '96 次/秒；4 vCPU；测试数据' };
  assert.equal(evaluateCase(gold, { candidates: [full], evidence: [full], prompt: '原问' }).visibleCovered, 0);
  assert.equal(evaluateCase(gold, { candidates: [full], evidence: [{ ...full, text: '96 次/秒' }], prompt: 'performance.md\n96 次/秒' }).visibleCovered, 0);
  assert.equal(evaluateCase(gold, { candidates: [full], evidence: [{ ...full, projectId: 'b' }], prompt: 'performance.md\n' + full.text }).crossProjectLeaks, 1);
  assert.equal(evaluateCase(gold, { candidates: [full], evidence: [full], prompt: full.text }).visibleCovered, 0, 'history text without a current source label is not evidence');
  assert.equal(evaluateCase(gold, { candidates: [full], evidence: [full], prompt: 'performance.md\n' + full.text }).visibleCovered, 1);
});

test('multisource table coverage can recover environment and row without counting unsupported selector claims', () => {
  const gold = { id: 'table', projectId: 'a', split: 'development', expectedMissing: [], needs: [
    { type: 'performance', anyOf: [{ path: 'performance.md', contains: ['4 vCPU', '| P95 | 71 | ms |'] }] },
    { type: 'ownership', anyOf: [{ path: 'ownership.md', contains: ['只负责租约'] }] }
  ] };
  const evidence = [{ projectId: 'a', path: 'performance.md', text: '环境：4 vCPU' },
    { projectId: 'a', path: 'performance.md', text: '| P95 | 71 | ms |' }];
  const result = evaluateCase(gold, { evidence, candidates: evidence, prompt: 'performance.md\n' + evidence.map(item => item.text).join('\n'), coverage: 1 });
  assert.equal(result.visibleCovered, 1);
  assert.equal(result.multiQuestionComplete, false);
  assert.deepEqual(result.uncovered.map(item => item.type), ['ownership']);
});

test('missing metrics and measured percentiles preserve false positives and unanswered requirements', () => {
  const row = evaluateCase({ id: 'missing', projectId: 'a', split: 'development', needs: [], expectedMissing: ['incident', 'performance'] },
    { missing: [{ type: 'incident' }, { type: 'ownership' }] });
  const result = summarize([{ ...row, latencyMs: 10 }, { ...row, latencyMs: 30 }]);
  assert.deepEqual(result.missingCounts, { truePositive: 2, falsePositive: 2, falseNegative: 2 });
  assert.equal(result.missingPrecision, .5);
  assert.equal(result.missingRecall, .5);
  assert.equal(result.finalPromptVisibleEvidenceCoverage, null);
  assert.equal(percentile([1, 4, 2, 3], .95), 4);
  assert.equal(percentile([], .5), null);
});
