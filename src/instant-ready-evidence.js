'use strict';

const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { tokenize, querySpec,hasImplementationBody,implementationQuery } = require('./project-search');
const { inProjectScope } = require('./project-scope');
const { RETRIEVAL_CONFIG_VERSION } = require('./project-prefetch-policy');
const {projectQuestionParts, boundedRankingText}=require('./project-question-parts');

const hash = value => createHash('sha256').update(value).digest('hex');
const integerLimit = (value, fallback, maximum) => Number.isFinite(value)
  ? Math.max(0, Math.min(maximum, Math.floor(value))) : fallback;
const unique = values => [...new Set(values)];

// Only optional ranking work is bounded. A long setup must not disable all
// ready evidence or erase the concrete asks at the end of the question.
function boundedTerms(text, projectPlan) {
  if (!text) return null;
  const identity = new Set(tokenize(String(projectPlan.projectLabel || ''), true));
  const ignored = new Set(['当前', '问题', '团队', '具体', '描述', '介绍', '可以', '应该', '怎样', 'this', 'that']);
  const terms=[...querySpec(boundedRankingText(text)).weights.keys()].filter(term => !identity.has(term) && !ignored.has(term));
  return terms.length<=96?terms:[...terms.slice(0,48),...terms.slice(-48)];
}

function relevant(source, text, terms, projectPlan, prepared) {
  if (!terms?.length) return false;
  const body = prepared?.body || `${source.symbol || ''}\n${source.path}\n${source.text}`;
  const available = prepared?.available || new Set(tokenize(body, true));
  const hits = terms.filter(term => available.has(term)).length;
  const navigated=Array.isArray(source.navigationTerms)&&source.navigationTerms.some(word=>typeof word==='string'&&text.toLowerCase().includes(word.toLowerCase()));
  if ((!hits || hits < Math.min(2, terms.length))&&!navigated) return false;
  const identity = new Set(tokenize(String(projectPlan.projectLabel || ''), true));
  const identifiers = unique(text.match(/\b[A-Za-z][A-Za-z0-9_.$-]{1,63}\b/g) || [])
    .filter(word => !identity.has(word.toLowerCase()) && !['why', 'what', 'how', 'the', 'a', 'is', 'in', 'of', 'for', 'to', 'and', 'or', 'can', 'you', 'please'].includes(word.toLowerCase()));
  // One snippet establishes only its own part of a compound ask. Requiring
  // every identifier (e.g. Outbox, Inbox and Execution) in every source made
  // all valid per-component snippets disappear from long questions.
  if (!navigated&&identifiers.length&&!identifiers.some(word => body.toLowerCase().includes(word.toLowerCase()))) return false;
  // Scenario constraints are questions, not quotations from the source. Their
  // negation need not occur verbatim in code. Authorship still needs personal
  // evidence; object responsibilities (Job/Execution) are implementation asks.
  if (/(?:你|我|本人|个人|候选人).{0,8}(?:职责|负责|贡献|分工|带领)|团队分工|个人贡献|我做|你做/.test(text) &&
    !['ownership', 'collaboration'].includes(source.docType) &&
    !/(?:我|本人|个人|候选人).{0,10}(?:负责|实现|承担)|分工|协作|职责/.test(source.text)) return false;
  return Math.max(navigated ? 0.1 : 0,hits / Math.max(1, terms.length));
}

function projectSource(source, revision, scopes) {
  const result = {};
  // Avoid serializing retrievalText/relations/old score and relevance grants.
  for (const key of ['id', 'projectId', 'projectName', 'path', 'startLine', 'endLine', 'startOffset', 'endOffset',
    'text', 'kind', 'symbol', 'docType', 'truthScope', 'status', 'partial', 'fullParent', 'filePartial']) {
    if (source[key] != null) result[key] = source[key];
  }
  return { ...result, sourceType: 'imported', revision, scopeKey: [...scopes].sort().join('|'),
    docType: source.docType || (/\.(?:mdx?|txt|rst|adoc|pdf|docx)$/i.test(source.path) ? 'overview' : 'implementation'),
    truthScope: source.truthScope || 'unverified', status: source.status || 'draft' };
}

function peekReadyEvidence({ snapshot, projectPlan = {}, epoch, projectRevision, modelVersion = 'base',
  retrievalConfigVersion, projectIndexSnapshot, cache, ragSession, retrievalInput,
  sourceHints=[],maxCandidates = 8, maxSources = 3, maxChars = 1800, policy = 'ready-only' } = {}) {
  const started = performance.now();
  const sources = [], scopes = (projectPlan.scopes || []).slice(0, 2);
  const stats = { ragPolicy: policy, readyEvidenceHit: false, sourceCount: 0, candidateCount: 0,
    searchCalls: 0, queryEmbeddingCalls: 0, retrievalPath: 'ready-only', poolSufficientHit: false };
  const done = skippedReason => {
    stats.readyEvidenceHit = sources.length > 0;
    stats.sourceCount = sources.length; stats.readyEvidenceMs = performance.now() - started;
    stats.skippedReason = skippedReason;
    return { evidence: sources, sources, stats, skippedReason };
  };
  if (policy === 'off') return done('disabled');
  if (policy !== 'ready-only') return done('unsupported-policy');
  if (!snapshot?.text || snapshot.epoch !== epoch || !snapshot.questionId || !Number.isInteger(snapshot.revision)) return done('question-identity-mismatch');
  if (!projectPlan.retrieve || !scopes.length || (projectPlan.scopes || []).length > 2) return done('no-project-scope');
  if (!projectRevision || projectIndexSnapshot?.revision !== projectRevision || !projectIndexSnapshot?.ready ||
    typeof projectIndexSnapshot.resolveSource !== 'function') return done('index-not-ready');
  const prioritizeBody=implementationQuery(snapshot.text)!==null||implementationQuery(retrievalInput?.topicContext||'')!==null;
  const contextAnchor=!!retrievalInput?.topicContext&&!/\b[A-Z][a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b/.test(snapshot.text);
  const candidateLimit = integerLimit(maxCandidates, 8, 8), sourceLimit = integerLimit(maxSources, 3, 6);
  const charLimit = integerLimit(maxChars, 1800, 6000);
  if (!candidateLimit || !sourceLimit || !charLimit) return done('empty-budget');
  const parts=projectQuestionParts(snapshot.text,projectPlan).map(part=>({...part,terms:boundedTerms(part.text,projectPlan)})).filter(part=>part.terms?.length);
  if (!parts.length) return done('no-bounded-query');
  let candidates = [], origin = 'raw-pool', preparedScores=new Map(), primarySeeds=[];
  // Completed results are usable only through the identical frozen target. No
  // Promise, fallback wait, or repair of a wrong-version result occurs here.
  if (retrievalInput?.epoch === epoch && retrievalInput.questionId === snapshot.questionId &&
    retrievalInput.questionRevision === snapshot.revision && retrievalInput.question === snapshot.text &&
    retrievalInput.projectRevision === projectRevision && retrievalInput.modelVersion === modelVersion) {
    const ready = ragSession?.take?.(retrievalInput, { metadata: true });
    if (ready?.revision === projectRevision) {
      candidates = (ready.evidence || ready.candidates || []).slice(0, candidateLimit);
      origin = 'exact-ready';
    }
  }
  if (!candidates.length && cache?.peekRawSources) {
    const config = retrievalConfigVersion || `${RETRIEVAL_CONFIG_VERSION}:threshold=${retrievalInput?.semanticThreshold ?? .70}`;
    candidates = cache.peekRawSources(scopes, projectRevision,
      { modelVersion: modelVersion === 'base' ? '' : modelVersion, retrievalConfigVersion: config },
      { maxCandidates: candidateLimit });
  }
  if(origin!=='exact-ready'&&typeof projectIndexSnapshot.lookup==='function') {
    // A cold conversational cache can still use the immutable, already-warmed
    // posting index. No index build, filesystem access, embedding or promise.
    const information=part=>(part.text.match(/\b[A-Za-z][A-Za-z0-9_]{2,63}\b/g)||[]).length*2+
      (part.text.match(/身份|幂等|重试|取消|终态|资源|预占|并发|权限|共享|恢复|对账|投递|持久化/g)||[]).length;
    // The complete setup can name the relevant persisted artifacts even when
    // the final asks use pronouns. Retain it as one bounded lookup, then cover
    // the most informative independent asks with the remaining slots.
    const queries=[{text:snapshot.text,scopes},...(retrievalInput?.topicContext?[{text:retrievalInput.topicContext,scopes}]:[]),...[...parts].sort((a,b)=>information(b)-information(a))]
      .filter((part,index,all)=>all.findIndex(other=>other.text===part.text)===index).slice(0,4);
    candidates=[];
    const lookupStarted=performance.now(); let visited=0,calls=0;const pooled=new Map();
    for(const [queryIndex,part] of queries.entries()){
      const found=projectIndexSnapshot.lookup(part.text,part.scopes.length?part.scopes:scopes,
        {limit:candidateLimit,maxPostings:Math.floor(4096/queries.length)});
      if(queryIndex===(contextAnchor?1:0))primarySeeds=(found.rows||[]).map(row=>projectSource(row.chunk,projectRevision,scopes));
      calls++;
      visited+=found.postingsVisited||0;
      for(const [rank,row] of (found.rows||[]).entries()){
        const own=pooled.get(row.chunk.id)||{chunk:row.chunk,score:0};
        own.score+=(row.navigationMatches?3:1)*(prioritizeBody?(queryIndex===0?3:retrievalInput?.topicContext===part.text?2:1):1)/(20+rank+1);pooled.set(row.chunk.id,own);
      }
    }
    const rows=[...pooled.values()].sort((a,b)=>b.score-a.score),files=new Map();
    for(const row of rows){const file=row.chunk.projectId+':'+row.chunk.path;if((files.get(file)||0)>=2)continue;
      files.set(file,(files.get(file)||0)+1);candidates.push(projectSource(row.chunk,projectRevision,scopes));preparedScores.set(row.chunk.id,(prioritizeBody ? 0.4 : 0)+row.score+(contextAnchor&&primarySeeds.some(seed=>seed.id===row.chunk.id)?0.2:0));if(candidates.length>=candidateLimit)break;}
    stats.preparedLookupMs=performance.now()-lookupStarted;stats.postingsVisited=visited;
    stats.preparedLookupCalls=calls;origin='prepared-postings';
  }
  if(sourceHints.length&&typeof projectIndexSnapshot.lookupSourceHints==='function') {
    const hinted=projectIndexSnapshot.lookupSourceHints(sourceHints,[snapshot.text,retrievalInput?.topicContext||''].join('\n'),scopes,{limit:6});
    stats.sourceHintCandidates=hinted.rows?.length||0;stats.sourceHintExamined=hinted.examined||0;
    const extra=(hinted.rows||[]).map(row=>{
      preparedScores.set(row.chunk.id,Math.max(preparedScores.get(row.chunk.id)||0,.15+Math.min(.12,Math.log1p(row.score)/40)));
      return {...projectSource(row.chunk,projectRevision,scopes),sourceHint:true};
    });
    const hintedIds=new Set(extra.map(row=>row.id));
    candidates=[...candidates,...extra].filter((row,i,all)=>all.findIndex(other=>other.id===row.id)===i).map(row=>hintedIds.has(row.id)?{...row,sourceHint:true}:row).sort((a,b)=>(preparedScores.get(b.id)||0)-(preparedScores.get(a.id)||0)).slice(0,candidateLimit);
  }
  if(prioritizeBody&&typeof projectIndexSnapshot.lookupRelated==='function'){
    const methods=(primarySeeds.length?primarySeeds:candidates).filter(row=>['method','function'].includes(row.kind)&&!/^(?:__init__|constructor)$/.test(String(row.symbol||'').split('#').at(-1)));
    const seeds=methods.slice(0,1);
    const related=projectIndexSnapshot.lookupRelated(seeds,scopes).filter(row=>row.relation?.status==='resolved');
    stats.preparedRelationCandidates=related.length;
    const terms=boundedTerms(snapshot.text,projectPlan)||[];
    const ordered=related.map(row=>{const available=new Set(tokenize(`${row.path} ${row.symbol||''} ${row.text}`,true));return {row,hits:terms.filter(term=>available.has(term)).length};})
      .sort((a,b)=>b.hits-a.hits);
    const extra=ordered.slice(0,6).map(({row,hits})=>{
      preparedScores.set(row.id,.85+Math.min(80,hits)/500);
      return {...projectSource(row,projectRevision,scopes),sourceHint:true};
    });
    candidates=[...extra,...candidates].filter((row,i,all)=>all.findIndex(other=>other.id===row.id)===i).slice(0,candidateLimit);
  }
  const ranked = [];
  for (const cached of candidates.slice(0, candidateLimit)) {
    stats.candidateCount++;
    if (!cached || typeof cached.text !== 'string' || cached.text.length > charLimit ||
      cached.sourceType !== 'imported' || cached.revision && cached.revision !== projectRevision ||
      !inProjectScope(cached, scopes)) continue;
    const source = projectIndexSnapshot.resolveSource(cached);
    if (!source || source.text !== cached.text || !inProjectScope(source, scopes) ||
      cached.sourceHash && hash(source.text) !== cached.sourceHash) continue;
    if(/\.(?:java|py|[cm]?[jt]sx?|go|rs|cs|sql)$/i.test(source.path||'')&&['context','class','interface'].includes(source.kind)&&!hasImplementationBody(source)&&
      !/字段|声明|类型|签名|构造|初始化|\b(?:fields?|signature|declaration|constructor|schema)\b/i.test(snapshot.text))continue;
    const ownParts=parts.filter(part=>!part.scopes.length||inProjectScope(source,part.scopes));
    const body=`${source.symbol||''}\n${source.path}\n${source.text}`,prepared={body,available:new Set(tokenize(body,true))};
    const score = Math.max(cached.sourceHint ? 0.1 : 0,...ownParts.map(part=>relevant(source,part.text,part.terms,projectPlan,prepared)||0));
    if (score) ranked.push({ source, score:preparedScores.get(source.id)||score });
  }
  let used = 0;
  const files=new Map();
  for (const { source } of ranked.sort((a, b) => b.score - a.score)) {
    if (sources.length >= sourceLimit) break;
    const file=source.projectId+':'+source.path;
    if (used + source.text.length > charLimit || (files.get(file)||0)>=2 || sources.some(row => row.id === source.id)) continue;
    sources.push(projectSource(source, projectRevision, scopes)); used += source.text.length;
    files.set(file,(files.get(file)||0)+1);
  }
  stats.readyOrigin = sources.length ? origin : null;
  stats.sourceChars = used;
  return done(sources.length ? null : candidates.length ? 'no-relevant-ready-source' : 'no-completed-evidence');
}

module.exports = { peekReadyEvidence };
