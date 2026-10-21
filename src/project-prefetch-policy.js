'use strict';

// Execution budgets are not cache identities. The version names the relevance
// and source-validation contract, shared by completed background and fast work.
const RETRIEVAL_CONFIG_VERSION = 'realtime-evidence-v2';
const RETRIEVAL_POLICY = Object.freeze({
  fast: Object.freeze({ semanticWaitMs: 0, hashFallback: false }),
  deep: Object.freeze({ semanticWaitMs: 100 }),
  background: Object.freeze({ budgetMs: 800, maxBudgetMs: 1000, hashFallback: false }),
  interim: Object.freeze({ debounceMs: 180, minIntervalMs: 300, maxWaitMs: 600 }),
  maxPredictions: 2, semanticConcurrency: 1,
  poolMaxEvidence: 48, poolMaxChars: 32000, poolMaxEntries: 6,
  predictionTTL: 45000, exactResultTTL: 60000, workerRecoveryMs: 2000
});

const enabled = settings => settings?.realtimeEvidencePrefetch !== false;
function executionPolicy(kind, overrides = {}) {
  if (kind === 'background') {
    const budgetMs = Math.max(1, Math.min(RETRIEVAL_POLICY.background.maxBudgetMs,
      Number(overrides.budgetMs) || RETRIEVAL_POLICY.background.budgetMs));
    return { execution: kind, semanticWaitMs: budgetMs, budgetMs, hashFallback: false };
  }
  return { execution: kind, ...(kind === 'deep' ? RETRIEVAL_POLICY.deep : RETRIEVAL_POLICY.fast) };
}

// A bounded retrieval hint, never a question/checklist entry or an asserted fact.
function adjacentNeeds(input, sources = []) {
  if (input.projectPlan?.scopes?.length !== 1 || !sources.length) return [];
  const topics = [...new Set(sources.flatMap(s => s.topics || []))].filter(t => typeof t === 'string' && t.length > 1);
  const linked = sources.some(s => [...(s.relatedDocs || []), ...(s.codeRefs || [])].some(r => r.status === 'resolved'));
  if (!topics.length || !linked) return [];
  const present = new Set((input.interviewPlan?.subQuestions || []).flatMap(q => (q.evidenceNeeds || []).map(n => n.type || n)));
  const choices = present.has('performance') ? [['environment'], ['limitation']]
    : present.has('ownership') || present.has('collaboration') ? [['collaboration', 'ownership'], ['implementation']]
      : [['decision'], ['challenge', 'limitation']];
  return choices.filter(types => types.some(type => !present.has(type))).slice(0, RETRIEVAL_POLICY.maxPredictions)
    .map(types => ({ topics: topics.slice(0, 3), types, sourceIds: sources.slice(0, 6).map(s => s.id) }));
}

module.exports = { RETRIEVAL_POLICY, RETRIEVAL_CONFIG_VERSION, executionPolicy, enabled, adjacentNeeds };
