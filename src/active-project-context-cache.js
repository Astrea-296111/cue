'use strict';

const { tokenize, ProjectSearch } = require('./project-search');
const { createHash } = require('node:crypto');
const { RETRIEVAL_POLICY } = require('./project-prefetch-policy');
const { TOPICS } = require('./project-profile');
const { inProjectScope } = require('./project-scope');
const { selectEvidence } = require('./evidence-selector');

const CACHE_SCHEMA_VERSION = 3;
const hash = text => createHash('sha256').update(String(text)).digest('hex');
const QUESTION_FIELDS = ['questionIds', 'score', 'confidence', 'coverage', 'relevance', 'semanticSimilarity',
  'relevanceApproved', 'channels', 'originalMatches', 'matched', 'contentMatched', 'fieldMatch', 'validatedQuestionIds'];
function cleanSource(item) {
  const copy = { ...item };
  for (const field of QUESTION_FIELDS) delete copy[field];
  return copy;
}
const TECH_RE = /\b(?:redis|mysql|postgres(?:ql)?|kafka|rabbitmq|rocketmq|langgraph|langchain|mongodb|react|docker|kubernetes|jwt|oauth|grpc|websocket|faiss|bm25|rag)\b/gi;
const CODE_REQUEST = /(?:代码|源码|哪个(?:文件|方法|类)|在哪(?:里)?实现|具体实现|定位|调用链|source|implementation|which (?:file|method|class)|where .*implement)/i;
const RATIONALE = /为什么|为何|选型|取舍|不用|why|trade.?off|choose|chosen/i;
const FAILURE = /挂了|宕机|故障|失效|不可用|失败|outage|failure|unavailable|fail(?:s|ed)?|down\b/i;
const rationaleEvidence = /因为|为了|选择|选用|原因|避免|权衡|取舍|代价|缺点|优点|because|chose|choose|chosen|trade.?off|instead|reason|advantage|drawback/i;
const failureEvidence = /降级|重试|熔断|回退|补偿|超时|恢复|异常|不可用|fallback|retry|retries|circuit|catch\s*\(|except\b|timeout|recover|unavailable/i;
const STOP = new Set(['项目', '这个', '那个', '刚才', '什么', '为什么', '如何', '怎么', '介绍', '请问', '一下', 'the', 'this', 'that', 'project', 'why', 'how', 'what', 'please']);

function normalizeScopes(scopes = []) {
  return [...new Set(scopes.map(scope => String(scope || '').replace(/\\/g, '/')).filter(Boolean))].sort();
}

function evidenceKey(item) {
  return `${item.projectId || ''}:${item.path}:${item.startOffset ?? item.startLine}:${item.endOffset ?? item.endLine}:${item.revision || ''}`;
}

function sourceEvidence(item, scopes) {
  // The cache only accepts imported file excerpts, never model answers or a
  // summary whose source location has been lost.
  return item && item.sourceType === 'imported' && typeof item.text === 'string' &&
    !/assistant|generated|llm/i.test(String(item.origin || item.source || '')) &&
    typeof item.path === 'string' && item.path && Number.isInteger(item.startLine) && item.startLine >= 1 &&
    Number.isInteger(item.endLine) && item.endLine >= item.startLine && inProjectScope(item, scopes);
}

function requirements(query, interviewPlan) {
  const questions = interviewPlan?.subQuestions?.map(q => typeof q === 'string' ? q : q.text).filter(Boolean);
  const texts = questions?.length ? questions : [String(query || '')];
  const globalSymbols = (interviewPlan?.symbols || []).filter(s => typeof s === 'string');
  return texts.map(text => {
    const topics = TOPICS.filter(topic => topic.re.test(text)).map(topic => topic.key);
    const specific = topics.filter(topic => !['overview', 'responsibility', 'tradeoff'].includes(topic));
    const entities = [...new Set((text.match(TECH_RE) || []).map(t => t.toLowerCase()))];
    const code = CODE_REQUEST.test(text);
    const symbols = [...new Set([...globalSymbols, ...(code ? (text.match(/\b[A-Z][A-Za-z0-9]*(?:Controller|Service|Repository|Handler|Manager)|\b[a-zA-Z_$][\w$]*(?=\s*\()/g) || []) : [])])];
    const terms = [...new Set(tokenize(text, true))].filter(term => term.length > 1 && !STOP.has(term));
    return { text, topics: specific.length ? specific : topics.filter(t => t !== 'tradeoff'), entities, symbols, code,
      rationale: RATIONALE.test(text), failure: FAILURE.test(text), terms };
  });
}

function supports(item, need) {
  const text = `${item.symbol || ''}\n${item.text}`;
  const lower = text.toLowerCase();
  if (need.entities.some(entity => !lower.includes(entity))) return false;
  if (need.symbols.some(symbol => !text.includes(symbol))) return false;
  if (need.code && !['function', 'method', 'class', 'interface', 'code'].includes(item.kind)) return false;
  // A broad business-flow/code-location question does not identify a method.
  // An arbitrary cached method cannot prove coverage; let scoped retrieval
  // resolve the business mapping and its actual cross-file call chain.
  if (need.code && !need.symbols.length) return false;
  if (need.rationale && !rationaleEvidence.test(item.text)) return false;
  if (need.failure && !failureEvidence.test(item.text)) return false;
  const topics = item.topics || [];
  if (need.topics.length && !need.topics.every(topic => topics.includes(topic) || TOPICS.find(t => t.key === topic)?.re.test(text))) return false;
  if (!need.entities.length && !need.symbols.length && !need.topics.length) {
    const terms = new Set(tokenize(text, true));
    const overlap = need.terms.filter(term => terms.has(term)).length;
    if (!need.terms.length || overlap < Math.min(3, need.terms.length) || overlap / need.terms.length < .45) return false;
  }
  return true;
}

function assessEvidence(items, scopes, query, interviewPlan) {
  if (interviewPlan?.subQuestions?.some(question => question.evidenceNeeds?.length)) {
    const selected = selectEvidence({ candidates: items, question: query, interviewPlan,
      projectPlan: { scopes }, contextBudget: 18000 });
    return { hit: !!selected.evidence.length && !selected.missing.length,
      evidence: selected.evidence, missing: [...new Set(selected.missing.map(item => item.text))], byQuestion: selected.byQuestion };
  }
  const needs = requirements(query, interviewPlan), missing = [], selected = [], extra = [], seen = new Set();
  const add = item => {
    if (!seen.has(evidenceKey(item))) { selected.push({ ...item }); seen.add(evidenceKey(item)); }
  };
  for (const need of needs) {
    const matches = items.filter(item => supports(item, need));
    if (!matches.length || scopes.some(scope => !matches.some(item => inProjectScope(item, [scope])))) missing.push(need.text);
    // Reserve one source for each need/project before adding optional detail.
    for (const scope of scopes) {
      const own = matches.filter(item => inProjectScope(item, [scope]));
      if (own.length) add(own[0]);
    }
    extra.push(...matches.slice(0, 3));
  }
  for (const item of extra) add(item);
  return { hit: needs.length > 0 && !missing.length && selected.length > 0, evidence: selected, missing };
}

class ActiveProjectContextCache {
  constructor({ maxEntries = RETRIEVAL_POLICY.poolMaxEntries, maxEvidence = RETRIEVAL_POLICY.poolMaxEvidence,
    maxChars = RETRIEVAL_POLICY.poolMaxChars, ttlMs = 20 * 60 * 1000, now = Date.now, maxProjects = 2,
    schemaVersion = CACHE_SCHEMA_VERSION } = {}) {
    Object.assign(this, { maxEntries, maxEvidence, maxChars, ttlMs, now, schemaVersion, maxProjects });
    this.entries = new Map();
  }

  key(scopes, revision, identity = {}) { return JSON.stringify([this.schemaVersion, String(revision || ''), normalizeScopes(scopes),
    identity.modelVersion || '', identity.retrievalConfigVersion || '']); }

  get(scopes, revision, identity = {}) {
    const key = this.key(scopes, revision, identity);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.updatedAt > this.ttlMs) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry;
  }

  put(scopes, revision, evidence, { seed = false, modelVersion = '', retrievalConfigVersion = '' } = {}) {
    const normalized = normalizeScopes(scopes);
    if (!normalized.length || !revision) return null;
    const identity = { modelVersion, retrievalConfigVersion };
    const key = this.key(normalized, revision, identity);
    // An updated index cannot reuse any excerpt from the previous revision.
    for (const [oldKey, entry] of this.entries) {
      if (entry.revision !== revision) this.entries.delete(oldKey);
    }
    const old = this.get(normalized, revision, identity);
    const seen = new Set(), selected = [];
    let chars = 0;
    for (const item of [...(evidence || []), ...(old?.evidence || [])]) {
      if (!sourceEvidence(item, normalized) || seen.has(evidenceKey(item))) continue;
      const room = this.maxChars - chars;
      if (selected.length >= this.maxEvidence || room < 100) break;
      // Source cache never manufactures a prefix excerpt that silently loses
      // the result or verification at the end of a story/table/function.
      if (item.text.length > room) continue;
      const excerpt = { ...cleanSource(item), sourceHash: hash(item.text) };
      excerpt.topics = [...(item.topics || [])];
      selected.push(excerpt); seen.add(evidenceKey(item)); chars += excerpt.text.length;
    }
    const entry = { scopes: normalized, revision, modelVersion, retrievalConfigVersion,
      evidence: selected, updatedAt: this.now(), searched: old?.searched || !seed, generation: (old?.generation || 0) + 1 };
    this.entries.delete(key); this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    const projects = [...new Set([...this.entries.values()].flatMap(value => value.scopes))];
    while (projects.length > this.maxProjects) {
      const evicted = projects.shift();
      for (const [entryKey, value] of this.entries) if (value.scopes.includes(evicted)) this.entries.delete(entryKey);
    }
    return entry;
  }

  readCandidatesForQuestion({ scopes, revision, modelVersion = '', retrievalConfigVersion = '', snapshot,
    question, interviewPlan, projectPlan, sourceBudget = 3600, formatContext } = {}) {
    const own = normalizeScopes(scopes), candidates = [];
    // Comparisons may reuse each project's pool, but each demand keeps its own scope.
    const entries = own.flatMap(scope => [this.get([scope], revision, { modelVersion, retrievalConfigVersion })]);
    if (own.length > 1) entries.push(this.get(own, revision, { modelVersion, retrievalConfigVersion }));
    const seen = new Set();
    for (const entry of entries.filter(Boolean)) {
      if (!entry.searched) continue;
      if (!entry.search) {
        const restored = [];
        for (const cached of entry.evidence) {
          const source = snapshot?.resolveSource?.(cached);
          if (!source || hash(source.text) !== cached.sourceHash || !inProjectScope(source, own)) continue;
          restored.push({ ...cleanSource(source), id: cached.id, sourceType: 'imported', revision, sourceHash: cached.sourceHash });
        }
        entry.search = ProjectSearch.build(restored);
      }
      const questions = interviewPlan?.subQuestions?.length ? interviewPlan.subQuestions : [{ text: question }];
      for (const [index, q] of questions.entries()) {
        const text = typeof q === 'string' ? q : q.text;
        const guardedText = [text, interviewPlan?.scenario, ...(interviewPlan?.constraints || [])].filter(Boolean).join('\n');
        const binding = projectPlan?.subQuestionScopes?.find(b => b.questionId === q.id);
        const qScopes = binding?.scopes || q.scopes || own;
        const anchor = index > 0 && !(q.topics || []).length
          ? questions.slice(0, index).find(previous => (previous.topics || []).length &&
            (projectPlan?.subQuestionScopes?.find(b => b.questionId === previous.id)?.scopes || own).join('|') === qScopes.join('|'))?.text : '';
        const need = requirements(guardedText, { symbols: interviewPlan?.symbols })[0];
        const locating = /代码.*(?:哪|位置)|源码.*(?:哪|位置)|哪个(?:文件|方法|类)|在哪(?:里)?实现|调用链|which (?:file|method|class)|where .*implement/i.test(text);
        const rows = entry.search.getCandidates([text, anchor].filter(Boolean).join('\n'), qScopes, { hashFallback: false, candidateLimit: 25 });
        for (const row of rows.rows || []) {
          const source = cleanSource(row.chunk || row), body = `${source.symbol || ''}\n${source.path}\n${source.text}`.toLowerCase();
          if (need.entities.some(entity => !body.includes(entity)) || need.symbols.some(symbol => !body.includes(symbol.toLowerCase()))) continue;
          const negatives = [...guardedText.matchAll(/(?:不用|不使用|不采用|不加|没(?:有)?用|不是|并非)\s*([A-Za-z][\w.-]*|[\u4e00-\u9fff]{2,10})/g)];
          if (negatives.some(match => !source.text.toLowerCase().includes(match[0].toLowerCase()))) continue;
          if (locating && !need.symbols.length) continue;
          const explicit = [...text.matchAll(/`([^`]+)`|\b([A-Z][A-Z0-9_]{1,}|[A-Z][\w]*(?:Service|Repository|Controller|Manager))\b/g)]
            .map(match => match[1] || match[2]).filter(value => !/^(?:SQL|HTTP|JWT|RAG)$/.test(value) &&
              !(source.docType === 'environment' && /^(?:P\d+|QPS|TPS)$/.test(value)));
          if (explicit.some(value => !body.includes(value.toLowerCase()))) continue;
          const id = `${evidenceKey(source)}:${q.id || 'question-' + index}`;
          if (seen.has(id)) continue;
          seen.add(id);
          candidates.push({ ...source, score: row.score, confidence: row.confidence, relevance: row.relevance || row.coverage,
            questionIds: [q.id || 'question-' + index], validatedQuestionIds: [q.id || 'question-' + index], channels: ['pool-lexical'] });
        }
      }
    }
    const selected = selectEvidence({ candidates, question, interviewPlan, projectPlan: projectPlan || { scopes: own },
      contextBudget: sourceBudget, formatContext });
    return { ...selected, candidates, sufficient: !!selected.evidence.length && !selected.missing.length,
      coverageByQuestion: selected.byQuestion };
  }

  // A foreground instant answer may inspect only a small existing raw pool.
  // Unlike readCandidatesForQuestion this never builds postings or invokes the
  // selector. Canonical validation and current-question matching belong to the
  // caller; question-specific approvals are never returned.
  peekRawSources(scopes, revision, identity = {}, { maxCandidates = 8 } = {}) {
    const own = normalizeScopes(scopes).slice(0, 2);
    const limit = Math.max(0, Math.min(8, Number(maxCandidates) || 0));
    if (!own.length || !revision || !limit) return [];
    const keys = [this.key(own, revision, identity)];
    if (own.length > 1) for (const scope of own) keys.push(this.key([scope], revision, identity));
    const result = [], seen = new Set();
    let inspected = 0;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry || entry.revision !== revision || this.now() - entry.updatedAt > this.ttlMs) continue;
      for (const source of entry.evidence) {
        if (++inspected > limit) return result;
        if (!sourceEvidence(source, own) || seen.has(evidenceKey(source))) continue;
        seen.add(evidenceKey(source)); result.push(cleanSource(source));
      }
    }
    return result;
  }

  lookup(scopes, revision, query, interviewPlan, identity = {}) {
    const entry = this.get(scopes, revision, identity);
    if (!entry || !entry.searched) return { hit: false, evidence: [], missing: requirements(query, interviewPlan).map(n => n.text) };
    return assessEvidence(entry.evidence, entry.scopes, query, interviewPlan);
  }

  clear() { this.entries.clear(); }
}

module.exports = { ActiveProjectContextCache, CACHE_SCHEMA_VERSION, normalizeScopes, requirements, assessEvidence, cleanSource };
