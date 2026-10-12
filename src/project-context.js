'use strict';
const { performance } = require('perf_hooks');
const knowledge = require('./project-knowledge');
const { planProjectRetrieval } = require('./project-query');
const { ActiveProjectContextCache, assessEvidence } = require('./active-project-context-cache');
const activeProjectContextCache = new ActiveProjectContextCache();

function fitEvidence(items, maxChars) {
  const selected = [];
  let remaining = Math.max(0, maxChars - 320);
  for (const item of items || []) {
    const room = remaining - String(item.path || '').length - String(item.symbol || '').length - 130;
    if (room < 100) break;
    let text = item.text, endLine = item.endLine, partial = !!item.partial;
    if (text.length > room) {
      const boundary = text.lastIndexOf('\n', room);
      text = text.slice(0, boundary > 60 ? boundary : room);
      endLine = item.startLine + (text.match(/\n/g) || []).length;
      partial = true;
    }
    selected.push({ ...item, text, endLine, partial }); remaining -= text.length + 130 + String(item.path || '').length + String(item.symbol || '').length;
  }
  return selected;
}

function buildProjectContext(transcript, mode, request = {}) {
  const started = performance.now();
  const plan = request.projectPlan || planProjectRetrieval(transcript, mode, { catalog: knowledge.getProjectCatalog() });
  const gateMs = performance.now() - started;
  const fast = mode === 'say' || mode === 'answerThis';
  const complex = request.answerComplexity === 'complex';
  const defaultMax = request.smart ? 6200 : (fast ? (complex ? 4000 : 3000) : 5000);
  const maxChars = Number.isFinite(request.projectContextBudget) ? Math.max(0, Math.min(defaultMax, request.projectContextBudget)) : defaultMax;
  let results = [], context = '', stats = {}, fallback = false, profileChars = 0, evidence = [];
  const cache = request.projectContextCache || activeProjectContextCache;
  if (plan.retrieve && plan.scopes?.length && maxChars >= 500) {
    try {
      const extra = (request.interviewPlan?.subQuestions || []).map(q => typeof q === 'string' ? q : q.text)
        .filter(text => text && !plan.query.includes(text));
      const query = extra.length ? [plan.query.slice(0, 1000), ...extra].join('\n').slice(0, 1800) : plan.query;
      const revision = knowledge.getProjectIndexRevision();
      if (!cache.get(plan.scopes, revision)) cache.put(plan.scopes, revision,
        knowledge.getProjectSeedEvidence({ scopes: plan.scopes, revision, limit: 6, maxChars: 4800 }), { seed: true });
      const cached = cache.lookup(plan.scopes, revision, query, request.interviewPlan);
      const fitted = fitEvidence(cached.evidence, maxChars);
      if (cached.hit && !assessEvidence(fitted, plan.scopes, query, request.interviewPlan).hit) cached.hit = false;
      stats = { evidenceCacheHit: cached.hit, evidenceMissing: cached.missing.length, searchCalls: 0 };
      if (cached.hit) {
        results = fitted;
        evidence = results;
        context = knowledge.formatRetrievedProjectContext(results, { maxChars });
      } else {
        const codeLocation = /代码|源码|在哪(?:里)?实现|调用链|\b(?:code|implementation|where .*implement)\b/i.test(query);
        const options = { limit: request.smart ? 6 : (complex || codeLocation ? 5 : 3), maxChars,
          minConfidence: 0.38, scopes: plan.scopes };
        results = knowledge.searchProjectKnowledge(query, options);
        stats = { ...stats, ...knowledge.getLastSearchStats(), searchCalls: 1 };
        if (!results.length && plan.overview) {
          results = knowledge.getProjectOverviewChunks({ limit: 3, maxChars, scopes: plan.scopes });
          fallback = results.length > 0;
        }
        const profileEvidence = knowledge.getProjectProfileEvidence(query, { scopes: plan.scopes, revision,
          maxChars: Math.min(maxChars, fast ? (complex ? 1200 : 850) : 1400) });
        profileChars = profileEvidence.reduce((sum, item) => sum + item.text.length, 0);
        const imported = knowledge.toProjectEvidence(results, { scopes: plan.scopes, revision });
        const merged = [...imported, ...profileEvidence].filter((item, index, all) => all.findIndex(other =>
          other.projectId === item.projectId && other.path === item.path && other.startLine === item.startLine) === index);
        cache.put(plan.scopes, revision, merged);
        const prioritized = assessEvidence(merged, plan.scopes, query, request.interviewPlan).evidence;
        results = fitEvidence([...prioritized, ...merged.filter(item => !prioritized.some(other =>
          other.path === item.path && other.projectId === item.projectId && other.startLine === item.startLine))], maxChars);
        evidence = results;
        context = knowledge.formatRetrievedProjectContext(results, { maxChars });
      }
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
    evidenceCacheHit: !!stats.evidenceCacheHit, evidenceMissing: stats.evidenceMissing || 0, searchCalls: stats.searchCalls || 0,
    postingsVisited: stats.postingsVisited || 0, hits: results.length, profileChars,
    confidence: stats.confidence || 0, fallback, contextChars: context.length,
    totalMs: +(performance.now() - started).toFixed(2) }));
  return { plan, context, evidence, stats };
}
module.exports = { buildProjectContext, activeProjectContextCache };
