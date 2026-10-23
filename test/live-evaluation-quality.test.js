'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { evaluateCase } = require('../src/live-evaluation-quality');
const { validateIndex } = require('../src/project-fact-packs');
const { parseProjectManifest } = require('../src/project-pack-manifest');

const fixtureRoot = path.join(__dirname, '../evaluation/cue-live');
const read = relative => JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'));
const suite = read('cases.json');
const fixtureCase = id => suite.cases.find(item => item.id === id);
const goodInput = testCase => ({ testCase, status: 'ok', answer: '这是另一种自然表达。', projectIds: testCase.expectedProjectIds,
  sentFactIds: testCase.checks.requiredFactIds, sentSourceIds: testCase.requireSource ? ['source:one'] : [],
  sentSources: testCase.requireSource ? testCase.expectedSourceProjects.map(projectId => ({ id: 'source:one', projectId, path: testCase.expectedSourcePaths[0] })) : [] });
const failedIds = result => result.deterministic.checks.filter(check => !check.passed).map(check => check.id);

test('fixed suite has 24 cases and a six-case conversational smoke covering routing, modes and policies', () => {
  assert.equal(suite.cases.length, 24);
  assert.equal(new Set(suite.cases.map(item => item.id)).size, 24);
  assert.equal(suite.smokeCaseIds.length, 6);
  const smoke = suite.smokeCaseIds.map(id => fixtureCase(id));
  assert.ok(smoke.every(Boolean));
  assert.deepEqual(new Set(smoke.map(item => item.mode)), new Set(['instant', 'standard']));
  assert.deepEqual(new Set(smoke.map(item => item.sourcePolicy)), new Set(['off', 'ready-only', 'standard']));
  assert.equal(new Set(smoke.map(item => item.sessionId)).size, 1);
  assert.ok(smoke.slice(1).every(item => item.resetSession === false));
  for (const category of ['overview', 'ownership', 'collaboration-followup', 'implementation', 'challenge', 'metrics', 'switch', 'general']) {
    assert.ok(suite.cases.some(item => item.category === category), category);
  }
});

test('approval is a bounded, hash-checked allowlist with explicitly fictional personal data', () => {
  const approval = read('approval.json');
  assert.equal(approval.id, suite.approvalId);
  assert.equal(approval.ciApproved, true);
  assert.equal(approval.allowAnswerArtifacts, true);
  assert.equal(approval.persona.synthetic, true);
  assert.equal(approval.persona.realUserExperience, false);
  const allowed = new Set();
  for (const file of approval.inputFiles) {
    assert.ok(file.path && !path.isAbsolute(file.path) && !file.path.split('/').includes('..'));
    assert.ok(!allowed.has(file.path));
    allowed.add(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(fixtureRoot, file.path))).digest('hex'), file.sha256, file.path);
  }
  assert.ok(allowed.has('cases.json'));
  assert.ok(allowed.has('materials/facts.json'));
  assert.ok(allowed.has('materials/profile.json'));
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk(path.join(fixtureRoot, 'materials'))) assert.ok(allowed.has(path.relative(fixtureRoot, file).split(path.sep).join('/')), file);
});

test('facts preserve public technical provenance and synthetic role documents without importing private overrides', () => {
  const facts = validateIndex(read('materials/facts.json'));
  const publicFacts = require('../project-packs/index.json');
  const personal = new Set(['cae.ownership', 'cae.collaboration', 'arclight.ownership', 'arclight.collaboration']);
  assert.equal(facts.cards.length, publicFacts.cards.length);
  assert.deepEqual(facts.projects.map(item => item.id).sort(), ['arclight', 'cae']);
  for (const card of facts.cards) {
    if (!personal.has(card.cardId)) {
      assert.deepEqual(card, publicFacts.cards.find(item => item.cardId === card.cardId));
    } else {
      assert.equal(card.provenance, 'USER');
      assert.equal(card.truthScope, 'test_only');
      assert.match(card.text, /CI|合成|虚构/);
      assert.ok(facts.sourceDocuments[card.sources[0].path]);
    }
  }
  const ids = new Map(facts.cards.map(item => [item.cardId, item.projectId]));
  for (const item of suite.cases) for (const id of [...item.expectedFactIds, ...item.checks.requiredFactIds]) {
    assert.ok(ids.has(id), `${item.id}: ${id}`);
    assert.ok(item.expectedProjectIds.includes(ids.get(id)), `${item.id}: wrong-project oracle ${id}`);
  }
  for (const item of suite.cases.filter(item => item.requireSource)) {
    assert.ok(item.expectedSourcePaths.length, item.id);
    for (const sourcePath of item.expectedSourcePaths) {
      assert.ok(!path.isAbsolute(sourcePath) && !sourcePath.split('/').includes('..'));
      assert.ok(fs.existsSync(path.join(fixtureRoot, 'materials/sources', item.expectedSourceProjects[0], sourcePath)), `${item.id}: missing source oracle ${sourcePath}`);
    }
  }
  for (const [projectId, order] of [['cae', 1], ['arclight', 2]]) {
    const manifest = parseProjectManifest(fs.readFileSync(path.join(fixtureRoot, `materials/sources/${projectId}/interview/project.md`), 'utf8'));
    assert.equal(manifest.manifest.project_id, projectId);
    assert.equal(manifest.manifest.resume_order, order);
    for (const file of fs.readdirSync(path.join(fixtureRoot, `materials/sources/${projectId}/samples`))) {
      assert.match(fs.readFileSync(path.join(fixtureRoot, `materials/sources/${projectId}/samples/${file}`), 'utf8'), /SYNTHETIC CI REPRODUCTION/);
    }
  }
});

test('alternative phrasing is advisory and cannot fail an otherwise valid contract', () => {
  const item = fixtureCase('smoke-cae-overview');
  const result = evaluateCase({ ...goodInput(item), answer: '请求进入控制层，计算完成后还有结果整理，最终交付可下载文档。' });
  assert.equal(result.passed, true);
  assert.ok(result.contentCoverage.observations.some(item => !item.observed));
  assert.equal(result.qualityStatus, 'needs-review');
  assert.equal(result.passedScope, 'deterministic-contracts-only');
  assert.ok(result.reviewWarnings.length);
  assert.equal(result.language.blocking, false);
  assert.equal(result.language.method, 'local-observations-no-llm-judge');
  assert.equal(result.manualReviewRequired, true);
});

test('a non-empty acknowledgement cannot be reported as a quality pass', () => {
  const item = fixtureCase('smoke-cae-overview');
  const result = evaluateCase({ ...goodInput(item), answer: '好的。' });
  assert.equal(result.deterministic.passed, true);
  assert.equal(result.qualityStatus, 'needs-review');
  assert.equal(result.contentCoverage.missingConceptIds.length, item.checks.requiredConcepts.length);
  assert.ok(result.reviewWarnings.length >= 3);
  const covered = evaluateCase({ ...goodInput(item), answer: 'Java 控制面管理 Job/Execution，经 Agent 启动 mock Solver，解析和报告后完成。' });
  assert.equal(covered.qualityStatus, 'passed-listed-checks');
  assert.deepEqual(covered.contentCoverage.missingConceptIds, []);
});

test('fixed project oracle and evidence reject cross-project leakage independently of answer wording', () => {
  const item = fixtureCase('cae-state-machine');
  const result = evaluateCase({ ...goodInput(item), projectIds: ['arclight'], sentFactIds: ['cae.state', 'arclight.context'] });
  assert.equal(result.passed, false);
  assert.ok(failedIds(result).includes('project-routing'));
  assert.ok(failedIds(result).includes('fact-project-isolation'));
});

test('only a hand-authored minimum fact subset blocks, not all potentially relevant facts', () => {
  const optional = fixtureCase('smoke-cae-overview');
  const result = evaluateCase({ ...goodInput(optional), sentFactIds: [] });
  assert.equal(result.passed, true);
  assert.deepEqual(result.evidenceCoverage.missingExpectedFactIds, ['cae.overview', 'cae.state']);
  const required = fixtureCase('cae-state-machine');
  const missing = evaluateCase({ ...goodInput(required), sentFactIds: [] });
  assert.ok(failedIds(missing).includes('required-fact-evidence'));
});

test('source off, required source presence, and source project provenance are separate contracts', () => {
  const off = fixtureCase('smoke-cae-overview');
  assert.ok(failedIds(evaluateCase({ ...goodInput(off), sentSourceIds: ['unwanted'] })).includes('source-policy-off'));
  const on = fixtureCase('smoke-switch-arclight');
  const absent = evaluateCase({ ...goodInput(on), sentSourceIds: [], sentSources: [] });
  assert.ok(failedIds(absent).includes('source-evidence-present'));
  const wrong = evaluateCase({ ...goodInput(on), sentSources: [{ id: 'wrong', projectId: 'cae' }] });
  assert.ok(failedIds(wrong).includes('source-project-isolation'));
  assert.ok(failedIds(wrong).includes('source-project-provenance'));
  assert.equal(evaluateCase(goodInput(on)).passed, true);
});

test('a same-project but irrelevant source file cannot satisfy a fixed source-path oracle', () => {
  const item = fixtureCase('arclight-worktree');
  const wrong = evaluateCase({ ...goodInput(item), sentSources: [{ id: 'source:one', projectId: 'arclight', path: 'samples/context_budget.py' }] });
  assert.ok(failedIds(wrong).includes('required-source-path'));
  assert.ok(!failedIds(wrong).includes('source-project-isolation'));
  const correct = evaluateCase({ ...goodInput(item), sentSources: [{ id: 'source:one', projectId: 'arclight', path: 'interview\\worktree.md' }] });
  assert.equal(correct.deterministic.passed, true);
});

test('documented benchmark numbers and production boundary are checked without penalizing explicit negation', () => {
  const item = fixtureCase('cae-local-benchmark');
  const good = '公开复现的 LOCAL-BENCH：100 个子任务，98.583 秒，4 核、32GiB。这不是生产 KPI。';
  assert.equal(evaluateCase({ ...goodInput(item), answer: good }).passed, true);
  const qualified = '100 个子任务耗时 98.583 秒，不能把这个 98.583 秒当作生产 KPI。';
  assert.equal(evaluateCase({ ...goodInput(item), answer: qualified }).passed, true);
  const invented = evaluateCase({ ...goodInput(item), answer: '生产性能为100个子任务98.583秒。' });
  assert.ok(failedIds(invented).includes('forbidden-claim:local-bench-is-not-production'));
  const wrong = evaluateCase({ ...goodInput(item), answer: '10000 个任务，9.8 秒。' });
  assert.ok(failedIds(wrong).includes('number:subtasks'));
  assert.ok(failedIds(wrong).includes('number:duration-seconds'));
  const suffixCollision = evaluateCase({ ...goodInput(item), answer: '1100 个任务，198.583 秒。' });
  assert.ok(failedIds(suffixCollision).includes('number:subtasks'));
  assert.ok(failedIds(suffixCollision).includes('number:duration-seconds'));
});

test('a negation in a different sentence does not excuse an unsupported claim', () => {
  const item = fixtureCase('cae-local-benchmark');
  const result = evaluateCase({ ...goodInput(item), answer: '这不是私人数据。生产性能为100个子任务98.583秒。' });
  assert.ok(failedIds(result).includes('forbidden-claim:local-bench-is-not-production'));
});

test('general questions receive neither project facts nor project source evidence', () => {
  const item = fixtureCase('smoke-general-redis');
  assert.equal(evaluateCase(goodInput(item)).passed, true);
  const result = evaluateCase({ ...goodInput(item), sentFactIds: ['external.hidden-role'], sentSources: [{ projectId: 'cae', id: 'unexpected' }] });
  assert.ok(failedIds(result).includes('generic-without-project-facts'));
  assert.ok(failedIds(result).includes('source-project-isolation'));
});

test('an incomplete request, empty answer, or invalid rule is an explicit failure', () => {
  const item = fixtureCase('smoke-cae-overview');
  assert.ok(failedIds(evaluateCase({ ...goodInput(item), status: 'timeout', error: 'provider deadline' })).includes('request-completed'));
  assert.ok(failedIds(evaluateCase({ ...goodInput(item), answer: '' })).includes('answer-present'));
  const invalid = { ...item, checks: { requiredNumbers: [{ id: 'bad', pattern: '[' }] } };
  assert.ok(failedIds(evaluateCase({ ...goodInput(invalid) })).includes('rule-valid:number:bad'));
});
