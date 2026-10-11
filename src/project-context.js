'use strict';
const { performance } = require('perf_hooks');
const knowledge = require('./project-knowledge');
const { planProjectRetrieval } = require('./project-query');

function buildProjectContext(transcript, mode, request = {}) {
  const started = performance.now();
  const plan = request.projectPlan || planProjectRetrieval(transcript, mode, { catalog: knowledge.getProjectCatalog() });
  const gateMs = performance.now() - started;
  const fast = mode === 'say' || mode === 'answerThis';
  const complex = request.answerComplexity === 'complex';
  const maxChars = request.smart ? 6200 : (fast ? (complex ? 4000 : 3000) : 5000);
  let results = [], context = '', stats = {}, fallback = false, profileChars = 0;
  if (plan.retrieve) {
    try {
      // Interview Cards are compact source-backed summaries, so retrieve them
      // before raw chunks. Raw code remains the highest-detail evidence layer.
      const profile = knowledge.getProjectProfileContext(plan.query, {
        scopes: plan.scopes,
        maxChars: fast ? (complex ? 1200 : 850) : 1400
      });
      profileChars = profile.length;
      const rawBudget = Math.max(900, maxChars - profileChars - 260);
      const options = { limit: request.smart ? 6 : (complex ? 5 : 3), maxChars: rawBudget,
        minConfidence: 0.38, scopes: plan.scopes };
      results = knowledge.searchProjectKnowledge(plan.query, options);
      stats = knowledge.getLastSearchStats();
      if (!results.length && plan.overview) {
        results = knowledge.getProjectOverviewChunks({ limit: 3, maxChars: rawBudget, scopes: plan.scopes });
        fallback = results.length > 0;
      }
      const raw = knowledge.formatRetrievedProjectContext(results, { maxChars: rawBudget });
      context = [profile ? '=== Project Interview Cards（源码证据摘要） ===\n' + profile : '', raw].filter(Boolean).join('\n\n');
      if (!context) context = '（本次未检索到足够相关的导入项目证据。只能使用已提供的简历、手工项目资料或 STAR 中明确的事实；缺失的具体实现不得编造。）';
    } catch (error) {
      context = '（本次项目检索不可用；不要编造未获得证据的项目实现。）';
      console.warn('[rag] retrieval unavailable:', error?.code || error?.name || 'Error');
    }
  }
  console.log('[latency][rag] ' + JSON.stringify({ requestId: request.requestId || null,
    mode, gate: plan.reason, scopedProjects: plan.scopes?.length || 0, gateMs: +gateMs.toFixed(2),
    searchMs: +(stats.searchMs || 0).toFixed(2), coldBuildMs: +(stats.coldBuildMs || 0).toFixed(2),
    cacheHit: !!stats.cacheHit, candidates: stats.candidates || 0, denseCandidates: stats.denseCandidates || 0,
    postingsVisited: stats.postingsVisited || 0, hits: results.length, profileChars,
    confidence: stats.confidence || 0, fallback, contextChars: context.length,
    totalMs: +(performance.now() - started).toFixed(2) }));
  return { plan, context };
}
module.exports = { buildProjectContext };
