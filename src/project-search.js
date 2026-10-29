'use strict';
const { inProjectScope } = require('./project-scope');

// Local BM25 + deterministic feature hashing. The hash channel is not a learned
// semantic embedding. Optional providers must implement the synchronous contract
// below; no provider is configured, loaded or contacted by default.
const STOP_WORDS = new Set(('the a an is are was were be been to of in on for and or with from by how why what does do did you your we our this that it as can would should public private protected static final return const let var function class void new null true false import package string int if else try catch throws async await').split(' '));
const FILLER = /你们|我们|你在|项目中|项目里|项目的|这个项目|那个项目|项目|这个|那个|什么|为什么|怎么样|怎样|怎么|如何|哪些|有没有|能不能|可不可以|介绍一下|讲一下|说一下|说说|讲讲|请问|具体|实现的|保证的|一下|刚才|提到|里面|中的|避免|防止|保证|使用|采用|实现|方法|有什么|有啥|负责|设计/g;
const ALIASES = [
  ['缓存', 'cache', 'caching'], ['消息队列', '消息中间件', 'mq'],
  ['分布式锁', 'distributedlock', 'distributed lock'],
  ['限流', 'ratelimit', 'rate limit', 'ratelimiter'],
  ['熔断', 'circuitbreaker', 'circuit breaker'],
  ['幂等', 'idempotency', 'idempotent'], ['去重', 'deduplication', 'dedup'],
  ['重复执行', 'duplicate task execution', 'duplicate execution'],
  ['重复消费', '幂等', 'idempotency', 'idempotent', 'deduplication'],
  ['重试', 'retry', 'retries'], ['一致性', 'consistency'],
  ['状态', 'status', 'state'], ['领取', '认领', 'claim'], ['租约', 'lease'],
  ['排队', 'waiting', 'queued'], ['学科', 'discipline', 'analysis_type'], ['候选', 'candidate'],
  ['批次', 'batch'], ['接入', 'admit', 'admission'], ['保存', 'save'], ['永久', 'permanent'], ['锁', 'lock', 'locked'],
  ['规则', 'rule', 'rules'], ['匹配', 'match', 'matches'], ['优先级', 'priority'],
  ['永久允许', 'always allow', 'allow_always'],
  ['用户级', 'user'], ['项目级', 'project'], ['本地级', 'local'],
  ['背压', 'backpressure'], ['积压', 'backlog'], ['暂停', 'pause', 'paused'], ['阈值', 'threshold'],
  ['唯一索引', '唯一约束', 'unique', 'duplicate key'],
  ['崩溃', '崩了', 'crash'], ['确认', 'confirm'], ['持久化', 'persistent', 'persistence', 'durable'],
  ['检索增强', 'rag'], ['大模型', 'llm'], ['向量', 'vector', 'embedding'],
  ['记忆', 'memory'], ['超时', 'timeout'], ['回调', 'callback'],
  ['事务', 'transaction', 'transactional'], ['并发', 'concurrency', 'concurrent'],
  ['资源准入', '资源预留', '资源预占', '资源预约', 'resource reservation', 'admission', 'reservation'],
  ['调度', 'scheduler', 'scheduling'], ['报告', '报告生成', '结果导出', 'report', 'reporting', 'report generation', 'result export'],
  ['权限', '鉴权', '授权', 'authorization', 'permission', 'access'], ['租户', 'tenant', 'tenancy'],
  ['取消', 'cancel', 'cancellation'], ['对账', 'reconcile', 'reconciliation'], ['执行', 'execution'],
  ['状态机', 'state machine', 'transition'], ['共享任务', '任务认领', 'shared task', 'claim'],
  ['邮箱', 'mailbox', '消息确认', 'acknowledge'],
  ['节点', 'worker', 'agent'], ['执行身份', '执行标识', 'execution identity', 'request_id', 'executionrequestid', 'submitrequestid'],
  ['求解进程', '进程启动', 'spawn', 'subprocess', 'process'], ['受理', 'submit', 'submission'],
  ['状态回传', 'callback'], ['消息', 'message', 'event', 'delivery'],
  ['会话', 'session', 'conversation'], ['恢复', 'resume', 'recovery', 'restore'],
  ['工具输出', '工具返回', 'tool result', 'tool output', 'tool_result', 'persisted output'],
  ['长输出', '大输出', '几十万字', '超长输出', 'large output', 'large tool result', 'persisted output', 'persist_tool_result'],
  ['压缩', 'compact', 'compaction', 'summary'], ['替换状态', 'replacement', 'replacement_records']
];

// Share the source search vocabulary with fact-card ranking. Translate only
// recognized whole-word aliases; never rewrite the question or source sent to
// the model. Longest phrases win over their component words.
const CONCEPT_NAMES=new Map(ALIASES.flatMap(group=>group.filter(alias=>/^[a-z ]+$/.test(alias)).map(alias=>[alias,group[0]])));
const CONCEPT_PATTERN=new RegExp('\\b(?:'+[...CONCEPT_NAMES.keys()].sort((a,b)=>b.length-a.length).map(alias=>alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','gi');
function normalizeConceptText(value) {
  return String(value||'').replace(CONCEPT_PATTERN,alias=>CONCEPT_NAMES.get(alias.toLowerCase())||alias)
    .replace(/\b(?:how|do|does|did|you|your|we|our|the|a|an|after|before|when|what|which|why|would|could|should|handle|prevent)\b/gi,' ');
}

// A project manifest is useful orientation, but cannot replace implementation
// evidence. Match identifiers to code paths/symbols without project-specific
// file lists or expected-answer rules.
function implementationQuery(query) {
  if(!/实现|源码|代码|接口|执行|取消|报告|权限|幂等|事务|并发|恢复|隔离|持久化|状态|规则|匹配|暂停|接入|排队|计算|阈值|预算|压缩|函数|\b(?:code|implementation|function|threshold|budget|compact|Outbox|Inbox|execution|timeout|retries|retry|duplicate|idempotency|transaction)\b/i.test(query))return null;
  return [...new Set(String(query).match(/\b[A-Za-z][A-Za-z0-9_]{2,63}\b/g)||[])].map(normalize)
    .filter(word=>!STOP_WORDS.has(word));
}
const implementationBodyCache=new WeakMap();
function hasImplementationBody(chunk) {
  const input=String(chunk.text||''),previous=implementationBodyCache.get(chunk);
  if(previous?.text===input)return previous.result;
  const text=require('./project-chunks').maskCode(String(chunk.text||''),/\.py$/i.test(chunk.path||''));
  const result=/\b(?:return|throw|if|for|while|try|await|with|yield|update|insert|delete|create\s+table)\b|\b\w+\.\w+\s*\(/i.test(text)||
    /\binterface\s+\w+(?:<[^>]*>)?\s+extends\s+\w+/.test(text) ||
    /\.py$/i.test(chunk.path || '') && /^[A-Z_][A-Z0-9_]*\s*(?::[^=\n]+)?\s*=\s*(?:[\[{]|[+-]?\d[\d_]*(?:\.\d+)?(?:\s|$))/m.test(text);
  implementationBodyCache.set(chunk,{text:input,result});return result;
}
function implementationWeight(identifiers, chunk) {
  if(!identifiers)return 1;
  const code=/\.(?:java|py|[cm]?[jt]sx?|go|rs|c|cpp|h|cs|sql)$/i.test(chunk.path||'');
  if(!code)return /(?:^|\/)interview\/project\.md$|(?:^|\/)readme\./i.test(chunk.path||'') ? 0.4 : 1;
  const field=normalize(`${chunk.path||''} ${chunk.symbol||''}`);
  const identity=normalize(chunk.projectId||'');
  const direct=identifiers.filter(word=>word!==identity&&field.includes(word)).length;
  const names=String(chunk.symbol||'').split('#');
  const constructor=names.at(-1)==='__init__'||names.length>1&&names[0].split('.').at(-1)===names.at(-1);
  const body=String(chunk.text||'');
  const executable=hasImplementationBody(chunk);
  const behavior=constructor||body.length<65||chunk.kind==='context'&&!executable ? .25 : ['method','function'].includes(chunk.kind)?1.3:1;
  return (1.8+Math.min(3,direct)*.65)*behavior;
}

function explicitDefinition(query, chunk) {
  if (!['method', 'function'].includes(chunk.kind)) return false;
  const name = String(chunk.symbol || '').split(/[.#]/).at(-1).toLowerCase();
  return name.length >= 4 && (String(query).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).some(word => word.toLowerCase() === name);
}


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
    for (const token of tokens) if (!weights.has(token)) weights.set(token, token.includes('_') ? 2 : 0.5);
  }
  // Separate known concepts before n-grams, avoiding noise such as 缓存一 / 存一致.
  for (const block of remainder.match(/[A-Za-z][A-Za-z0-9_]*|[\u3400-\u9fff]+/g) || []) {
    const tokens = [...new Set(tokenize(block, true))];
    if (!tokens.length) continue;
    groups.push(tokens);
    for (const token of tokens) { originalSet.add(token); weights.set(token, 1); }
  }
  const allWeights = [...weights];
  // Keep the tail of long interview questions: the concrete request often
  // follows a long scenario. This bounds posting work without making only the
  // first clause searchable. Original questions themselves remain untouched.
  const identifiers=[...new Set(normalized.match(/[a-z][a-z0-9_]{2,63}/g)||[])].filter(term=>weights.has(term)&&!STOP_WORDS.has(term)).slice(0,48);
  const boundedWeights = new Map(allWeights.length <= 256 ? allWeights : [...identifiers.map(term=>[term,weights.get(term)]), ...allWeights.slice(0,64), ...allWeights.slice(-144)]);
  for(const term of identifiers)boundedWeights.set(term,Math.max(2,boundedWeights.get(term)||0));
  const original = [...originalSet].filter(t => boundedWeights.has(t));
  const boundedGroups = groups.map(g => g.filter(t => boundedWeights.has(t))).filter(g => g.length);
  return { original, weights: boundedWeights, groups: boundedGroups, key: JSON.stringify([...boundedWeights]) };
}

class ProjectSearch {
  constructor(chunks, options = {}) {
    this.chunks = chunks;
    this.postings = new Map();
    this.lengths = [];
    this.totalLength = 0;
    this.symbols = [];
    this.symbolParts = [];
    this.paths = [];
    this.sourceFiles = new Map();
    this.bodyTerms = [];
    this.embeddings = [];
    this.cache = new Map();
    this.termCache = new Map();
    this.scopeCache = new Map();
    this.navigation = new Map();
    this.vectorProvider = options.vectorProvider || null;
    this.reranker = options.reranker || null;
  }

  add(id) {
    const chunk = this.chunks[id];
    hasImplementationBody(chunk);
    for(const word of (Array.isArray(chunk.navigationTerms)?chunk.navigationTerms:[]).slice(0,32)){
      const term=normalize(word),key=String(chunk.projectId||'')+':'+term;
      if(!this.navigation.has(key)&&this.navigation.size<512)this.navigation.set(key,{term,ids:[]});
      const entry=this.navigation.get(key);if(entry&&entry.ids.length<32)entry.ids.push(id);
    }
    const bodyTokens = tokenize(chunk.retrievalText || chunk.text);
    const body = frequency(bodyTokens);
    this.bodyTerms[id]=body;
    const sourcePath=String(chunk.path||'').replace(/\\/g,'/');
    if(!this.sourceFiles.has(sourcePath))this.sourceFiles.set(sourcePath,[]);
    this.sourceFiles.get(sourcePath).push(id);
    const fields = [body, frequency(tokenize(chunk.path)), frequency(tokenize(String(chunk.symbol || '').split('#').at(-1)))];
    const terms = new Set(fields.flatMap(f => [...f.keys()]));
    this.lengths[id] = Math.max(1, bodyTokens.length);
    this.totalLength += this.lengths[id];
    this.symbols[id] = normalize(chunk.symbol || '');
    this.symbolParts[id] = this.symbols[id].split(/[.#]/).filter(part => part.length > 3);
    this.paths[id] = normalize(chunk.path || '');
    // Hash vectors are an optional fallback. Eagerly building them for every
    // imported source stalls the first live request even on lexical-only paths.
    for (const term of terms) {
      let list = this.postings.get(term);
      if (!list) this.postings.set(term, list = []);
      list.push([id, body.get(term) || 0, fields[1].has(term) ? 1 : 0, fields[2].has(term) ? 1 : 0]);
    }
  }

  static build(chunks, options = {}) {
    const index = new ProjectSearch(chunks, options);
    for (let i = 0; i < chunks.length; i++) index.add(i);
    return index;
  }

  static async buildAsync(chunks, options = {}) {
    const index = new ProjectSearch(chunks, options);
    for (let i = 0; i < chunks.length; i++) {
      if (i % 40 === 0 && options.isCurrent && !options.isCurrent()) throw Object.assign(new Error('index-warm-stale'), { name: 'AbortError' });
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

  scopedIds(scopes) {
    const key = JSON.stringify([...new Set(scopes)].sort());
    if (this.scopeCache.has(key)) return this.remember(this.scopeCache, key, this.scopeCache.get(key), 32);
    const ids = [];
    for (let id = 0; id < this.chunks.length; id++) if (inProjectScope(this.chunks[id], scopes)) ids.push(id);
    return this.remember(this.scopeCache, key, { ids, allowed: new Set(ids) }, 32);
  }

  // First-question path over already-built postings. Unlike rank(), this never
  // walks every source to find exact symbols, builds vectors, or calls providers.
  lookupPrepared(query, scopes = [], options = {}) {
    const limit = Math.max(0, Math.min(8, Number(options.limit) || 8));
    const maxVisits = Math.max(1, Math.min(4096, Number(options.maxPostings) || 4096));
    if (!Array.isArray(scopes) || !scopes.length || !limit) return {rows:[],postingsVisited:0};
    const spec = querySpec(query), n = this.chunks.length, avg = this.totalLength / Math.max(1,n);
    const terms = [...spec.weights].filter(([term]) => this.postings.has(term))
      .sort((a,b) => b[1]*Math.log(1+n/this.postings.get(b[0]).length)-a[1]*Math.log(1+n/this.postings.get(a[0]).length) || b[0].length-a[0].length).slice(0,64);
    const candidates = new Map(); let visits = 0;
    for (const [term,weight] of terms) {
      const postings = this.postings.get(term), idf = Math.log(1+(n-postings.length+.5)/(postings.length+.5));
      for (const [id,tf,path,symbol] of postings) {
        if (visits++ >= maxVisits) break;
        const chunk = this.chunks[id];
        if (!inProjectScope(chunk,scopes)) continue;
        const value = idf*(tf*2.2/(tf+1.2*(.25+.75*this.lengths[id]/avg))+path*2.4+symbol*3.2)*weight;
        const row = candidates.get(id) || {id,chunk,score:0,matches:0};
        row.score += value; row.matches++; candidates.set(id,row);
      }
      if (visits >= maxVisits) break;
    }
    const implementationIdentifiers=implementationQuery(query);
    for(const row of candidates.values())row.score*=implementationWeight(implementationIdentifiers,row.chunk)*(explicitDefinition(query,row.chunk)?4:1);
    // Version-checked navigation supplies aliases for code symbols, never
    // answer text. The metadata is compiled once; source bodies stay verbatim.
    const folded=normalize(query);let navigationVisits=0;
    for(const entry of this.navigation.values()){
      if(navigationVisits>=64)break;
      if(!folded.includes(entry.term))continue;
      navigationVisits++;
      for(const id of entry.ids){const chunk=this.chunks[id];if(!inProjectScope(chunk,scopes))continue;
        const row=candidates.get(id)||{id,chunk,score:0,matches:0};
        row.score+=(150+Math.min(12,entry.term.length)*15)*(chunk.navigationPriority||1);
        row.navigationMatches=(row.navigationMatches||0)+1;candidates.set(id,row);}
    }
    const ranked=[...candidates.values()].sort((a,b)=>b.score-a.score||a.id-b.id),rows=[],files=new Set();
    const relevant=ranked.filter(row=>!implementationIdentifiers ||
      !['class','context','interface'].includes(row.chunk.kind) || hasImplementationBody(row.chunk) ||
      /字段|声明|类型|签名|构造|初始化|枚举|\b(?:fields?|signature|declaration|constructor|schema|enum)\b/i.test(query));
    for(const row of relevant){const file=row.chunk.projectId+':'+row.chunk.path;if(files.has(file))continue;files.add(file);rows.push(row);if(rows.length>=limit)break;}
    if(rows.length<limit)for(const row of relevant){if(!rows.includes(row))rows.push(row);if(rows.length>=limit)break;}
    return {rows,
      postingsVisited:Math.min(visits,maxVisits),navigationVisits,budgetExhausted:visits>=maxVisits};
  }

  lookupSourceHints(hints=[],query='',scopes=[],{limit=6}={}) {
    const terms=[...querySpec(query).weights].slice(0,64),found=new Map();let examined=0;
    const identifiers=[...new Set((String(query).match(/[A-Za-z][A-Za-z0-9_]{2,63}/g)||[]).map(word=>word.toLowerCase()))].filter(word=>!STOP_WORDS.has(word));
    for(const hint of hints.slice(0,12)) {
      const sourcePath=String(hint.path||'').replace(/\\/g,'/');
      if(!sourcePath||sourcePath.includes('..')||sourcePath.startsWith('/'))continue;
      for(const id of this.sourceFiles.get(sourcePath)||[]) {
        if(examined++>=128)break;
        const chunk=this.chunks[id];if(!inProjectScope(chunk,scopes))continue;
        if(/\.(?:java|py|[cm]?[jt]sx?|go|rs|cs|sql)$/i.test(sourcePath)&&!hasImplementationBody(chunk))continue;
        const lexical=terms.reduce((n,[term,weight])=>n+(this.bodyTerms[id].has(term)?weight:0),0);
        const named=hint.symbol&&chunk.symbol&&String(hint.symbol).includes(chunk.symbol)?8:0;
        const symbolHits=identifiers.filter(word=>String(chunk.symbol||'').toLowerCase().includes(word)).length;
        if(!lexical&&!named&&!symbolHits)continue;
        const score=(1+lexical+named+symbolHits*2)*(['method','function'].includes(chunk.kind)?1.5:1);
        if(!found.has(id)||score>found.get(id).score)found.set(id,{id,chunk,score,sourceHint:true});
      }
      if(examined>=128)break;
    }
    const ranked=[...found.values()].sort((a,b)=>b.score-a.score||a.id-b.id),rows=[],files=new Map();
    const add=row=>{const key=row.chunk.projectId+':'+row.chunk.path;if((files.get(key)||0)>=2||rows.includes(row))return;
      files.set(key,(files.get(key)||0)+1);rows.push(row);};
    for(const row of ranked){const key=row.chunk.projectId+':'+row.chunk.path;if(files.has(key))continue;add(row);if(rows.length>=Math.min(8,limit))break;}
    for(const row of ranked){if(rows.length>=Math.min(8,limit))break;add(row);}
    return {rows,examined};
  }

  // Provider contracts (optional, synchronous, source ids only):
  // vectorProvider: { ready, modelVersion, search({query, scopes, limit,
  //   candidates:[{id,chunk}]}) -> [{id,score:0..1}] }
  // reranker: { ready, modelVersion, rerank({query, scopes,
  //   candidates:[{id,chunk,score,confidence}]}) -> [{id,score}] }
  // A future remote/async provider needs an explicit async orchestration path.
  // Async functions are not invoked here; rejected thenables fall back locally.
  providerCall(provider, method, params) {
    if (!provider || provider.ready !== true || typeof provider[method] !== 'function') return { rows: [], status: 'disabled' };
    if (!params.scopes.length) return { rows: [], status: 'unscoped-disabled' };
    if (provider[method].constructor?.name === 'AsyncFunction') return { rows: [], status: 'async-unsupported' };
    try {
      const rows = provider[method](params);
      if (rows && typeof rows.then === 'function') {
        Promise.resolve(rows).catch(() => {});
        return { rows: [], status: 'async-unsupported' };
      }
      return Array.isArray(rows) ? { rows, status: 'ready' } : { rows: [], status: 'unavailable' };
    } catch (_) { return { rows: [], status: 'unavailable' }; }
  }

  rank(query, scopes = [], options = {}) {
    scopes = Array.isArray(scopes) ? [...new Set(scopes.map(String))].sort() : [];
    const spec = querySpec(query), folded = normalize(query);
    const providerVersion = JSON.stringify([this.vectorProvider?.ready, this.vectorProvider?.modelVersion || this.vectorProvider?.version,
      this.reranker?.ready, this.reranker?.modelVersion || this.reranker?.version]);
    const candidateLimit = Math.max(1, Math.min(50, Number(options.candidateLimit) || 50));
    const key = spec.key + '\n' + folded + '\n' + JSON.stringify(scopes) + '\n' + providerVersion + '\n' + candidateLimit + ':' + (options.hashFallback !== false);
    if (this.cache.has(key)) return { ...this.remember(this.cache, key, this.cache.get(key), 32), cacheHit: true,
      candidates: 0, postingsVisited: 0, denseScanned: 0 };
    const { ids, allowed } = this.scopedIds(scopes);
    const candidates = new Map();
    let postingsVisited = 0;
    let denseScanned = 0;
    for (const [term, weight] of spec.weights) {
      for (const [id, score, fieldMatch, contentMatch] of this.contributions(term)) {
        postingsVisited++;
        if (!allowed.has(id)) continue;
        let item = candidates.get(id);
        if (!item) candidates.set(id, item = { id, score: 0, matched: new Set(), contentMatched: new Set(), fieldMatch: false });
        item.score += score * weight;
        item.matched.add(term);
        if (contentMatch) item.contentMatched.add(term);
        if (fieldMatch && weight >= 1) item.fieldMatch = true;
      }
    }
    const lexical = [...candidates.values()].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, candidateLimit);
    const hash = [];
    if (options.hashFallback !== false) {
      const queryVector = denseEmbedding(query, true);
      for (const id of ids) {
        denseScanned++;
        const chunk = this.chunks[id];
        const vector = this.embeddings[id] ||= denseEmbedding(`${chunk.path} ${chunk.symbol || ''} ${chunk.text}`);
        const similarity = cosineDense(queryVector, vector);
        if (similarity < 0.16) continue;
        hash.push({ id, similarity });
      }
    }
    hash.sort((a, b) => b.similarity - a.similarity || a.id - b.id);
    const dense = options.hashFallback === false ? [] : hash.slice(0, candidateLimit);
    const vectorResponse = this.vectorProvider?.ready === true
      ? this.providerCall(this.vectorProvider, 'search', { query, scopes: scopes.slice(), limit: 50,
        candidates: ids.map(id => ({ id, chunk: this.chunks[id] })) })
      : { rows: [], status: 'disabled' };
    const vectorById = new Map();
    for (const row of vectorResponse.rows) {
      if (!Number.isInteger(row?.id) || !allowed.has(row.id) || !Number.isFinite(row.score) || row.score <= 0) continue;
      const score = Math.min(1, row.score);
      if (score > (vectorById.get(row.id) || 0)) vectorById.set(row.id, score);
    }
    const vector = [...vectorById].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 50);
    const exact = ids.filter(id => {
      return this.symbolParts[id].some(part => folded.includes(part)) || (this.paths[id] && folded.includes(this.paths[id]));
    }).slice(0, candidateLimit).map(id => ({ id, score: 1 }));
    const merged = new Map();
    const merge = (id, rank, channelScore, channel) => {
      let item = merged.get(id);
      if (!item) {
        const lexicalItem = candidates.get(id);
        item = lexicalItem ? { ...lexicalItem } : { id, score: 0, matched: new Set(), contentMatched: new Set(), fieldMatch: false };
        merged.set(id, item);
        item.rrfScore = 0;
        item.channels = [];
      }
      item.rrfScore += 1 / (60 + rank + 1);
      item.channels.push(channel);
      if (channel === 'hash') item.denseSimilarity = channelScore;
      if (channel === 'vector') item.vectorSimilarity = channelScore;
    };
    lexical.forEach((item, i) => merge(item.id, i, item.score, 'bm25'));
    dense.forEach((item, i) => merge(item.id, i, item.similarity, 'hash'));
    // A learned channel replaces the deterministic hash fallback; it is not
    // counted as another independent vote for the same lexical vocabulary.
    if (vectorResponse.status === 'ready') {
      for (const item of merged.values()) {
        if (item.channels.includes('hash')) item.rrfScore -= 1 / (60 + dense.findIndex(row => row.id === item.id) + 1);
        item.channels = item.channels.filter(channel => channel !== 'hash');
        item.denseSimilarity = 0;
      }
    }
    vector.forEach(([id, score], i) => merge(id, i, score, 'vector'));
    exact.forEach((item, i) => merge(item.id, i, item.score, 'exact'));
    const implementationIdentifiers=implementationQuery(query);
    const rows = [];
    for (const item of merged.values()) {
      const chunk = this.chunks[item.id];
      if (!inProjectScope(chunk, scopes)) continue;
      const coverage = spec.groups.length ? spec.groups.filter(g => g.some(t => item.matched.has(t))).length / spec.groups.length : 0;
      const originalMatches = spec.original.filter(t => item.matched.has(t)).length;
      const termCoverage = spec.original.length ? originalMatches / spec.original.length : 0;
      const exactSymbol = this.symbolParts[item.id].some(part => folded.includes(part));
      const aliasMatch = spec.groups.some(g => g.some(t => item.contentMatched.has(t)) && g.some(t => !spec.original.includes(t)));
      // This is a heuristic relevance level, not a calibrated probability.
      const similarity = item.denseSimilarity || 0;
      const vectorSimilarity = item.vectorSimilarity || 0;
      const confidence = Math.min(1, 0.36 * coverage + 0.31 * termCoverage + (item.fieldMatch ? 0.14 : 0) + (exactSymbol ? 0.32 : 0) + (aliasMatch ? 0.13 : 0) + Math.min(0.48, similarity * 0.68) + vectorSimilarity * 0.45);
      let score = item.rrfScore * 1000 * implementationWeight(implementationIdentifiers,chunk);
      if (explicitDefinition(query, chunk)) score *= 2;
      if (exactSymbol) score *= 1.18;
      if (!/测试|test\b/i.test(query) && /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(chunk.path)) score *= 0.85;
      if (/架构|概览|overview|architecture/i.test(query) && /readme|docs?\/|architecture/i.test(chunk.path)) score *= 1.2;
      if (chunk.importance === 'high') score *= 1.04;
      if (/代码|实现|源码|\b(?:code|implement\w*|method)\b/i.test(query) && ['method', 'function'].includes(chunk.kind)) score *= 1.08;
      if (score > 0) rows.push({ id: item.id, chunk, score, confidence, coverage, originalMatches,
        denseSimilarity: similarity, vectorSimilarity, channels: item.channels, rrfScore: item.rrfScore });
    }
    rows.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine);
    const reranked = this.providerCall(this.reranker, 'rerank', { query, scopes: scopes.slice(),
      candidates: rows.map(row => ({ id: row.id, chunk: row.chunk, score: row.score, confidence: row.confidence })) });
    const rerankScores = new Map();
    const candidateIds = new Set(rows.map(row => row.id));
    for (const row of reranked.rows) {
      if (Number.isInteger(row?.id) && candidateIds.has(row.id) && Number.isFinite(row.score)) rerankScores.set(row.id, row.score);
    }
    if (rerankScores.size) {
      rows.sort((a, b) => (rerankScores.has(b.id) ? 1 : 0) - (rerankScores.has(a.id) ? 1 : 0) ||
        (rerankScores.get(b.id) || 0) - (rerankScores.get(a.id) || 0) || b.score - a.score);
      // Keep a positive, monotonic selection score so later structural expansion
      // respects provider order. Confidence continues to reflect local evidence.
      const strongest = Math.max(...rows.map(row => row.score));
      rows.forEach((row, i) => {
        row.localScore = row.score;
        row.rerankScore = rerankScores.get(row.id);
        row.score = strongest * (0.5 + 0.5 * (rows.length - i) / rows.length);
      });
    }
    const top = rows.slice(0, 60);
    const channelRows = (items, channel) => items.map(item => {
      const id = Array.isArray(item) ? item[0] : item.id;
      const row = rows.find(value => value.id === id);
      return { id, chunk: this.chunks[id], score: Array.isArray(item) ? item[1] : (item.score || item.similarity || 0),
        confidence: row?.confidence || 0, channels: [channel], relevance: row?.coverage || 0 };
    });
    const result = { rows: top, cacheHit: false, candidates: merged.size, postingsVisited, denseScanned,
      denseCandidates: dense.length, lexicalCandidates: lexical.length, vectorCandidates: vector.length,
      vectorStatus: vectorResponse.status, rerankerStatus: reranked.status,
      channels: { bm25: channelRows(lexical, 'bm25'), hash: vectorResponse.status === 'ready' ? [] : channelRows(dense, 'hash'),
        exact: channelRows(exact, 'exact'), vector: channelRows(vector, 'vector') } };
    this.remember(this.cache, key, result, 32);
    return result;
  }
  getCandidates(query, scopes = [], options = {}) {
    return this.rank(query, scopes, { ...options, candidateLimit: options.candidateLimit || options.limit || 25 });
  }
}

module.exports = { ProjectSearch, tokenize, querySpec, denseEmbedding, cosineDense,hasImplementationBody,implementationWeight,implementationQuery,normalizeConceptText,explicitDefinition };
