'use strict';

const { tokenize } = require('./project-search');
const { TOPICS } = require('./project-profile');
const { inProjectScope } = require('./project-scope');

const CACHE_SCHEMA_VERSION = 1;
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
  return `${item.projectId || ''}:${item.path}:${item.startLine}:${item.endLine}`;
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
  constructor({ maxEntries = 8, maxEvidence = 24, maxChars = 18000, ttlMs = 20 * 60 * 1000, now = Date.now,
    schemaVersion = CACHE_SCHEMA_VERSION } = {}) {
    Object.assign(this, { maxEntries, maxEvidence, maxChars, ttlMs, now, schemaVersion });
    this.entries = new Map();
  }

  key(scopes, revision) { return JSON.stringify([this.schemaVersion, String(revision || ''), normalizeScopes(scopes)]); }

  get(scopes, revision) {
    const key = this.key(scopes, revision);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.updatedAt > this.ttlMs) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry;
  }

  put(scopes, revision, evidence, { seed = false } = {}) {
    const normalized = normalizeScopes(scopes);
    if (!normalized.length || !revision) return null;
    const key = this.key(normalized, revision);
    // An updated index cannot reuse any excerpt from the previous revision.
    for (const [oldKey, entry] of this.entries) {
      if (JSON.stringify(entry.scopes) === JSON.stringify(normalized) && oldKey !== key) this.entries.delete(oldKey);
    }
    const old = this.get(normalized, revision);
    const seen = new Set(), selected = [];
    let chars = 0;
    for (const item of [...(evidence || []), ...(old?.evidence || [])]) {
      if (!sourceEvidence(item, normalized) || seen.has(evidenceKey(item))) continue;
      const room = this.maxChars - chars;
      if (selected.length >= this.maxEvidence || room < 100) break;
      const text = item.text.length > room ? item.text.slice(0, room) : item.text;
      const excerpt = item.text.length > room ? { ...item, text,
        endLine: item.startLine + (text.match(/\n/g) || []).length, partial: true } : { ...item };
      excerpt.topics = [...(item.topics || [])];
      selected.push(excerpt); seen.add(evidenceKey(item)); chars += excerpt.text.length;
    }
    const entry = { scopes: normalized, revision, evidence: selected, updatedAt: this.now(), searched: old?.searched || !seed };
    this.entries.delete(key); this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return entry;
  }

  lookup(scopes, revision, query, interviewPlan) {
    const entry = this.get(scopes, revision);
    if (!entry || !entry.searched) return { hit: false, evidence: [], missing: requirements(query, interviewPlan).map(n => n.text) };
    return assessEvidence(entry.evidence, entry.scopes, query, interviewPlan);
  }

  clear() { this.entries.clear(); }
}

module.exports = { ActiveProjectContextCache, CACHE_SCHEMA_VERSION, normalizeScopes, requirements, assessEvidence };
