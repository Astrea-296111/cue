'use strict';

// Only machine-observable contracts belong here. Natural-language expectations
// stay pending for independent judges; a missing keyword is never a false claim.
const { createHash } = require('node:crypto');
const unique = xs => [...new Set((xs || []).filter(x => typeof x === 'string' && x))].sort();
const expectedRoutes = route => route === 'comparison' ? ['arclight', 'cae']
  : ['cae', 'arclight'].includes(route) ? [route] : route === 'general' ? [] : null;

function evaluateMultiturnCase(input = {}) {
  const event = input.event || input.testCase || {};
  const evaluation = input.scenarioEvaluation || event.evaluation || event.scenarioEvaluation || {};
  const answer = String(input.answer || '');
  const expected = expectedRoutes(evaluation.expected_route);
  const actual = unique(input.projectIds);
  const checks = [];
  const add = (id, passed, detail, extra = {}) => checks.push({ id, passed: !!passed, detail, ...extra });
  add('request-completed', !input.error && ['ok', 'passed', 'completed', 'success'].includes(input.status || 'passed'), 'The production request finished without an error.');
  add('answer-present', !!answer.trim(), 'A complete, nonempty answer is retained.');
  if (expected) add('project-routing', JSON.stringify(actual) === JSON.stringify([...expected].sort()), 'The actual production route matches the predeclared oracle.', { expected, observed: actual });
  const reference = source => source.sourceType==='knowledge-reference'&&source.projectId==='general'&&['general_knowledge','proposed_design','unverified_reference'].includes(source.implementation);
  const sourceProjects = unique((input.sentSources || []).filter(source=>!reference(source)).map(x => x.projectId));
  add('knowledge-reference-boundary',(input.sentSources||[]).filter(source=>source.sourceType==='knowledge-reference').every(reference),'General knowledge is a declared reference, never project implementation evidence.');
  if (expected) add('source-project-isolation', sourceProjects.every(id => expected.includes(id)), 'Sent source provenance stays inside the declared project scope.', { expected, observed: sourceProjects });
  const sent = unique((input.sentFactIds || []).map(x => typeof x === 'string' ? x : x.cardId));
  const wrong = sent.filter(id => /^(cae|arclight)[.-]/u.test(id) && expected && !expected.includes(id.split(/[.-]/u)[0]));
  if (expected) add('fact-project-isolation', !wrong.length, 'Known project fact IDs do not cross the declared scope.', { unexpectedFactIds: wrong });
  // Structured numeric assertions are optional and explicitly authored. Do not
  // infer an assertion from numbers mentioned in a scenario's prose.
  const numerical = [];
  for (const assertion of evaluation.numeric_assertions || []) {
    const variants = Array.isArray(assertion.accepted) ? assertion.accepted : [];
    const found = variants.filter(value => typeof value === 'string' && answer.includes(value));
    numerical.push({ id: assertion.id, status: found.length ? 'observed-expression' : 'not-observed', found,
      blocking: false, detail: 'A finite expression observation; semantic correctness and units require judge review.' });
  }
  const facts = unique(evaluation.supporting_card_ids);
  const passed = checks.every(check => check.passed);
  return {
    schemaVersion: 2, passed, passedScope: 'deterministic-contracts-only',
    qualityStatus: passed ? 'semantic-review-pending' : 'failed',
    deterministic: { passed, checks },
    semanticExpectations: { mustConvey: [...(evaluation.must_convey || [])], mustNotAssert: [...(evaluation.must_not_assert || [])],
      status: 'not-assessed', detail: 'Missing concepts and asserted counterfacts are separate judge outcomes; no lexical pass is implied.' },
    evidenceCoverage: { expectedFactIds: facts, sentExpectedFactIds: facts.filter(id => sent.includes(id)),
      missingExpectedFactIds: facts.filter(id => !sent.includes(id)), blocking: false },
    numericalObservations: numerical, manualReviewRequired: true,
    limitations: ['Deterministic contracts do not establish semantic accuracy or oral naturalness.',
      'Evidence IDs show what was sent, not whether a generated claim follows from it.']
  };
}

function stableCaseKey(item, provider = '') {
  return [provider || item.provider || '', item.sessionId || '', item.id || '', item.repeat ?? 0, item.attempt ?? 0].join('/');
}
function scoreMean(item) {
  const scores = item.judging?.consensus?.scores || item.consensus?.scores || {};
  const values = Object.values(scores).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function createReviewPlan(report, { fraction = 0.2 } = {}) {
  if (!Number.isFinite(fraction) || fraction < 0.2 || fraction > 1) throw new Error('Manual passing-sample fraction must be between 0.2 and 1.');
  const rows = (report.providers || []).flatMap(provider => (provider.cases || []).map(item => ({ provider: provider.id, item, key: stableCaseKey(item, provider.id) })));
  const selections = new Map();
  const add = (row, reason) => {
    const existing = selections.get(row.key) || { key: row.key, provider: row.provider, sessionId: row.item.sessionId,
      caseId: row.item.id, repeat: row.item.repeat ?? 0, reasons: [], reviewStatus: 'pending' };
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    selections.set(row.key, existing);
  };
  for (const row of rows) {
    const item = row.item, judges = item.judging;
    if (item.status === 'failed' || judges?.consensus?.criticalFailure || judges?.consensus?.status === 'failed') add(row, 'failure-or-critical-claim');
    if (judges?.consensus?.needsReview || judges?.consensus?.status === 'unverified') add(row, 'judge-disagreement-or-unverified');
    if ([...(item.tags || []), ...(item.sessionTags || [])].some(tag => /correction|spoken-error|wrong-guarantee|contradiction|actual-speech|free-response/u.test(tag)) ||
        ['spoken_error', 'active_correction'].includes(item.precedingCandidateBehavior) ||
        /纠正|口误|改口/u.test(JSON.stringify(item.scenarioEvaluation || {}))) add(row, 'correction-or-actual-speech');
  }
  // Deterministic hash order is reproducible and does not select attractive answers.
  const passed = rows.filter(row => row.item.judging?.consensus?.status === 'passed');
  const sampled = [...new Set(passed.map(row => row.provider))].flatMap(provider => passed.filter(row => row.provider === provider)
    .sort((a, b) => createHash('sha256').update(a.key).digest('hex').localeCompare(createHash('sha256').update(b.key).digest('hex')))
    .slice(0, Math.ceil(passed.filter(row => row.provider === provider).length * fraction)));
  for (const row of sampled) add(row, 'passing-sample');
  const worstByFamily = new Map();
  for (const row of rows) for (const family of row.item.familyIds?.length ? row.item.familyIds :
    row.item.sessionTags?.length ? row.item.sessionTags : row.item.tags?.length ? row.item.tags : [row.item.category || 'unclassified']) {
    const existing = worstByFamily.get(family), score = scoreMean(row.item);
    if (!existing || score === null || (scoreMean(existing.item) !== null && score < scoreMean(existing.item))) worstByFamily.set(family, row);
  }
  for (const [family, row] of worstByFamily) add(row, 'worst-in-family:' + family);
  return { schemaVersion: 1, requiredPassingSampleFraction: fraction, totalCases: rows.length, automaticPassingCases: passed.length,
    sampledPassingCases: sampled.length, selectedCases: [...selections.values()], status: 'pending-human-review',
    instructions: 'Read the complete session, actual candidate speech, full answer, authoritative evidence and judge citations. Record findings; pending is never a pass.' };
}

module.exports = { evaluateMultiturnCase, createReviewPlan, expectedRoutes, stableCaseKey };
