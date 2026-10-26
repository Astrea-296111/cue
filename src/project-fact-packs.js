'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { performance } = require('perf_hooks');
const {boundedRankingText, projectQuestionParts} = require('./project-question-parts');
const {normalizeConceptText}=require('./project-search');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);
const validPath = x => typeof x === 'string' && x.length > 0 && !/^(?:[A-Za-z]:|[/\\])/.test(x) && !x.replace(/\\/g,'/').split('/').some(p=>p==='..'||p==='.');
const types = new Set('overview implementation decision challenge incident performance ownership collaboration limitation'.split(' '));
const scopes = new Set('implemented test_only planned hypothetical unverified'.split(' '));
const MAX_FACT_BYTES = 16 * 1024 * 1024;
const MAX_FACT_CARDS = 4096;
const implementations = new Set(['current_public_repo','resume_claim','narrative_scenario','proposed_design','general_knowledge','unverified_reference']);
function validateIndex(index) {
  const v2 = index?.schemaVersion === 2;
  if (Buffer.byteLength(JSON.stringify(index)||'', 'utf8') > (v2 ? MAX_FACT_BYTES : 2*1024*1024)) throw new Error('事实包超过允许大小');
  if (![1,2].includes(index?.schemaVersion) || !Array.isArray(index.projects) || index.projects.length > (v2 ? 16 : 8) || !Array.isArray(index.cards) || index.cards.length > (v2 ? MAX_FACT_CARDS : 160)) throw new Error('事实包 schema/version 或数量无效');
  const projects = new Set(), aliases = new Map(), ids = new Set();
  for (const p of index.projects) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(p.id) || projects.has(p.id) || typeof p.name !== 'string' || p.name.length>80 || !Array.isArray(p.aliases) || p.aliases.length>12 || p.aliases.some(a=>typeof a!=='string'||a.length>80)) throw new Error('项目身份无效或重复');
    projects.add(p.id);
    for (const a of [p.name,...p.aliases]) { const k=String(a).trim().toLowerCase(); if(k.length<2 || aliases.has(k)&&aliases.get(k)!==p.id) throw new Error('项目别名冲突'); aliases.set(k,p.id); }
  }
  for (const c of index.cards) {
    if (!/^[a-z][a-z0-9.-]{2,100}$/.test(c.cardId) || ids.has(c.cardId) || !projects.has(c.projectId) || !types.has(c.docType) || !scopes.has(c.truthScope) || !['verified','source-claim','missing','draft'].includes(c.status)) throw new Error('卡片身份/事实状态无效');
    if (!validPath(c.path) || typeof c.text !== 'string' || !c.text.trim() || c.text.length>(v2 ? 12000 : 1800) || !Array.isArray(c.keywords) || !Array.isArray(c.related) || !Array.isArray(c.sources) || !c.sources.length) throw new Error('卡片内容/相对路径无效');
    if (c.sources.some(s=>!validPath(s.path)||!s.symbol||!(/^[a-f0-9]{40}$/.test(s.commit)||((v2||c.provenance==='USER')&&s.commit==null&&/^[a-f0-9]{64}$/.test(s.contentSha256))))) throw new Error('缺少有效来源路径/符号/提交');
    if (!['PROJECT','CODE','REFERENCE','REFERENCE-STORY','LOCAL-BENCH','FUTURE','GAP','USER'].includes(c.provenance)) throw new Error('来源范围无效');
    if (['REFERENCE','REFERENCE-STORY','LOCAL-BENCH','FUTURE'].includes(c.provenance) && ['ownership','collaboration'].includes(c.docType) && c.status==='verified') throw new Error('参考材料不能升级为本人经历');
    if (v2) {
      if (!implementations.has(c.implementation) || typeof c.topic !== 'string' || !c.topic.trim() || !Array.isArray(c.questions) || !c.questions.length || c.questions.some(q=>typeof q!=='string') || typeof c.answerShort !== 'string' || !Array.isArray(c.deepPoints) || !Array.isArray(c.boundaries) || !Array.isArray(c.cannotSay) || !Array.isArray(c.followups) || !Array.isArray(c.facts) || typeof c.applicableVersion !== 'string') throw new Error('v2 卡片范围或问答元数据无效');
      for (const key of ['deepPoints','boundaries','cannotSay','followups']) if (c[key].some(value=>typeof value!=='string')) throw new Error('v2 卡片文本元数据无效');
      if (c.provenance === 'USER' && (c.status === 'verified' || c.implementation !== 'resume_claim')) throw new Error('用户声明不能升级为独立实证');
      if (c.provenance === 'REFERENCE-STORY' && (c.implementation !== 'narrative_scenario' || c.status === 'verified' || !c.story || typeof c.story !== 'object')) throw new Error('合成叙事不可升级为代码或历史实证');
      if (c.provenance === 'FUTURE' && c.implementation !== 'proposed_design') throw new Error('未来方案范围无效');
      if (c.provenance === 'CODE' && c.status === 'verified' && (c.implementation !== 'current_public_repo' || c.sources.some(s=>!s.commit) || c.verification?.method !== 'source-review' || !Array.isArray(c.verification.checkedSources) || !c.verification.checkedSources.length || c.verification.checkedSources.some(s=>!validPath(s.path)||!/^[a-f0-9]{40}$/.test(s.commit)||!/^[a-f0-9]{64}$/.test(s.contentSha256)))) throw new Error('核实代码必须绑定实际源码检查和真实提交');
      if (c.provenance === 'CODE' && c.status === 'verified' && c.sources.some(s=>typeof index.sourceDocuments?.[s.path]!=='string'||!s.contentSha256||!index.sourceDocuments[s.path].includes(s.symbol)||!c.verification.checkedSources.some(checked=>checked.commit===s.commit&&checked.contentSha256===s.contentSha256))) throw new Error('核实代码必须包含对应源码正文与已核查摘要');
      if (c.provenance === 'LOCAL-BENCH' && (!c.experiment || !c.experiment.reportPath || !/^[a-f0-9]{64}$/.test(c.experiment.contentSha256||''))) throw new Error('本地实验必须关联真实报告摘要');
    }
    ids.add(c.cardId);
  }
  for(const c of index.cards) if(c.related.some(id=>!ids.has(id))) throw new Error('关联卡片不存在');
  const claims = new Map();
  for(const c of index.cards) for(const f of c.facts||[]) { if(!f.key || typeof f.value!=='string') throw new Error('原子事实格式无效'); const k=[c.projectId,c.truthScope,c.provenance,f.key].join(':'); if(claims.has(k)&&claims.get(k)!==f.value) throw new Error('冲突事实 '+k); claims.set(k,f.value); }
  if(index.sourceDocuments!=null) {
    if(typeof index.sourceDocuments!=='object'||Array.isArray(index.sourceDocuments)) throw new Error('sourceDocuments 必须是路径到原始文本的映射');
    for(const [name,text] of Object.entries(index.sourceDocuments)) if(!validPath(name)||typeof text!=='string') throw new Error('sourceDocuments 来源路径或文本无效');
    for(const c of index.cards) for(const ref of c.sources) {
      if(Object.hasOwn(index.sourceDocuments,ref.path)&&ref.contentSha256&&createHash('sha256').update(index.sourceDocuments[ref.path],'utf8').digest('hex')!==ref.contentSha256) throw new Error('嵌入来源哈希不匹配：'+ref.path);
    }
  }
  return JSON.parse(JSON.stringify(index));
}
function compileProjectPacks({ rootDir = path.join(__dirname,'../project-packs'), sourceRoots } = {}) {
  const projects=[], cards=[];
  for(const entry of fs.readdirSync(rootDir,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    const dir=path.join(rootDir,entry.name,'interview');
    const manifest=fs.readFileSync(path.join(dir,'project.md'),'utf8').match(/<!-- cue-project (.*?) -->/s);
    if(!manifest) throw new Error('项目 manifest 缺失'); projects.push(JSON.parse(manifest[1]));
    for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.md')&&f!=='project.md').sort()) {
      const raw=fs.readFileSync(path.join(dir,file),'utf8'), match=raw.match(/<!-- cue-fact (.*?) -->/s);
      if(!match) throw new Error('卡片元数据缺失 '+file);
      const c=JSON.parse(match[1]); c.path=`${entry.name}/interview/${file}`;
      c.text=raw.replace(/^---\n[\s\S]*?\n---\n/,'').replace(/<!-- cue-fact .*? -->/s,'').trim();
      if(sourceRoots) for(const s of c.sources) if(!fs.existsSync(path.join(sourceRoots[c.projectId],s.path))) throw new Error('来源文件丢失 '+s.path);
      cards.push(c);
    }
  }
  const index=validateIndex({schemaVersion:1,projects,cards});
  index.revision=hash(index); index.updatedAt='2026-10-22';
  index.coverage=projects.map(p=>({projectId:p.id,confirmed:[...new Set(cards.filter(c=>c.projectId===p.id&&c.status!=='missing').map(c=>c.docType))],gaps:cards.filter(c=>c.projectId===p.id&&c.status==='missing').map(c=>c.cardId)}));
  return index;
}
const intents = [ ['ownership',/负责|职责|个人贡献|你做|我做|本人/], ['collaboration',/分工|协作|同事|团队|联调|几个人|多少人|几人|一个人|独立开发/], ['challenge',/困难|难点|挑战|排查|故障/], ['performance',/性能|压测|延迟|吞吐|指标|数字/], ['decision',/选型|取舍|为什么|为何|不用|不采用/], ['overview',/介绍|概览|整体|链路|做什么|多久|时间|几个月/]];
const grams = text => {
  // Equivalent database vocabulary should meet the same prepared feature;
  // this affects retrieval only, never rewrites a source or a model question.
  const s=normalizeConceptText(String(text).normalize('NFKC')).toLowerCase()
    .replace(/唯一(?:索引|约束)|\bunique\s+(?:index|constraint|key)\b/g,'唯一键')
    .replace(/介绍一下|这个项目|那个项目|你们|我们|刚才|前面|这里|那里|为什么|为何|如何|怎么|怎样|什么|哪些|具体|一下|解决|问题|能不能|可不可以/g,'')
    .replace(/[^\p{L}\p{N}]/gu,'');
  return new Set([...s].slice(0,-1).map((_,i)=>s.slice(i,i+2)).filter(term=>!/^[的了呢吗这那它其]|[的了呢吗]$/.test(term)));
};
class ProjectFactPacks {
  constructor({index}={}) {this.replace(index||JSON.parse(fs.readFileSync(path.join(__dirname,'../project-packs/index.json'),'utf8')));}
  replace(index) { const next=validateIndex(index);next.revision=hash({schemaVersion:next.schemaVersion,projects:next.projects,cards:next.cards,sourceDocuments:next.sourceDocuments,provenanceNotes:next.provenanceNotes});next.coverage=coverage(next);this.index=next;
    this.features=next.cards.map(c=>{
      // Question/keyword features describe the card's subject more precisely
      // than incidental mentions in its answer. Prepare them on publication;
      // foreground requests only compare bounded, project-scoped features.
      const keywords=c.keywords.slice(0,64).map(k=>String(k).toLowerCase().slice(0,256));
      const questions=(c.questions||[]).slice(0,16).map(value=>String(value).slice(0,1000));
      return {card:c,terms:grams(keywords.join(' ')+c.text),keywords,
        subjects:grams([...keywords,...questions,c.topic||''].join(' ')),questions:questions.map(grams)};
    });
    this.metricIndex=require('./metric-index').build(next.cards);
    this.featuresByProject=new Map(next.projects.map(p=>[p.id,this.features.filter(f=>f.card.projectId===p.id)]));
    this.evidenceById=new Map(next.cards.map(c=>[c.cardId,{...c,id:c.cardId,projectName:next.projects.find(p=>p.id===c.projectId).name,sourceType:'project-pack',revision:next.revision,startLine:1,endLine:c.text.split('\n').length,text:`${c.implementation==='proposed_design'?'【新增方案，非历史结果；只能用我会/建议描述组别，不得说已经跑过】\n':''}[${c.provenance} / ${c.status}${c.implementation?' / '+c.implementation:''}] ${c.text}\n来源：${c.sources.map(s=>`${s.path}#${s.symbol}@${s.commit||s.contentSha256}`).join('; ')}`} ]));
    return this.getIndex(); }
  getIndex(){return JSON.parse(JSON.stringify(this.index));}
  listProjects(){return JSON.parse(JSON.stringify(this.index.projects.filter(p=>p.kind!=='knowledge')));}
  pageCards({projectId,offset=0,limit=100}={}) {const cards=projectId?(this.featuresByProject.get(projectId)||[]).map(f=>f.card):this.index.cards;const start=Math.max(0,Math.floor(offset)||0),size=Math.max(1,Math.min(250,Math.floor(limit)||100));return {cards:JSON.parse(JSON.stringify(cards.slice(start,start+size))),total:cards.length,offset:start,nextOffset:start+size<cards.length?start+size:null};}
  selectKnowledge(question,{jobProfileId='',maxCards=3}={}) {
    const q=boundedRankingText(question),query=grams(q),features=this.index.projects.filter(p=>p.kind==='knowledge').flatMap(p=>this.featuresByProject.get(p.id)||[]);
    const preferred=jobProfileId==='ai_supply_chain'?'ai-':jobProfileId==='java_security'?'sec-':'';
    const applicable=features.filter(f=>!['FUTURE'].includes(f.card.provenance)||/岗位|迁移|供应链|业务|未来|后续|打算|如果/.test(q));
    const selected=applicable.map(f=>({f,score:[...query].filter(g=>f.terms.has(g)).length/Math.max(1,query.size)+f.keywords.filter(k=>q.toLowerCase().includes(k)).length*.6+(preferred&&f.card.cardId.startsWith(preferred)?.06:0)})).filter(row=>row.score>.08).sort((a,b)=>b.score-a.score||a.f.card.cardId.localeCompare(b.f.card.cardId)).slice(0,Math.max(0,Math.min(6,maxCards)));
    return {evidence:selected.map(row=>this.evidenceById.get(row.f.card.cardId)),stats:{selectedCardCount:selected.length,packRevision:this.index.revision},scope:'general-knowledge-reference'};
  }
  select(question,{projectId,anchor,maxCards=4,effectiveModel={},resolution,primaryQuestion}={}) {
    const at=performance.now(), q=boundedRankingText(primaryQuestion||question), lower=q.toLowerCase();
    const resolvedIds=resolution ? resolution.canonicalProjectIds||resolution.projectIds||[] : null;
    let mentioned;
    if(resolution) mentioned=this.index.projects.filter(p=>p.kind!=='knowledge'&&resolvedIds.includes(p.id)&&resolution.retrieveFacts!==false);
    else {
      mentioned=this.index.projects.filter(p=>p.kind!=='knowledge'&&[p.name,...p.aliases].some(a=>lower.includes(a.toLowerCase())));
      mentioned=mentioned.filter(p=>![p.name,...p.aliases].some(a=>new RegExp('(?:不是|别谈|不要|并非)\\s*'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(q)));
    const unknownNames=[...q.matchAll(/([\p{L}\p{N}_.-]{2,48})\s*项目/gu)].map(m=>m[1].replace(/^(?:请)?(?:介绍一下|介绍|讲讲|说说|关于|你在|我在|在|你的|我的)/,'')).filter(n=>n&&!/^(?:这个|那个|你们|我们|当前|刚才|之前|上一个)$/.test(n)&&!this.index.projects.some(p=>[p.name,...p.aliases].some(a=>a.toLowerCase()===n.toLowerCase())));
    if(unknownNames.length&&!mentioned.length)return {evidence:[],localFacts:[],anchor:null,projectIds:[],gaps:[],stats:{selectedCardCount:0,selectionMs:performance.now()-at,packRevision:this.index.revision}};
    const contextual=/这个项目|你们项目|项目中|你负责|你做|个人贡献|团队分工|刚才|这个困难|那个方案|为什么不用|怎么解决/.test(q);
    if(!mentioned.length&&contextual) { const id=projectId||anchor?.projectId; mentioned=this.index.projects.filter(p=>p.kind!=='knowledge'&&p.id===id); }
    }
    if(!mentioned.length) return {evidence:[],localFacts:[],anchor:null,projectIds:[],gaps:[],stats:{selectedCardCount:0,selectionMs:performance.now()-at,packRevision:this.index.revision}};
    // A previous candidate utterance may help identify a topic but does not
    // change what the interviewer is asking now. Inherited broad route intents
    // must not make a technical follow-up look like another self-introduction.
    const requested=intents.filter(([,re])=>re.test(q)).map(([t])=>t);
    const rankText=mentioned.reduce((text,p)=>[p.name,...p.aliases].reduce((s,a)=>s.toLowerCase().split(a.toLowerCase()).join(''),text),q);
    const terms=grams(rankText), scoped=mentioned.flatMap(p=>this.featuresByProject.get(p.id)||[]);
    const contextTerms=primaryQuestion&&String(primaryQuestion)!==String(question)
      ? grams(boundedRankingText(String(question).replace(String(primaryQuestion),''))) : new Set();
    const parts=projectQuestionParts(q,resolution||{projectIds:mentioned.map(p=>p.id)});
    const multi=parts.length>1;
    const scoreFor=(f,text,queryTerms,requestedTypes)=>{
      const c=f.card, normalized=text.toLowerCase(), overlap=[...queryTerms].filter(g=>f.terms.has(g)).length;
      const matches=values=>[...queryTerms].filter(g=>values.has(g)).length;
      const bodyMatch=overlap/Math.max(1,queryTerms.size),subjectMatch=matches(f.subjects)/Math.max(1,queryTerms.size);
      const keywordHits=f.keywords.filter(k=>k.length>1&&normalized.includes(k)).length;
      const questionMatch=Math.max(0,...f.questions.map(terms=>matches(terms)/Math.max(1,Math.sqrt(queryTerms.size*terms.size))));
      const lexical=bodyMatch+Math.min(3,keywordHits)*.4;
      let score=lexical+subjectMatch*1.2+questionMatch*.9;
      if(contextTerms.size)score+=[...contextTerms].filter(term=>f.subjects.has(term)).length/contextTerms.size*.12;
      const personal=/个人贡献|你(?:具体|主要)?负责(?:哪|什么|的部分)|具体负责哪些|职责(?:是什么|有哪些|边界)|几个人|多少人|团队(?:分工|组成)|和谁协作|一个人做|独立开发|时间线|开发周期|几个月|(?:开发|做|用|持续|历时)(?:了)?多久/.test(text);
      const intentMatch=requestedTypes.includes(c.docType);
      const relevant=bodyMatch>.08||subjectMatch>.04||keywordHits>0||personal&&intentMatch;
      if(relevant&&intentMatch)score+=personal?.9:.15;
      if(personal&&c.provenance==='USER'&&c.status!=='missing'&&intentMatch)score+=.2;
      if(/时间线|开发周期|几个月|何时(?:开始|完成)|哪年|(?:开发|做|用|持续|历时)(?:了)?多久/.test(text)&&c.docType==='overview'&&f.keywords.some(k=>/时间|周期|几个月|timeline/.test(k)))score+=1.2;
      if(anchor?.cardIds?.includes(c.cardId)&&/刚才|这个困难|那个方案|另一种/.test(q)) score+=2;
      return {c,score,lexical,relevant};
    };
    const order=(a,b)=>b.score-a.score||a.c.cardId.localeCompare(b.c.cardId);
    const ranked=scoped.map(f=>scoreFor(f,rankText,terms,requested)).sort(order);
    const metricQuestion=q+'\n'+(resolution?.metricContext||'');
    const metricIds=require('./metric-index').matches(metricQuestion,mentioned.map(p=>p.id));
    const mechanismIds=require('./metric-index').mechanisms(q,metricIds,mentioned.map(p=>p.id));
    const chosen=[]; const add=c=>{if(c&&!chosen.includes(c)&&chosen.length<Math.min(12,maxCards)) chosen.push(c);};
    for(const id of metricIds) add(this.metricIndex.get(id));
    for(const id of mechanismIds)add(scoped.find(f=>f.card.cardId===id)?.card);
    // Each actual ask gets a relevant card before global intent preferences.
    // A long scenario mentioning latency must not spend its first slots on
    // unrelated benchmark cards while dropping the final recovery/cancel ask.
    if(multi)for(const part of parts){
      const ownTerms=grams(part.text), wanted=intents.filter(([,re])=>re.test(part.text)).map(([t])=>t);
      const own=scoped.filter(f=>!part.projectIds.length||part.projectIds.includes(f.card.projectId)).map(f=>scoreFor(f,part.text,ownTerms,wanted)).sort(order);
      for(const project of mentioned.filter(p=>!part.projectIds.length||part.projectIds.includes(p.id)))add(own.find(row=>row.c.projectId===project.id&&row.relevant)?.c);
    }
    // Short personal followups still rely on their explicit intent, even when
    // they contain no implementation vocabulary.
    for(const p of mentioned) {
      let best=ranked.find(x=>x.c.projectId===p.id&&x.relevant);
      if(!best)best=ranked.find(x=>x.c.projectId===p.id&&x.c.docType==='overview');
      if(!best&&requested.includes('overview'))best=ranked.find(x=>x.c.projectId===p.id&&x.c.docType==='ownership'&&/背景|职责|概览/.test(x.c.topic||''));
      add(best?.c);
    }
    for(const x of ranked) if(x.relevant&&x.score>.04) add(x.c);
    if(chosen.length<Math.min(4,maxCards)&&chosen.length) { const first=chosen[0];add(scoped.find(f=>first.related.includes(f.card.cardId))?.card); }
    const evidence=chosen.map(c=>({...this.evidenceById.get(c.cardId),protectedMetric:metricIds.includes(c.cardId),protectedMechanism:mechanismIds.includes(c.cardId)}));
    const localFacts=evidence.filter(c=>c.status==='verified'&&c.provenance==='CODE').slice(0,2).map(c=>({cardId:c.cardId,text:c.text,projectName:c.projectName}));
    return {evidence,localFacts,anchor:{projectId:mentioned.length===1?mentioned[0].id:null,cardIds:chosen.map(c=>c.cardId),revision:this.index.revision},projectIds:mentioned.map(p=>p.id),gaps:chosen.filter(c=>c.status==='missing').map(c=>c.cardId),stats:{selectedCardCount:chosen.length,selectionMs:performance.now()-at,packRevision:this.index.revision,cacheKey:hash([mentioned.map(p=>p.id),this.index.revision,q,resolution?.sourceScopes||[],resolution?.intent||[]])}};
  }
}
function coverage(index) {
  return index.projects.map(p=>({projectId:p.id,cardCount:index.cards.filter(c=>c.projectId===p.id).length,confirmed:[...new Set(index.cards.filter(c=>c.projectId===p.id&&c.status!=='missing').map(c=>c.docType))],gaps:index.cards.filter(c=>c.projectId===p.id&&c.status==='missing').map(c=>c.cardId)}));
}
function mergeFactIndexes(base, incoming, {mode='merge', resolutions={}, selectedProjects=incoming.projects.map(p=>p.id)}={}) {
  validateIndex(incoming);
  if(!['merge','replace-projects','replace-all'].includes(mode))throw new Error('未知事实合并模式');
  const prior=mode==='replace-all'?{projects:[],cards:[]}:base;
  const projects=new Map(prior.projects.map(p=>[p.id,p]));
  for(const p of incoming.projects)projects.set(p.id,{...projects.get(p.id),...p});
  const cards=new Map(prior.cards.filter(c=>mode!=='replace-projects'||!selectedProjects.includes(c.projectId)).map(c=>[c.cardId,c]));
  const changes=[];
  for(const card of incoming.cards) {
    const old=base.cards.find(c=>c.cardId===card.cardId);
    if(old&&old.projectId!==card.projectId)throw new Error('同一卡片 ID 的项目归属冲突：'+card.cardId);
    const different=old&&JSON.stringify(old)!==JSON.stringify(card);
    if(!old||different)changes.push({id:card.cardId,projectId:card.projectId,kind:old?'update':'add',old:old||null,new:card});
    if(resolutions[card.cardId]==='keep'&&old)cards.set(card.cardId,old);else cards.set(card.cardId,card);
  }
  const deleted=base.cards.filter(c=>!cards.has(c.cardId)).map(c=>({id:c.cardId,projectId:c.projectId,kind:'delete',old:c}));
  const documents={...(mode==='replace-all'?{}:base.sourceDocuments||{}),...incoming.sourceDocuments||{}};
  // Retained cards retain their exact embedded origin; final validation rejects
  // active cards that require conflicting bodies at the same source path.
  for(const card of cards.values())for(const ref of card.sources){
    if(!ref.contentSha256)continue;
    const candidates=[base.sourceDocuments?.[ref.path],incoming.sourceDocuments?.[ref.path]].filter(text=>typeof text==='string');
    const matching=candidates.find(text=>createHash('sha256').update(text,'utf8').digest('hex')===ref.contentSha256);
    if(matching!==undefined)documents[ref.path]=matching;
  }
  const usedPaths=new Set([...cards.values()].flatMap(c=>c.sources.map(s=>s.path)));
  const version=Math.max(base.schemaVersion||1,incoming.schemaVersion||1);
  const rows=[...cards.values()].map(c=>version===2?migrateCard(c):c);
  const index=validateIndex({schemaVersion:version,projects:[...projects.values()],cards:rows,sourceDocuments:Object.fromEntries(Object.entries(documents).filter(([p])=>usedPaths.has(p))),provenanceNotes:{...base.provenanceNotes,...incoming.provenanceNotes},updatedAt:incoming.updatedAt||base.updatedAt});
  index.revision=hash({schemaVersion:index.schemaVersion,projects:index.projects,cards:index.cards,sourceDocuments:index.sourceDocuments,provenanceNotes:index.provenanceNotes});index.coverage=coverage(index);
  return {index,changes:[...changes,...deleted]};
}
function migrateCard(card) {
  if(card.implementation) return JSON.parse(JSON.stringify(card));
  const c=JSON.parse(JSON.stringify(card));
  // A legacy "verified" label alone is not a new source review or benchmark report.
  const unreviewed = c.status==='verified'&&((c.provenance==='CODE'&&!c.verification)||(c.provenance==='LOCAL-BENCH'&&!c.experiment)||c.provenance==='USER');
  if(c.provenance==='LOCAL-BENCH'&&!c.experiment)c.provenance='REFERENCE';
  return {...c,status:unreviewed?'source-claim':c.status,topic:c.topic||c.docType,questions:[c.question||c.keywords?.[0]||c.cardId],answerShort:c.text,deepPoints:c.text.split(/\n\s*\n/),facts:c.facts||[],boundaries:unreviewed?['旧版本验证标签未经本次独立核查，保留为来源声明。']:[],cannotSay:[],followups:[],implementation:c.provenance==='USER'?'resume_claim':c.provenance==='CODE'?'current_public_repo':c.provenance==='REFERENCE-STORY'?'narrative_scenario':c.provenance==='FUTURE'?'proposed_design':'unverified_reference',applicableVersion:c.sources.find(s=>s.commit)?.commit||'user-supplied',migration:{fromSchema:1,preserved:true,originalProvenance:card.provenance,originalStatus:card.status,originalTruthScope:card.truthScope}};
}
function migrateFactIndex(index) {
  const current=validateIndex(index);if(current.schemaVersion===2)return current;
  return validateIndex({...current,schemaVersion:2,cards:current.cards.map(migrateCard),migration:{fromSchema:1,originalRevision:current.revision||hash(current)}});
}
module.exports={ProjectFactPacks,validateIndex,compileProjectPacks,mergeFactIndexes,coverage,migrateCard,migrateFactIndex,MAX_FACT_BYTES,MAX_FACT_CARDS};
