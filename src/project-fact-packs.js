'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { performance } = require('perf_hooks');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);
const validPath = x => typeof x === 'string' && x.length > 0 && !/^(?:[A-Za-z]:|[/\\])/.test(x) && !x.replace(/\\/g,'/').split('/').some(p=>p==='..'||p==='.');
const types = new Set('overview implementation decision challenge incident performance ownership collaboration limitation'.split(' '));
const scopes = new Set('implemented test_only planned hypothetical unverified'.split(' '));
function validateIndex(index) {
  if (Buffer.byteLength(JSON.stringify(index)||'', 'utf8') > 2*1024*1024) throw new Error('事实包超过 2MB');
  if (index?.schemaVersion !== 1 || !Array.isArray(index.projects) || index.projects.length > 8 || !Array.isArray(index.cards) || index.cards.length > 160) throw new Error('事实包 schema/version 或数量无效');
  const projects = new Set(), aliases = new Map(), ids = new Set();
  for (const p of index.projects) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(p.id) || projects.has(p.id) || typeof p.name !== 'string' || p.name.length>80 || !Array.isArray(p.aliases) || p.aliases.length>12 || p.aliases.some(a=>typeof a!=='string'||a.length>80)) throw new Error('项目身份无效或重复');
    projects.add(p.id);
    for (const a of [p.name,...p.aliases]) { const k=String(a).trim().toLowerCase(); if(k.length<2 || aliases.has(k)&&aliases.get(k)!==p.id) throw new Error('项目别名冲突'); aliases.set(k,p.id); }
  }
  for (const c of index.cards) {
    if (!/^[a-z][a-z0-9.-]{2,100}$/.test(c.cardId) || ids.has(c.cardId) || !projects.has(c.projectId) || !types.has(c.docType) || !scopes.has(c.truthScope) || !['verified','source-claim','missing','draft'].includes(c.status)) throw new Error('卡片身份/事实状态无效');
    if (!validPath(c.path) || typeof c.text !== 'string' || !c.text.trim() || c.text.length>1800 || !Array.isArray(c.keywords) || !Array.isArray(c.related) || !Array.isArray(c.sources) || !c.sources.length) throw new Error('卡片内容/相对路径无效');
    if (c.sources.some(s=>!validPath(s.path)||!s.symbol||!(/^[a-f0-9]{40}$/.test(s.commit)||(c.provenance==='USER'&&s.commit==null&&/^[a-f0-9]{64}$/.test(s.contentSha256))))) throw new Error('缺少有效来源路径/符号/提交');
    if (!['PROJECT','CODE','REFERENCE','REFERENCE-STORY','LOCAL-BENCH','FUTURE','GAP','USER'].includes(c.provenance)) throw new Error('来源范围无效');
    if (['REFERENCE','REFERENCE-STORY','LOCAL-BENCH','FUTURE'].includes(c.provenance) && ['ownership','collaboration'].includes(c.docType) && c.status==='verified') throw new Error('参考材料不能升级为本人经历');
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
const grams = text => { const s=String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');return new Set([...s].slice(0,-1).map((_,i)=>s.slice(i,i+2))); };
class ProjectFactPacks {
  constructor({index}={}) {this.replace(index||JSON.parse(fs.readFileSync(path.join(__dirname,'../project-packs/index.json'),'utf8')));}
  replace(index) { const next=validateIndex(index);next.revision=hash({schemaVersion:1,projects:next.projects,cards:next.cards,sourceDocuments:next.sourceDocuments,provenanceNotes:next.provenanceNotes});next.coverage=coverage(next);this.index=next;
    this.features=next.cards.map(c=>({card:c,terms:grams(c.keywords.join(' ')+c.text),keywords:c.keywords.map(k=>String(k).toLowerCase())}));
    this.evidenceById=new Map(next.cards.map(c=>[c.cardId,{...c,id:c.cardId,projectName:next.projects.find(p=>p.id===c.projectId).name,sourceType:'project-pack',revision:next.revision,startLine:1,endLine:c.text.split('\n').length,text:`[${c.provenance} / ${c.status}] ${c.text}\n来源：${c.sources.map(s=>`${s.path}#${s.symbol}@${s.commit||s.contentSha256}`).join('; ')}`} ]));
    return this.getIndex(); }
  getIndex(){return JSON.parse(JSON.stringify(this.index));}
  listProjects(){return JSON.parse(JSON.stringify(this.index.projects));}
  select(question,{projectId,anchor,maxCards=4,effectiveModel={},resolution}={}) {
    const at=performance.now(), q=String(question).slice(0,8000), lower=q.toLowerCase();
    const resolvedIds=resolution ? resolution.canonicalProjectIds||resolution.projectIds||[] : null;
    let mentioned;
    if(resolution) mentioned=this.index.projects.filter(p=>resolvedIds.includes(p.id)&&resolution.retrieveFacts!==false);
    else {
      mentioned=this.index.projects.filter(p=>[p.name,...p.aliases].some(a=>lower.includes(a.toLowerCase())));
      mentioned=mentioned.filter(p=>![p.name,...p.aliases].some(a=>new RegExp('(?:不是|别谈|不要|并非)\\s*'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(q)));
    const unknownNames=[...q.matchAll(/([\p{L}\p{N}_.-]{2,48})\s*项目/gu)].map(m=>m[1].replace(/^(?:请)?(?:介绍一下|介绍|讲讲|说说|关于|你在|我在|在|你的|我的)/,'')).filter(n=>n&&!/^(?:这个|那个|你们|我们|当前|刚才|之前|上一个)$/.test(n)&&!this.index.projects.some(p=>[p.name,...p.aliases].some(a=>a.toLowerCase()===n.toLowerCase())));
    if(unknownNames.length&&!mentioned.length)return {evidence:[],localFacts:[],anchor:null,projectIds:[],gaps:[],stats:{selectedCardCount:0,selectionMs:performance.now()-at,packRevision:this.index.revision}};
    const contextual=/这个项目|你们项目|项目中|你负责|你做|个人贡献|团队分工|刚才|这个困难|那个方案|为什么不用|怎么解决/.test(q);
    if(!mentioned.length&&contextual) { const id=projectId||anchor?.projectId; mentioned=this.index.projects.filter(p=>p.id===id); }
    }
    if(!mentioned.length) return {evidence:[],localFacts:[],anchor:null,projectIds:[],gaps:[],stats:{selectedCardCount:0,selectionMs:performance.now()-at,packRevision:this.index.revision}};
    const requested=resolution?.intent?.length?resolution.intent:intents.filter(([,re])=>re.test(q)).map(([t])=>t);
    const rankText=mentioned.reduce((text,p)=>[p.name,...p.aliases].reduce((s,a)=>s.toLowerCase().split(a.toLowerCase()).join(''),text),q);
    const terms=grams(rankText);
    const ranked=this.features.filter(f=>mentioned.some(p=>p.id===f.card.projectId)).map(f=>{
      const c=f.card, overlap=[...terms].filter(g=>f.terms.has(g)).length;
      let score=overlap/Math.max(1,terms.size) + f.keywords.filter(k=>rankText.toLowerCase().includes(k)).length*.6;
      if(c.provenance==='USER'&&c.status!=='missing'&&(overlap>0||requested.includes(c.docType))) score+=.3;
      if(requested.includes(c.docType)) score+=3;
      if(/多久|时间线|开发周期|几个月|何时|哪年/.test(q)&&c.docType==='overview'&&f.keywords.some(k=>/时间|周期|几个月|timeline/.test(k)))score+=4;
      if(anchor?.cardIds?.includes(c.cardId)&&/刚才|这个困难|那个方案|另一种/.test(q)) score+=2;
      return {c,score};
    }).sort((a,b)=>b.score-a.score||a.c.cardId.localeCompare(b.c.cardId));
    const chosen=[]; const add=c=>{if(c&&!chosen.includes(c)&&chosen.length<Math.min(12,maxCards)) chosen.push(c);};
    // Coverage per intent and per project precedes lexical ranking.
    const wanted=requested;
    for(const p of mentioned) add(ranked.find(x=>x.c.projectId===p.id&&(!wanted.length||wanted.includes(x.c.docType)))?.c);
    for(const t of wanted) for(const p of mentioned) add(ranked.find(x=>x.c.projectId===p.id&&x.c.docType===t)?.c);
    if(chosen.length<Math.min(4,maxCards)&&chosen.length) { const first=chosen[0];add(this.index.cards.find(c=>first.related.includes(c.cardId)&&c.projectId===first.projectId)); }
    for(const x of ranked) if(x.score>.04) add(x.c);
    const evidence=chosen.map(c=>this.evidenceById.get(c.cardId));
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
  const index=validateIndex({schemaVersion:1,projects:[...projects.values()],cards:[...cards.values()],sourceDocuments:Object.fromEntries(Object.entries(documents).filter(([p])=>usedPaths.has(p))),provenanceNotes:{...base.provenanceNotes,...incoming.provenanceNotes},updatedAt:incoming.updatedAt||base.updatedAt});
  index.revision=hash({schemaVersion:1,projects:index.projects,cards:index.cards,sourceDocuments:index.sourceDocuments,provenanceNotes:index.provenanceNotes});index.coverage=coverage(index);
  return {index,changes:[...changes,...deleted]};
}
module.exports={ProjectFactPacks,validateIndex,compileProjectPacks,mergeFactIndexes,coverage};
