'use strict';
const {estimateTokens}=require('./final-request-budget');
const {formatEvidenceBlock}=require('./evidence-selector');
const {inProjectScope}=require('./project-scope');
const {strictProjectScopes}=require('./project-registry');
const {projectQuestionParts}=require('./project-question-parts');
const {tokenize,hasImplementationBody}=require('./project-search');
const VERSION='project-evidence-v2';
function resolveEvidenceLimits({question='',answerPlan={},instant=false}={}) {
  const longScenario=answerPlan.questionCount>=3||String(question).length>450;
  return longScenario ? {maxSources:instant?6:9,evidenceTokens:instant?2400:4200,softInputTokens:6500,longScenario:true}
    : /状态|事务|崩溃|超时|重试|幂等|租约|\b(?:claim|confirm|lease|transaction|retry|crash)\b/i.test(question)
      ? {maxSources:instant?4:7,evidenceTokens:instant?2100:3200,softInputTokens:3800,longScenario:false,mechanismDetail:true}
      : {maxSources:instant?4:7,evidenceTokens:instant?1500:2800,softInputTokens:3000,longScenario:false};
}
function planProjectEvidence({question='',resolution={},facts=[],sources=[],factsEnabled=true,sourcePolicy='ready-only',maxSources=4,evidenceTokens=1500}={}) {
  const dropped=[],reasons=[],selected=[],seen=new Set();let tokens=0;
  const general=resolution.kind==='general',unresolved=resolution.kind==='unresolved';
  if(!factsEnabled)reasons.push('facts-disabled');if(sourcePolicy==='off')reasons.push('source-rag-off');
  if(general)reasons.push('general-question');if(unresolved)reasons.push('unresolved-project');
  const allowedFacts=factsEnabled&&!general&&!unresolved?facts:[];
  const allowedSources=!general&&!unresolved?sources.filter(c=>{
    if(c.sourceType!=='manual'&&sourcePolicy==='off')return false;
    if(['context','class','interface'].includes(c.kind)&&/\.(?:java|py|[cm]?[jt]sx?|go|rs|cs|sql)$/i.test(c.path||'')&&
      !hasImplementationBody(c)&&!/字段|声明|类结构|类型|签名|构造|初始化|\b(?:fields?|signature|declaration|constructor|schema)\b/i.test(question)){
      dropped.push({id:c.id,reason:'declaration-not-behavior'});return false;
    }
    const scopes=resolution.sourceScopes||resolution.scopes;
    const valid=c.sourceType==='manual' ? (resolution.canonicalProjectIds||[]).includes(c.projectId)||strictProjectScopes(scopes)&&c.scopes?.some(s=>scopes.includes(s))
      : strictProjectScopes(scopes)&&inProjectScope(c,scopes);
    if(!valid)dropped.push({id:c.id,reason:'scope-mismatch'});return valid;
  }):[];
  if(factsEnabled&&resolution.retrieveFacts&&!allowedFacts.length)reasons.push('no-matching-card');
  if(sourcePolicy!=='off'&&resolution.retrieveSources&&!allowedSources.length)reasons.push('source-not-ready');
  // Provenance describes what a card can establish, not its topical relevance.
  // Only explicit personal-history asks need a USER preference; technical
  // "which service is responsible" or timeout questions must keep the order
  // already ranked for the current mechanism by the fact selector.
  const personal=/(?:你|我|本人|个人|候选人)(?:在.{0,20}(?:中|里))?(?:主要|具体|曾经|实际|本人|的)?(?:职责|负责(?:哪些|什么|哪块|哪部分|的部分)|贡献|角色|经历|做了(?:哪些|什么))|几个人|多少人|团队(?:分工|组成)|和谁协作|一个人做|独立开发|(?:项目|开发|实习)(?:开发|实施)?(?:周期|时间线|历时|持续(?:了)?多久|做了多久|何时开始|哪年开始)|(?:开发|实习)(?:了)?多久|开发时间|项目时间线/.test(question);
  const implementation=/实现|代码|源码|接口|竞态|恢复|状态机|机制/.test(question)||resolution.intent?.includes('implementation');
  const primary = c=>(resolution.intent||[]).includes(c.docType) || personal&&['ownership','collaboration','overview','performance'].includes(c.docType) || implementation&&c.docType==='implementation';
  const parts=projectQuestionParts(question,resolution),multi=parts.length>1;
  const rankedFacts=multi||!personal?[...allowedFacts]:[...allowedFacts].sort((a,b)=>Number(primary(b))-Number(primary(a))||Number(b.provenance==='USER')-Number(a.provenance==='USER'));
  const candidates=[];const queue=c=>{if(c&&!candidates.includes(c))candidates.push(c);};
  const sourceTerms=new Map(),partTerms=new Map();
  const score=(item,part)=>{
    if(!partTerms.has(part))partTerms.set(part,[...new Set(tokenize(part.text,true))]);
    if(!sourceTerms.has(item))sourceTerms.set(item,new Set(tokenize(`${item.path||''} ${item.symbol||''} ${(item.keywords||[]).join(' ')} ${item.text||''}`,true)));
    const words=partTerms.get(part),body=sourceTerms.get(item);
    return words.filter(word=>body.has(word)).length/Math.max(1,words.length);
  };
  // Technical questions need a real implementation excerpt before optional
  // summaries fill the budget. Keep each project's evidence in comparisons.
  const projectIds=resolution.canonicalProjectIds||resolution.projectIds||[];
  if(implementation||sourcePolicy==='standard')for(const id of projectIds){
    const ownScopes=resolution.catalog?.find(project=>(project.id||project.projectId)===id)?.sourceScopes ||
      (projectIds.length===1?resolution.sourceScopes||resolution.scopes:[`@project:${id}`]);
    const files=new Set();let reserved=0;
    for(const item of allowedSources){
      if(item.sourceType==='manual'||!/\.(?:java|py|[cm]?[jt]sx?|go|rs|cs|sql)$/i.test(item.path||'')||
        !(item.projectId===id||inProjectScope(item,ownScopes))||files.has(item.path))continue;
      queue(item);files.add(item.path);if(++reserved>=(!personal?2:1))break;
    }
  }
  if(multi)for(const part of parts){
    const eligible=item=>item.sourceType==='project-pack' ? !part.projectIds.length||part.projectIds.includes(item.projectId)
      : !part.scopes.length||inProjectScope(item,part.scopes);
    const best=items=>items.filter(eligible).map(item=>({item,score:score(item,part)})).sort((a,b)=>b.score-a.score).find(row=>row.score>.04)?.item;
    queue(best(rankedFacts));
    // Reserve one applicable source for each ask, not just one source for the
    // entire scenario. Selection below still enforces the same finite budget.
    queue(best(allowedSources.filter(item=>item.sourceType!=='manual')));
  }
  for(const id of resolution.canonicalProjectIds||resolution.projectIds||[])queue(rankedFacts.find(c=>c.projectId===id));
  // Standard retrieval must retain a matching implementation source even when
  // many fact cards are relevant. Prefer an imported source over a manual note;
  // both still pass the same scope, count and token checks below.
  const source=allowedSources.find(c=>c.sourceType!=='manual')||allowedSources[0];
  if(source&&(implementation||sourcePolicy==='standard'))queue(source);
  for(const c of rankedFacts)queue(c);for(const c of allowedSources)queue(c);
  for(const c of candidates.slice(0,32)) {
    if(seen.has(c.id))continue;seen.add(c.id);
    const size=estimateTokens(formatEvidenceBlock(c));
    if(selected.length>=maxSources||tokens+size>evidenceTokens){dropped.push({id:c.id,reason:'budget-pruned'});continue;}
    selected.push(c);tokens+=size;
  }
  return {evidence:selected,dropped,reasons,estimatedTokens:tokens,policyVersion:VERSION,
    selectedFactIds:facts.map(c=>c.id),selectedSourceIds:sources.map(c=>c.id),contextFactIds:selected.filter(c=>c.sourceType==='project-pack').map(c=>c.id),contextSourceIds:selected.filter(c=>c.sourceType!=='project-pack').map(c=>c.id)};
}
function sentEvidenceDiagnostics(plan,sent) {
  const ids=new Set(sent.map(c=>c.id));return {...plan,evidence:undefined,sentFactIds:sent.filter(c=>c.sourceType==='project-pack').map(c=>c.id),sentSourceIds:sent.filter(c=>c.sourceType!=='project-pack').map(c=>c.id),
    dropped:[...plan.dropped,...(plan.contextFactIds||[]).concat(plan.contextSourceIds||[]).filter(id=>!ids.has(id)).map(id=>({id,reason:'budget-pruned'}))]};
}
function applyFactCoverage(bundle,resolution) {
  const facts=bundle.evidence.filter(c=>c.sourceType==='project-pack'&&c.status!=='missing'&&!['FUTURE','GAP','REFERENCE','REFERENCE-STORY'].includes(c.provenance));
  if(!facts.length)return;
  const visible=new Set(bundle.evidence.map(c=>c.id)),covered=new Map();
  bundle.byQuestion=(bundle.byQuestion||[]).map(row=>{
    const projects=(resolution.catalog||[]).filter(p=>(p.sourceScopes||[p.prefix]).some(s=>row.scopes?.includes(s))).map(p=>p.id||p.projectId);
    const matching=facts.filter(c=>(projects.length?projects:resolution.canonicalProjectIds||[]).includes(c.projectId));
    const types=new Set(matching.map(c=>c.docType));covered.set(row.id,types);
    return {...row,missing:(row.missing||[]).filter(g=>!types.has(g.type)),sourceRefs:[...(row.sourceRefs||[]).filter(id=>visible.has(id)),...matching.filter(c=>(row.evidenceNeeds||[]).some(n=>n.type===c.docType)).map(c=>c.id)]};
  });
  bundle.missing=(bundle.missing||[]).filter(g=>!covered.get(g.questionId)?.has(g.type));
}
module.exports={planProjectEvidence,sentEvidenceDiagnostics,applyFactCoverage,resolveEvidenceLimits,VERSION};
