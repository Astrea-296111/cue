'use strict';

// Metrics are computed from returned candidates and the final constructed
// messages, never from a configured scope or an optimistic selector flag.
const normalizePath = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
const unwrap = item => item?.chunk || item?.source || item || {};
const normalizeType = value => ({ implemented: 'implementation', code: 'implementation', metric: 'performance', metrics: 'performance', general_knowledge: 'theory' }[value] || value);

function groupsByPath(items, prompt) {
  const groups = new Map();
  for (const raw of items || []) {
    const source = unwrap(raw);
    const text = String(source.text || '');
    if (!text || (prompt != null && !String(prompt).includes(text))) continue;
    // Verbatim text alone can also occur in history. The current source label
    // (stable ID, or legacy path) must be present in the final messages.
    if (prompt != null && !String(prompt).includes(String(source.id || normalizePath(source.path)))) continue;
    const key = `${source.projectId || ''}:${normalizePath(source.path)}`;
    const group = groups.get(key) || { path: normalizePath(source.path), projectId: source.projectId || '', texts: [] };
    group.texts.push(text);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, text: group.texts.join('\n') }));
}

function matchesRequirement(groups, requirement, projectId, details) {
  return (requirement.anyOf || []).some(alternative => groups.some(group =>
    group.projectId === projectId &&
    (group.path === normalizePath(alternative.path) || group.path.endsWith('/' + normalizePath(alternative.path))) &&
    (!details || (alternative.contains || []).every(text => group.text.includes(text)))));
}

function evaluateCase(gold, result = {}) {
  const evidence = result.evidence || [];
  const prompt = String(result.prompt || '');
  const candidates = groupsByPath(result.candidates || []);
  const visible = groupsByPath(evidence, prompt);
  const needs = gold.needs || [];
  const candidateCovered = needs.map(need => matchesRequirement(candidates, need, gold.projectId, false));
  const visibleCovered = needs.map(need => matchesRequirement(visible, need, gold.projectId, true));
  const expected = new Set((gold.expectedMissing || []).map(item => normalizeType(typeof item === 'string' ? item : item.type)));
  const actual = new Set((result.missing || []).map(item => normalizeType(typeof item === 'string' ? item : item.type || item.docType || item.need)));
  actual.delete(undefined);
  const foreign = evidence.map(unwrap).filter(item => item.projectId && item.projectId !== gold.projectId);
  const leaks = groupsByPath(foreign, prompt);
  return {
    id: gold.id, projectId: gold.projectId, split: gold.split,
    needs: needs.length, candidateCovered: candidateCovered.filter(Boolean).length,
    visibleCovered: visibleCovered.filter(Boolean).length,
    candidateSourceRecall: needs.length ? candidateCovered.filter(Boolean).length / needs.length : null,
    visibleEvidenceCoverage: needs.length ? visibleCovered.filter(Boolean).length / needs.length : null,
    multiQuestion: needs.length > 1,
    multiQuestionComplete: needs.length > 1 ? visibleCovered.every(Boolean) : null,
    expectedMissing: [...expected], actualMissing: [...actual],
    missingTruePositive: [...expected].filter(type => actual.has(type)).length,
    missingFalsePositive: [...actual].filter(type => !expected.has(type)).length,
    missingFalseNegative: [...expected].filter(type => !actual.has(type)).length,
    crossProjectLeaks: leaks.reduce((sum, group) => sum + group.texts.length, 0), selectedForeignSources: foreign.length,
    selectedSources: evidence.length, visibleSources: visible.reduce((sum, item) => sum + item.texts.length, 0),
    uncovered: needs.filter((_, index) => !visibleCovered[index]).map(need => ({ type: need.type, acceptablePaths: need.anyOf.map(item => item.path) }))
  };
}

function percentile(values, percentileValue) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function summarize(rows) {
  const sum = key => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  const multi = rows.filter(row => row.multiQuestion);
  const tp = sum('missingTruePositive'), fp = sum('missingFalsePositive'), fn = sum('missingFalseNegative');
  return {
    cases: rows.length,
    candidateSourceRecall: ratio(sum('candidateCovered'), sum('needs')),
    finalPromptVisibleEvidenceCoverage: ratio(sum('visibleCovered'), sum('needs')),
    multiQuestionCompleteCoverage: ratio(multi.filter(row => row.multiQuestionComplete).length, multi.length),
    crossProjectLeaks: sum('crossProjectLeaks'),
    missingPrecision: ratio(tp, tp + fp), missingRecall: ratio(tp, tp + fn),
    missingCounts: { truePositive: tp, falsePositive: fp, falseNegative: fn },
    latencyMs: { p50: percentile(rows.map(row => row.latencyMs), 0.5), p95: percentile(rows.map(row => row.latencyMs), 0.95) }
  };
}

module.exports = { evaluateCase, summarize, percentile, groupsByPath };
