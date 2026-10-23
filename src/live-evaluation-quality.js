'use strict';

// An explicit, local contract checker. This is not a calibrated semantic judge:
// it cannot establish that every sentence is supported or that prose is good.
const SUCCESS_STATUSES = new Set(['ok', 'passed', 'success', 'completed']);
const PROJECT_IDS = new Set(['cae', 'arclight']);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort();
}
function identifiers(values, key) {
  return uniqueStrings((Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value : value?.[key]));
}
function sameSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function matcher(pattern, flags = 'iu') {
  if (typeof pattern !== 'string' || !pattern) throw new Error('quality rule requires a non-empty regex pattern');
  return new RegExp(pattern, String(flags).replace(/[gy]/g, ''));
}
function clauses(text) {
  // A qualification in one sentence must not excuse an unsupported claim in a
  // different sentence. Commas remain inside a clause for Chinese negations.
  return String(text).split(/[。！？!?\n]+/u).filter(Boolean);
}
function forbiddenMatches(answer, rule) {
  const prohibited = matcher(rule.pattern, rule.flags);
  const qualification = rule.allowPattern ? matcher(rule.allowPattern, rule.flags) : null;
  return clauses(answer).filter(clause => prohibited.test(clause) && !(qualification && qualification.test(clause)));
}

function evaluateCase(input = {}) {
  const testCase = input.testCase || {};
  const rules = testCase.checks || {};
  const answer = typeof input.answer === 'string' ? input.answer : '';
  const projectIds = uniqueStrings(input.projectIds);
  const sentFactIds = identifiers(input.sentFactIds, 'cardId');
  const sentSourceIds = identifiers(input.sentSourceIds, 'sourceId');
  const sentSources = Array.isArray(input.sentSources) ? input.sentSources : [];
  const sourceProjectIds = uniqueStrings(sentSources.map(source => source?.projectId));
  const expectedProjects = uniqueStrings(testCase.expectedProjectIds);
  const checks = [];
  const observations = [];
  const conceptObservations = [];
  const add = (id, passed, detail, evidence = {}) => checks.push({ id, passed: Boolean(passed), detail, ...evidence });

  add('request-completed', !input.error && SUCCESS_STATUSES.has(input.status || 'ok'), 'Requested provider call must finish successfully.', { observed: input.status || 'ok', ...(input.error ? { error: String(input.error) } : {}) });
  add('answer-present', Boolean(answer.trim()), 'The complete model answer must be retained and non-empty.');
  add('project-routing', sameSet(projectIds, expectedProjects), 'Resolved project IDs must match the fixed case oracle.', { expected: expectedProjects, observed: projectIds });

  const wrongFactIds = sentFactIds.filter(id => {
    const project = id.split('.')[0];
    return PROJECT_IDS.has(project) && !expectedProjects.includes(project);
  });
  add('fact-project-isolation', !wrongFactIds.length, 'Evidence from an unrelated fixture project must not enter this answer.', { unexpectedFactIds: wrongFactIds });
  // A generic case must not receive opaque project facts either. For project
  // cases the source-of-truth registry can have extensions outside this fixture.
  if (!expectedProjects.length) add('generic-without-project-facts', !sentFactIds.length, 'A general technical question must not receive project facts.', { observed: sentFactIds });
  const requiredFactIds = uniqueStrings(rules.requiredFactIds);
  const missingRequiredFactIds = requiredFactIds.filter(id => !sentFactIds.includes(id));
  if (requiredFactIds.length) add('required-fact-evidence', !missingRequiredFactIds.length, 'Only the hand-authored minimum evidence subset is required.', { expected: requiredFactIds, missing: missingRequiredFactIds });

  const sourceCount = Math.max(sentSourceIds.length, sentSources.length);
  if (testCase.sourcePolicy === 'off') add('source-policy-off', sourceCount === 0, 'Source snippets must not be sent when source retrieval is off.', { observedCount: sourceCount });
  if (testCase.requireSource) add('source-evidence-present', sourceCount > 0, 'This source-enabled case requires actual sent source evidence.', { observedCount: sourceCount });
  const wrongSourceProjects = sourceProjectIds.filter(id => !expectedProjects.includes(id));
  add('source-project-isolation', !wrongSourceProjects.length, 'Sent source evidence must stay in the resolved project.', { unexpectedProjectIds: wrongSourceProjects });
  const requiredSourceProjects = uniqueStrings(testCase.expectedSourceProjects);
  if (requiredSourceProjects.length) add('source-project-provenance', requiredSourceProjects.every(id => sourceProjectIds.includes(id)), 'Required source evidence must carry a project ID.', { expected: requiredSourceProjects, observed: sourceProjectIds });
  const expectedSourcePaths = uniqueStrings(testCase.expectedSourcePaths);
  const sentSourcePaths = uniqueStrings(sentSources.map(source => typeof source?.path === 'string' ? source.path.replace(/\\/g, '/') : ''));
  if (expectedSourcePaths.length) add('required-source-path', expectedSourcePaths.some(expected => sentSourcePaths.includes(expected)), 'At least one hand-authored relevant source path must actually be sent; another snippet from the same project is insufficient.', { expectedAnyOf: expectedSourcePaths, observed: sentSourcePaths });

  for (const rule of Array.isArray(rules.requiredNumbers) ? rules.requiredNumbers : []) {
    try { add(`number:${rule.id}`, matcher(rule.pattern, rule.flags).test(answer), 'The case explicitly asks for a documented numeric value and unit.'); }
    catch (error) { add(`rule-valid:number:${rule.id}`, false, error.message); }
  }
  for (const rule of Array.isArray(rules.forbiddenClaims) ? rules.forbiddenClaims : []) {
    try {
      const matchedClauses = forbiddenMatches(answer, rule);
      add(`forbidden-claim:${rule.id}`, !matchedClauses.length, 'A narrow, predeclared unsupported assertion is blocking; an explicit qualification is allowed.', { matchedClauses });
    } catch (error) { add(`rule-valid:claim:${rule.id}`, false, error.message); }
  }
  // Cross-project names are observed for review, not blindly rejected: a model
  // may explicitly reject an inappropriate comparison or correct a question.
  for (const project of PROJECT_IDS) {
    const name = project === 'cae' ? '\\bCAE\\b|cae-job-platform' : '\\bArclight\\b|\\bmewcode\\b';
    if (!expectedProjects.includes(project) && matcher(name).test(answer)) observations.push({ id: `unrequested-project-name:${project}`, observed: true, blocking: false, detail: 'Review whether this is a correction, a comparison, or project contamination.' });
  }

  // Concept coverage is deliberately advisory: a finite synonym list cannot
  // prove a fluent paraphrase wrong. It must never fail a case by itself.
  for (const rule of Array.isArray(rules.requiredConcepts) ? rules.requiredConcepts : []) {
    try {
      const observed = (Array.isArray(rule.anyOf) ? rule.anyOf : []).some(pattern => matcher(pattern, rule.flags).test(answer));
      conceptObservations.push({ id: rule.id, observed, blocking: false, detail: observed ? 'A listed expression was found; this is not semantic validation.' : 'Necessary content was not recognized. Review the full answer for an omission or a valid paraphrase.' });
    } catch (error) { add(`rule-valid:concept:${rule.id}`, false, error.message); }
  }
  observations.push({ id: 'answer-length', characters: [...answer].length, blocking: false });
  if (/^\s*(?:[-*]|\d+[.)、])\s/mu.test(answer)) observations.push({ id: 'list-format', observed: true, blocking: false, detail: 'Human review decides whether this sounds natural when spoken.' });
  const expectedFacts = uniqueStrings(testCase.expectedFactIds);
  const coveredFactIds = expectedFacts.filter(id => sentFactIds.includes(id));
  const deterministicPassed = checks.every(check => check.passed);
  const missingConceptIds = conceptObservations.filter(item => !item.observed).map(item => item.id);
  const reviewWarnings = missingConceptIds.map(id => ({ id: `content-needs-review:${id}`, reason: 'A required semantic group was not recognized by the finite local expressions; a human must distinguish an omission from a valid paraphrase.' }));
  const qualityStatus = deterministicPassed ? (missingConceptIds.length ? 'needs-review' : 'passed-listed-checks') : 'failed';
  return {
    schemaVersion: 1,
    // Compatibility field for the runner's blocking exit status only. Always
    // display qualityStatus separately; true here is not a model-quality score.
    passed: deterministicPassed,
    passedScope: 'deterministic-contracts-only',
    qualityStatus,
    deterministic: { passed: deterministicPassed, checks },
    evidenceCoverage: { expectedFactIds: expectedFacts, sentExpectedFactIds: coveredFactIds, missingExpectedFactIds: expectedFacts.filter(id => !sentFactIds.includes(id)), blocking: false },
    contentCoverage: { status: missingConceptIds.length ? 'needs-review' : 'listed-groups-observed', blocking: false, requiredConceptCount: conceptObservations.length,
      matchedConceptIds: conceptObservations.filter(item => item.observed).map(item => item.id), missingConceptIds, observations: conceptObservations },
    reviewWarnings,
    language: { blocking: false, method: 'local-observations-no-llm-judge', observations },
    manualReviewRequired: true,
    reviewPrompts: Array.isArray(rules.manualReview) ? [...rules.manualReview] : [],
    limitations: [
      'Passing establishes only the listed deterministic contracts, not that every generated claim is supported.',
      'Concept and language observations are advisory; unlisted paraphrases and unlisted unsupported claims require human review.',
      'Fact IDs and source provenance describe evidence sent to the model, not proof that the answer used it correctly.'
    ]
  };
}

module.exports = { evaluateCase };
