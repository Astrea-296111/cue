'use strict';

const { performance } = require('perf_hooks');
const { createHash } = require('crypto');
const knowledge = require('./project-knowledge');
const { ProjectSearch } = require('./project-search');
const { inProjectScope } = require('./project-scope');
const { selectEvidence, questionRequirements, evidenceId, inferDocType } = require('./evidence-selector');
const { RETRIEVAL_CONFIG_VERSION, RETRIEVAL_POLICY } = require('./project-prefetch-policy');

const MAX_GROUPS = 4;
const CANDIDATE_LIMIT = 25;
let fallbackSnapshot, fallbackSearch;

function snapshot(preparedOnly = false) {
  if (typeof knowledge.getProjectIndexSnapshot === 'function') return knowledge.getProjectIndexSnapshot({ preparedOnly });
  return { chunks: [], revision: knowledge.getProjectIndexRevision(), projects: [] };
}

function retrievalIdentity(request, revision, modelVersion = '') {
  return JSON.stringify([request.epoch ?? null, [...(request.projectPlan?.scopes || [])].sort(), revision,
    modelVersion, createHash('sha256').update(String(request.question || request.interviewPlan?.originalText || '')).digest('hex'),
    request.questionVersion ?? null, request.sourceKey || request.interviewPlan?.sourceKey || '', RETRIEVAL_CONFIG_VERSION,
    createHash('sha256').update(JSON.stringify([request.interviewPlan?.scenario || '', request.interviewPlan?.constraints || [],
      request.interviewPlan?.subQuestions?.map(q => [q.text, q.evidenceNeeds]) || [], request.projectPlan?.subQuestionScopes || []])).digest('hex'),
    request.hashFallback !== false, request.semanticThreshold ?? .70]);
}

function groupQuestions(question, interviewPlan, projectPlan, contextual = false) {
  const questions = questionRequirements(question, interviewPlan, projectPlan), groups = [], missing = [];
  for (const [questionIndex, q] of questions.entries()) {
    if (!q.scopes.length || q.evidenceNeeds.every(need => need.type === 'general_knowledge')) continue;
    // Duplicate exact requests share recall; different trailing questions do
    // not disappear into a clipped concatenation of the first 1800 characters.
    const key = JSON.stringify([q.text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase(), [...q.scopes].sort()]);
    const old = groups.find(group => group.key === key);
    if (old) { old.questions.push(q); continue; }
    if (groups.length >= MAX_GROUPS) {
      for (const need of q.evidenceNeeds) missing.push({ questionId: q.id, text: q.text, type: need.type, reason: 'group-limit', scopes: q.scopes });
      continue;
    }
    const anchor = contextual && questionIndex > 0 && !(q.topics || []).length
      ? questions.slice(0, questionIndex).find(previous => (previous.topics || []).length &&
        previous.scopes.join('|') === q.scopes.join('|'))?.text : '';
    const context = [anchor, interviewPlan?.scenario, ...(interviewPlan?.constraints || [])].filter(Boolean).join('\n');
    groups.push({ key, query: context ? `${q.text}\n${context}` : q.text, scopes: q.scopes, questions: [q] });
  }
  for (const omitted of interviewPlan?.omittedSubQuestions || []) {
    for (const need of omitted.evidenceNeeds?.length ? omitted.evidenceNeeds : [{ type: 'implementation' }]) {
      missing.push({ questionId: omitted.id || 'omitted-' + omitted.start, text: omitted.text,
        type: typeof need === 'string' ? need : need.type, reason: 'group-limit', scopes: omitted.scopes || projectPlan?.scopes || [] });
    }
  }
  return { questions, groups, missing };
}

function lexicalCandidates(group, current, options) {
  if (typeof knowledge.getProjectCandidates === 'function') {
    const found = knowledge.getProjectCandidates(group.query, { scopes: group.scopes, limit: CANDIDATE_LIMIT,
      candidateLimit: CANDIDATE_LIMIT, hashFallback: options.hashFallback, preparedOnly: options.preparedOnly });
    return Array.isArray(found) ? { rows: found, channels: { bm25: found }, stats: {} } : found;
  }
  // Backward-compatible snapshots still use the full candidate layer rather
  // than the legacy already-clipped search results.
  const chunks = current.chunks || current.index?.chunks || [];
  if (fallbackSnapshot !== chunks) { fallbackSnapshot = chunks; fallbackSearch = ProjectSearch.build(chunks); }
  return fallbackSearch.getCandidates(group.query, group.scopes, options);
}

function fuseCandidates(base, semantic, scopes, { semanticThreshold = .70 } = {}) {
  const channels = base?.channels || { bm25: base?.rows || [] };
  const learned = (semantic?.rows || []).filter(row => row?.chunk && inProjectScope(row.chunk, scopes) &&
    Number.isFinite(row.similarity ?? row.score) && (row.similarity ?? row.score) >= semanticThreshold).slice(0, CANDIDATE_LIMIT);
  const lists = [
    ['bm25', channels.bm25 || []], ['exact', channels.exact || []],
    ...(learned.length ? [['semantic', learned]] : (semantic && !semantic.reason ? [] : [['hash', channels.hash || []]])),
  ];
  const merged = new Map();
  for (const [channel, rows] of lists) {
    for (const [rank, row] of rows.slice(0, CANDIDATE_LIMIT).entries()) {
      const chunk = row.chunk || row;
      if (!chunk.text || !inProjectScope(chunk, scopes)) continue;
      const id = evidenceId(chunk);
      let item = merged.get(id);
      if (!item) {
        item = { ...chunk, id, score: 0, channels: [], relevance: row.relevance || row.coverage || 0,
          confidence: row.confidence || 0 };
        merged.set(id, item);
      }
      item.score += 1 / (60 + rank + 1);
      if (!item.channels.includes(channel)) item.channels.push(channel);
      item.relevance = Math.max(item.relevance, row.relevance || row.coverage || 0);
      item.confidence = Math.max(item.confidence, row.confidence || 0);
      if (channel === 'semantic') { item.semanticSimilarity = row.similarity ?? row.score; item.relevanceApproved = true; }
      if (channel === 'exact') item.relevanceApproved = true;
    }
  }
  return [...merged.values()].map(item => ({ ...item, score: item.score * (item.channels.includes('exact') ? 1.15 : 1) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function abortError() { const error = new Error('项目检索已取消'); error.name = 'AbortError'; return error; }

async function semanticCandidates(service, group, request, deadlineAt) {
  if (!service || typeof service.queryCandidates !== 'function') return { rows: [], reason: 'model-not-prepared' };
  if (request.signal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', onAbort, { once: true });
  const remaining = Math.max(0, deadlineAt - Date.now());
  if (!remaining) { request.signal?.removeEventListener('abort', onAbort); return { rows: [], reason: 'semantic-timeout' }; }
  let timer;
  let abortListener;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ rows: [], reason: 'semantic-timeout' }); }, remaining);
    });
    const work = Promise.resolve().then(() => service.queryCandidates({ query: group.query, scopes: [...group.scopes],
      signal: controller.signal, deadlineAt, requestId: request.requestId, epoch: request.epoch,
      questionVersion: request.questionVersion, sourceKey: request.sourceKey })).then(result =>
      result && typeof result === 'object' && Array.isArray(result.rows) ? result : { rows: [], reason: 'semantic-unavailable' }).catch(error => {
      if (request.signal?.aborted) throw abortError();
      return { rows: [], reason: controller.signal.aborted ? 'semantic-timeout' : 'semantic-unavailable', error: error?.name || 'Error' };
    });
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(abortError());
      request.signal?.addEventListener('abort', abortListener, { once: true });
    });
    return await Promise.race([work, timeout, aborted]);
  } finally {
    clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort);
    request.signal?.removeEventListener('abort', abortListener);
  }
}

async function retrieveProjectEvidenceAsync(request = {}) {
  const started = performance.now();
  const question = String(request.question || request.interviewPlan?.originalText || request.projectPlan?.question || request.projectPlan?.query || '');
  const realtime = request.realtimeEvidencePrefetch === true;
  const preparedOnly = realtime && request.execution !== 'deep';
  const current = snapshot(preparedOnly), revision = current.revision || knowledge.getProjectIndexRevision({ preparedOnly });
  const plan = request.projectPlan || { retrieve: false, scopes: [] };
  if (request.signal?.aborted) throw abortError();
  if (!plan.retrieve || !plan.scopes?.length) {
    const unavailable = realtime && plan.retrieve;
    const cold = unavailable && preparedOnly && !current.index;
    if (cold) setImmediate(() => knowledge.warmProjectIndex?.().catch(() => {}));
    return { evidence: [], byQuestion: [], missing: unavailable ? [{ reason: cold ? 'index-not-ready' : 'unresolved-project',
      message: cold ? '项目资料正在准备，本轮未获得已就绪的项目来源。' : '当前项目尚未绑定来源，不能推断具体实现或个人经历。' }] : [], context: '',
      revision, stats: { searchCalls: 0, groups: 0, retrievalPath: cold ? 'index-not-ready' : 'lexical-fallback',
        semanticReasons: [], retrievalConfigVersion: RETRIEVAL_CONFIG_VERSION } };
  }
  const service = request.semanticRetriever;
  const configVersion = `${RETRIEVAL_CONFIG_VERSION}:threshold=${request.semanticThreshold ?? .70}`;
  const modelVersion = typeof service?.status === 'function' ? service.status()?.modelVersion || '' : service?.modelVersion || '';
  const identity = retrievalIdentity({ ...request, question }, revision, modelVersion);
  if (realtime && request.origin === 'prediction' && request.projectContextCache && current.ready) {
    const seeds = (request.predictionSourceIds || []).slice(0, 6).map(id => current.byId?.get(String(id)))
      .filter(source => source && inProjectScope(source, plan.scopes));
    const linked = knowledge.getRelatedProjectEvidence(seeds, { scopes: plan.scopes, revision, preparedOnly: true, limit: 6, maxDepth: 2 });
    const canonical = knowledge.toProjectEvidence([...seeds, ...linked], { scopes: plan.scopes, revision })
      .filter(source => current.resolveSource(source));
    request.projectContextCache.put(plan.scopes, revision, canonical,
      { seed: true, modelVersion, retrievalConfigVersion: configVersion });
  }
  const { groups, missing: unretrieved } = groupQuestions(question, request.interviewPlan, plan, realtime);
  const waitMs = Number.isFinite(request.semanticWaitMs) ? request.semanticWaitMs : 100;
  const waitCap = request.execution === 'background' ? RETRIEVAL_POLICY.background.maxBudgetMs : 100;
  const deadlineAt = Math.min(Number.isFinite(request.deadlineAt) ? request.deadlineAt : Infinity,
    Date.now() + Math.max(0, Math.min(waitCap, waitMs)));
  let candidates = [], searchCalls = 0, lexicalMs = 0, semanticWorkerMs = 0, semanticReasons = [], candidateCounts = [];
  let retrievalPath = 'lexical-fallback', poolLookupMs = 0, poolCandidateCount = 0, poolSufficientHit = false;
  let pool;
  const prefetched = request.prefetchedRetrieval;
  if (prefetched?.identity === identity && prefetched.revision === revision) {
    candidates = prefetched.candidates || prefetched.evidence || [];
    if (realtime) candidates = candidates.filter(item => current.resolveSource?.(item));
    semanticReasons = prefetched.stats?.semanticReasons || [];
    retrievalPath = 'exact-ready';
  } else if (realtime && request.projectContextCache?.readCandidatesForQuestion) {
    const at = performance.now();
    pool = request.projectContextCache.readCandidatesForQuestion({ scopes: plan.scopes, revision, modelVersion,
      retrievalConfigVersion: configVersion, snapshot: current, question, interviewPlan: request.interviewPlan,
      projectPlan: plan, sourceBudget: request.contextBudget ?? 4000, formatContext: knowledge.formatRetrievedProjectContext });
    poolLookupMs = performance.now() - at; poolCandidateCount = pool.candidates.length;
    candidates = pool.candidates; poolSufficientHit = pool.sufficient && !unretrieved.length;
    retrievalPath = pool.sufficient ? 'pool-covered' : poolCandidateCount ? 'pool-partial' : 'lexical-fallback';
  }
  // Exact results are also reselected under the *actual* source budget. If a
  // completed result was insufficient, supplement the gaps rather than hiding them.
  if (retrievalPath === 'exact-ready' && realtime) {
    pool = selectEvidence({ candidates, question, interviewPlan: request.interviewPlan, projectPlan: plan,
      contextBudget: request.contextBudget ?? 4000, formatContext: knowledge.formatRetrievedProjectContext });
    poolSufficientHit = false;
  }
  const covered = pool && !pool.missing.length && pool.evidence.length;
  const shouldSearch = retrievalPath !== 'exact-ready' ? !poolSufficientHit : realtime && !covered;
  if (shouldSearch) {
    const missingIds = pool ? new Set(pool.missing.map(gap => gap.questionId)) : null;
    const searchGroups = missingIds ? groups.filter(group => group.questions.some(q => missingIds.has(q.id))) : groups;
    const bases = searchGroups.map(group => {
      const at = performance.now();
      const base = lexicalCandidates(group, current, { candidateLimit: CANDIDATE_LIMIT,
        hashFallback: request.hashFallback !== false, preparedOnly });
      lexicalMs += performance.now() - at; searchCalls++;
      return base;
    });
    if (bases.some(base => base.reason === 'index-not-ready')) {
      retrievalPath = 'index-not-ready';
      setImmediate(() => knowledge.warmProjectIndex?.().catch(() => {}));
    }
    const semantic = await Promise.all(searchGroups.map(group => semanticCandidates(service, group, request, deadlineAt)));
    if (request.signal?.aborted) throw abortError();
    for (let i = 0; i < searchGroups.length; i++) {
      const response = semantic[i];
      semanticWorkerMs += response.stats?.semanticWorkerMs || 0;
      if (response.revision && response.revision !== revision) { response.rows = []; response.reason = 'revision-mismatch'; }
      const currentModelVersion = typeof service?.status === 'function' ? service.status()?.modelVersion || '' : service?.modelVersion || '';
      if (modelVersion && ((response.modelVersion && response.modelVersion !== modelVersion) || currentModelVersion !== modelVersion)) {
        response.rows = []; response.reason = 'model-version-mismatch';
      }
      // Workers return source IDs and relevance only. Resolve every learned
      // hit to this coherent import snapshot; never accept returned replacement
      // text, fabricated locations or source metadata as a new fact.
      const chunks = current.chunks || current.index?.chunks || [];
      const byId = current.byId || (response.rows?.length ? new Map(chunks.filter(chunk => chunk.id != null).map(chunk => [String(chunk.id), chunk])) : null);
      response.rows = (response.rows || []).flatMap(row => {
        let source = byId?.get(String(row.id));
        if (!source && Number.isInteger(row.id)) source = chunks[row.id];
        if (!source && row.chunk) source = chunks.find(chunk => chunk.projectId === row.chunk.projectId &&
          chunk.path === row.chunk.path && chunk.startLine === row.chunk.startLine &&
          chunk.startOffset === row.chunk.startOffset && chunk.text === row.chunk.text);
        return source && inProjectScope(source, searchGroups[i].scopes) ? [{ ...row, chunk: source }] : [];
      });
      if (response.reason) semanticReasons.push(response.reason);
      const fused = fuseCandidates(bases[i], response, searchGroups[i].scopes, request);
      candidates.push(...fused.map(item => ({ ...item, questionIds: searchGroups[i].questions.map(q => q.id) })));
      candidateCounts.push({ questionIds: searchGroups[i].questions.map(q => q.id), lexical: bases[i]?.channels?.bm25?.length || bases[i]?.rows?.length || 0,
        semantic: response.rows?.length || 0, fused: fused.length });
    }
  }
  if (revision !== knowledge.getProjectIndexRevision({ preparedOnly })) return { evidence: [], byQuestion: [],
    missing: [{ text: question, reason: 'revision-changed' }], revision, identity, stats: { semanticReasons: ['revision-changed'], searchCalls } };
  const converted = knowledge.toProjectEvidence(candidates.map(item => ({ ...item,
    docType: item.docType ? inferDocType(item) : inferDocType({ ...item, docType: undefined }),
  })), { scopes: plan.scopes, revision });
  let selected = realtime && pool && !searchCalls ? { ...pool, missing: [...pool.missing, ...unretrieved] }
    : selectEvidence({ candidates: converted, question, interviewPlan: request.interviewPlan,
      projectPlan: plan, contextBudget: request.contextBudget ?? 4000, formatContext: knowledge.formatRetrievedProjectContext, unretrieved });
  if (searchCalls && selected.evidence.length && typeof knowledge.getRelatedProjectEvidence === 'function') {
    const linked = searchCalls ? knowledge.getRelatedProjectEvidence(selected.evidence, { scopes: plan.scopes, revision, preparedOnly, limit: 6, maxDepth: 2 }) : [];
    const expanded = linked.map(item => ({ ...item, relevanceApproved: true,
      questionIds: [...new Set(selected.evidence.filter(source => item.relation?.sourcePath === source.path || item.parentId && item.parentId === source.parentId)
        .flatMap(source => source.questionIds || []))],
      score: (selected.evidence[0]?.score || .02) * (item.relation?.status === 'resolved' ? .95 : .5) }));
    selected = selectEvidence({ candidates: [...converted, ...expanded], question, interviewPlan: request.interviewPlan,
      projectPlan: plan, contextBudget: request.contextBudget ?? 4000, formatContext: knowledge.formatRetrievedProjectContext, unretrieved });
    candidates = [...converted, ...expanded];
  } else candidates = converted;
  if (searchCalls && selected.evidence.length && typeof knowledge.getProjectParentEvidence === 'function') {
    const parents = searchCalls ? knowledge.getProjectParentEvidence(selected.evidence, { scopes: plan.scopes, revision, preparedOnly,
      maxChars: request.contextBudget ?? 4000, limit: Math.min(6, groups.length * 2) }).map(item => {
      const children = selected.evidence.filter(source => source.projectId === item.projectId && source.path === item.path &&
        item.text.includes(source.text));
      return { ...item, relevanceApproved: true, questionIds: [...new Set(children.flatMap(source => source.questionIds || []))],
        score: Math.max(0, ...children.map(source => source.score || 0)) * 1.03 };
    }) : [];
    candidates.push(...parents);
    selected = selectEvidence({ candidates, question, interviewPlan: request.interviewPlan,
      projectPlan: plan, contextBudget: request.contextBudget ?? 4000, formatContext: knowledge.formatRetrievedProjectContext, unretrieved });
  }
  if (request.signal?.aborted) throw abortError();
  if (request.projectContextCache && (searchCalls || retrievalPath === 'exact-ready')) {
    for (const scope of realtime ? plan.scopes : [null]) request.projectContextCache.put(scope ? [scope] : plan.scopes, revision,
      scope ? candidates.filter(item => inProjectScope(item, [scope]) && current.resolveSource?.(item)) : candidates,
      { modelVersion, retrievalConfigVersion: configVersion });
  }
  if (retrievalPath === 'index-not-ready') selected.missing.push({ reason: 'index-not-ready', text: question });
  return { ...selected, revision, identity, ...(request.includeCandidates ? { candidates } : {}),
    stats: { ...selected.stats, retrievalConfigVersion: configVersion, modelVersion,
      searchCalls, groups: groups.length, candidateCounts, lexicalMs, semanticWorkerMs, indexRevision: revision, semanticReasons: [...new Set(semanticReasons)],
      semanticWaitMs: Math.max(0, Math.min(waitCap, waitMs)), semanticThreshold: request.semanticThreshold ?? .70,
      retrievalPath, poolLookupMs, poolCandidateCount, poolSufficientHit: poolSufficientHit && !selected.missing.length,
      coveredNeeds: selected.byQuestion.reduce((sum, q) => sum + Math.max(0, q.evidenceNeeds.length - q.missing.length), 0), missingNeeds: selected.missing.length,
      prefetchAgeMs: prefetched?.prefetchAgeMs ?? null, prefetchOrigin: prefetched?.prefetchOrigin || null,
      exactPrefetchHit: !!prefetched && prefetched.identity === identity, retrievalMs: performance.now() - started } };
}

module.exports = { retrieveProjectEvidenceAsync, fuseCandidates, groupQuestions, retrievalIdentity,
  RETRIEVAL_CONFIG_VERSION, MAX_GROUPS, CANDIDATE_LIMIT };
