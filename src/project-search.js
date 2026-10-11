'use strict';
const { inProjectScope } = require('./project-scope');

// Hybrid local retrieval: BM25 + a lightweight dense feature-hash embedding.
// No live network/API dependency is introduced; the dense encoder is replaceable later.
const STOP_WORDS = new Set(('the a an is are was were be been to of in on for and or with from by how why what does do did you your we our this that it as can would should public private protected static final return const let var function class void new null true false import package string int if else try catch throws async await').split(' '));
const FILLER = /你们|我们|你在|项目中|项目里|项目的|这个项目|那个项目|项目|这个|那个|什么|为什么|怎么样|怎样|怎么|如何|哪些|有没有|能不能|可不可以|介绍一下|讲一下|说一下|说说|讲讲|请问|具体|实现的|保证的|一下|刚才|提到|里面|中的|避免|防止|保证|使用|采用|实现|方法|有什么|有啥|负责|设计/g;
const ALIASES = [
  ['缓存', 'cache', 'caching'], ['消息队列', '消息中间件', 'mq'],
  ['分布式锁', 'distributedlock', 'distributed lock'],
  ['限流', 'ratelimit', 'rate limit', 'ratelimiter'],
  ['熔断', 'circuitbreaker', 'circuit breaker'],
  ['幂等', 'idempotency', 'idempotent'], ['去重', 'deduplication', 'dedup'],
  ['重复消费', '幂等', 'idempotency', 'idempotent', 'deduplication'],
  ['重试', 'retry', 'retries'], ['一致性', 'consistency'],
  ['检索增强', 'rag'], ['大模型', 'llm'], ['向量', 'vector', 'embedding'],
  ['记忆', 'memory'], ['超时', 'timeout'], ['回调', 'callback'],
  ['事务', 'transaction', 'transactional'], ['并发', 'concurrency', 'concurrent']
];


const DENSE_DIM = 128;
function hash32(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function l2normalize(vec) {
  let n = 0; for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1; for (let i = 0; i < vec.length; i++) vec[i] /= n;
  return vec;
}
function denseEmbedding(value, query = false) {
  const text = normalize(value);
  const vec = new Float32Array(DENSE_DIM);
  const freq = frequency(tokenize(value, query));
  for (const [token, count] of freq) {
    const h = hash32(token);
    const idx = h % DENSE_DIM;
    vec[idx] += ((h & 0x80000000) ? -1 : 1) * (1 + Math.log1p(count));
  }
  // Known bilingual concepts share a stable dimension, so “缓存一致性” can
  // still meet code that mostly says cache/consistency even with weak lexical overlap.
  ALIASES.forEach((group, i) => {
    if (group.some(alias => /[\u3400-\u9fff]/.test(alias) ? text.includes(alias) : new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))) {
      vec[(i * 17 + 7) % DENSE_DIM] += 3;
    }
  });
  return l2normalize(vec);
}
function cosineDense(a, b) {
  let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(value, query = false) {
  let text = String(value || '').normalize('NFKC')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (query) text = text.replace(FILLER, ' ');
  const terms = [];
  // Retain complete identifiers as well as their camel/snake components.
  for (const word of normalize(value).match(/[a-z][a-z0-9_]{1,63}/g) || []) {
    if (!STOP_WORDS.has(word)) terms.push(word);
  }
  for (const word of text.match(/[a-z][a-z0-9]{1,63}/g) || []) {
    if (!STOP_WORDS.has(word)) terms.push(word);
  }
  for (const block of text.match(/[\u3400-\u9fff]+/g) || []) {
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= block.length; i++) {
        const term = block.slice(i, i + n);
        if (!query || !/^(?:的吗|的呢|的是|是怎么|么做|么用)$/.test(term)) terms.push(term);
      }
    }
  }
  return terms;
}

function frequency(tokens) {
  const map = new Map();
  for (const token of tokens) map.set(token, Math.min(12, (map.get(token) || 0) + 1));
  return map;
}

function querySpec(query) {
  const normalized = normalize(query);
  let remainder = String(query || '').replace(FILLER, ' ');
  const weights = new Map();
  const originalSet = new Set();
  const groups = [];
  for (const group of ALIASES) {
    const matched = group.filter(alias => /[\u3400-\u9fff]/.test(alias)
      ? normalized.includes(alias)
      : new RegExp(`\\b${alias}\\b`, 'i').test(normalized));
    if (!matched.length) continue;
    const tokens = [...new Set(group.flatMap(alias => tokenize(alias)))];
    if (!groups.some(g => g.join('|') === tokens.join('|'))) groups.push(tokens);
    for (const alias of matched) {
      for (const token of tokenize(alias)) { originalSet.add(token); weights.set(token, 1); }
      remainder = remainder.replace(new RegExp(alias, 'gi'), ' ');
    }
    for (const token of tokens) if (!weights.has(token)) weights.set(token, 0.5);
  }
  // Separate known concepts before n-grams, avoiding noise such as 缓存一 / 存一致.
  for (const block of remainder.match(/[A-Za-z][A-Za-z0-9_]*|[\u3400-\u9fff]+/g) || []) {
    const tokens = [...new Set(tokenize(block, true))];
    if (!tokens.length) continue;
    groups.push(tokens);
    for (const token of tokens) { originalSet.add(token); weights.set(token, 1); }
  }
  const boundedWeights = new Map([...weights].slice(0, 80));
  const original = [...originalSet].filter(t => boundedWeights.has(t));
  const boundedGroups = groups.map(g => g.filter(t => boundedWeights.has(t))).filter(g => g.length);
  return { original, weights: boundedWeights, groups: boundedGroups, key: JSON.stringify([...boundedWeights]) };
}

class ProjectSearch {
  constructor(chunks) {
    this.chunks = chunks;
    this.postings = new Map();
    this.lengths = [];
    this.totalLength = 0;
    this.symbols = [];
    this.embeddings = [];
    this.cache = new Map();
    this.termCache = new Map();
  }

  add(id) {
    const chunk = this.chunks[id];
    const bodyTokens = tokenize(chunk.text);
    const body = frequency(bodyTokens);
    const fields = [body, frequency(tokenize(chunk.path)), frequency(tokenize(String(chunk.symbol || '').split('#').at(-1)))];
    const terms = new Set(fields.flatMap(f => [...f.keys()]));
    this.lengths[id] = Math.max(1, bodyTokens.length);
    this.totalLength += this.lengths[id];
    this.symbols[id] = normalize(chunk.symbol || '');
    this.embeddings[id] = denseEmbedding(`${chunk.path} ${chunk.symbol || ''} ${chunk.text}`);
    for (const term of terms) {
      let list = this.postings.get(term);
      if (!list) this.postings.set(term, list = []);
      list.push([id, body.get(term) || 0, fields[1].has(term) ? 1 : 0, fields[2].has(term) ? 1 : 0]);
    }
  }

  static build(chunks) {
    const index = new ProjectSearch(chunks);
    for (let i = 0; i < chunks.length; i++) index.add(i);
    return index;
  }

  static async buildAsync(chunks) {
    const index = new ProjectSearch(chunks);
    for (let i = 0; i < chunks.length; i++) {
      index.add(i);
      if (i % 40 === 39) await new Promise(resolve => setImmediate(resolve));
    }
    return index;
  }

  remember(cache, key, value, limit) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }

  contributions(term) {
    const cached = this.termCache.get(term);
    if (cached) return this.remember(this.termCache, term, cached, 64);
    const postings = this.postings.get(term) || [];
    const n = this.chunks.length;
    const idf = Math.log(1 + (n - postings.length + 0.5) / (postings.length + 0.5));
    const avg = this.totalLength / Math.max(n, 1);
    const rows = postings.map(([id, tf, path, symbol]) => {
      const bm25 = tf ? tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.lengths[id] / avg)) : 0;
      return [id, idf * (bm25 + path * 2.4 + symbol * 3.2), path || symbol, !!(tf || symbol)];
    });
    // Very common terms are cheap to recompute, expensive to retain for every interim.
    if (rows.length <= 1500) this.remember(this.termCache, term, rows, 64);
    return rows;
  }

  rank(query, scopes = []) {
    const spec = querySpec(query);
    const key = spec.key + '\n' + normalize(query) + '\n' + JSON.stringify(scopes);
    if (this.cache.has(key)) return { rows: this.remember(this.cache, key, this.cache.get(key), 32), cacheHit: true, candidates: 0, postingsVisited: 0 };
    const candidates = new Map();
    let postingsVisited = 0;
    let denseScanned = 0;
    let denseCandidates = 0;
    for (const [term, weight] of spec.weights) {
      for (const [id, score, fieldMatch, contentMatch] of this.contributions(term)) {
        postingsVisited++;
        let item = candidates.get(id);
        if (!item) candidates.set(id, item = { id, score: 0, matched: new Set(), contentMatched: new Set(), fieldMatch: false });
        item.score += score * weight;
        item.matched.add(term);
        if (contentMatch) item.contentMatched.add(term);
        if (fieldMatch && weight === 1) item.fieldMatch = true;
      }
    }
    const queryVector = denseEmbedding(query, true);
    for (let id = 0; id < this.chunks.length; id++) {
      const chunk = this.chunks[id];
      if (!inProjectScope(chunk, scopes)) continue;
      denseScanned++;
      const similarity = cosineDense(queryVector, this.embeddings[id]);
      if (similarity < 0.16) continue;
      denseCandidates++;
      let item = candidates.get(id);
      if (!item) candidates.set(id, item = { id, score: 0, matched: new Set(), contentMatched: new Set(), fieldMatch: false });
      item.denseSimilarity = Math.max(item.denseSimilarity || 0, similarity);
    }
    const q = normalize(query);
    const rows = [];
    for (const item of candidates.values()) {
      const chunk = this.chunks[item.id];
      if (!inProjectScope(chunk, scopes)) continue;
      const coverage = spec.groups.length ? spec.groups.filter(g => g.some(t => item.matched.has(t))).length / spec.groups.length : 0;
      const originalMatches = spec.original.filter(t => item.matched.has(t)).length;
      const termCoverage = spec.original.length ? originalMatches / spec.original.length : 0;
      const exactSymbol = !!this.symbols[item.id] && this.symbols[item.id].split(/[.#]/).some(s => s.length > 3 && q.includes(s));
      const aliasMatch = spec.groups.some(g => g.some(t => item.contentMatched.has(t)) && g.some(t => !spec.original.includes(t)));
      // This is a heuristic relevance level, not a calibrated probability.
      const dense = item.denseSimilarity || 0;
      const confidence = Math.min(1, 0.36 * coverage + 0.31 * termCoverage + (item.fieldMatch ? 0.14 : 0) + (exactSymbol ? 0.32 : 0) + (aliasMatch ? 0.13 : 0) + Math.min(0.48, dense * 0.68));
      let score = item.score * (0.5 + 0.5 * coverage) + dense * 7.5;
      if (exactSymbol) score += 10;
      if (!/测试|test\b/i.test(query) && /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(chunk.path)) score *= 0.85;
      if (/架构|概览|overview|architecture/i.test(query) && /readme|docs?\/|architecture/i.test(chunk.path)) score *= 1.2;
      if (score > 0) rows.push({ chunk, score, confidence, coverage, originalMatches, denseSimilarity: dense });
    }
    rows.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine);
    const top = rows.slice(0, 60);
    this.remember(this.cache, key, top, 32);
    return { rows: top, cacheHit: false, candidates: candidates.size, postingsVisited, denseScanned, denseCandidates };
  }
}

module.exports = { ProjectSearch, tokenize, querySpec, denseEmbedding, cosineDense };
