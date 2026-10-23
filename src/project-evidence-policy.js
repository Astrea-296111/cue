'use strict';
const {estimateTokens}=require('./final-request-budget');
const {formatEvidenceBlock}=require('./evidence-selector');
const {inProjectScope}=require('./project-scope');
const {strictProjectScopes}=require('./project-registry');
const VERSION='project-evidence-v1';
function planProjectEvidence({question='',resolution={},facts=[],sources=[],factsEnabled=true,sourcePolicy='ready-only',maxSources=4,evidenceTokens=1500}={}) {
  const dropped=[],reasons=[],selected=[],seen=new Set();let tokens=0;
  const general=resolution.kind==='general',unresolved=resolution.kind==='unresolved';
  if(!factsEnabled)reasons.push('facts-disabled');if(sourcePolicy==='off')reasons.push('source-rag-off');
  if(general)reasons.push('general-question');if(unresolved)reasons.push('unresolved-project');
  const allowedFacts=factsEnabled&&!general&&!unresolved?facts:[];
  const allowedSources=!general&&!unresolved?sources.filter(c=>{
    if(c.sourceType!=='manual'&&sourcePolicy==='off')return false;
    const scopes=resolution.sourceScopes||resolution.scopes;
    const valid=c.sourceType==='manual' ? (resolution.canonicalProjectIds||[]).includes(c.projectId)||strictProjectScopes(scopes)&&c.scopes?.some(s=>scopes.includes(s))
      : strictProjectScopes(scopes)&&inProjectScope(c,scopes);
    if(!valid)dropped.push({id:c.id,reason:'scope-mismatch'});return valid;
  }):[];
  if(factsEnabled&&resolution.retrieveFacts&&!allowedFacts.length)reasons.push('no-matching-card');
  if(sourcePolicy!=='off'&&resolution.retrieveSources&&!allowedSources.length)reasons.push('source-not-ready');
  const personal=/几个人|多少人|团队|职责|负责|哪块|多久|时间|经历/.test(question);
  const implementation=/实现|代码|源码|接口|竞态|恢复|状态机|机制/.test(question)||resolution.intent?.includes('implementation');
  const primary = c=>(resolution.intent||[]).includes(c.docType) || personal&&['ownership','collaboration','overview','performance'].includes(c.docType) || implementation&&c.docType==='implementation';
  const rankedFacts=[...allowedFacts].sort((a,b)=>Number(primary(b))-Number(primary(a))||Number(b.provenance==='USER')-Number(a.provenance==='USER'));
  const candidates=[];const queue=c=>{if(c&&!candidates.includes(c))candidates.push(c);};
  for(const id of resolution.canonicalProjectIds||resolution.projectIds||[])queue(rankedFacts.find(c=>c.projectId===id));
  if(implementation&&allowedSources.length)queue(allowedSources[0]);
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
module.exports={planProjectEvidence,sentEvidenceDiagnostics,applyFactCoverage,VERSION};
