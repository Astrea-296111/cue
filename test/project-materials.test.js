'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ProjectMaterialService}=require('../src/project-material-service');
const {validateIndex,mergeFactIndexes,ProjectFactPacks}=require('../src/project-fact-packs');
const {buildRegistry,strictProjectScopes}=require('../src/project-registry');
const {planProjectRetrieval}=require('../src/project-query');
const {ConversationMemory}=require('../src/conversation-memory');
const {planProjectEvidence,sentEvidenceDiagnostics}=require('../src/project-evidence-policy');
const {buildInstantContext}=require('../src/instant-answer-context');
const {prepareFinalRequest}=require('../src/final-request-budget');
const {renderMarkdown}=require('../renderer/safe-markdown');
const {fixture,sourceFixture,loadAdapter,writeFolder,zip,sha}=require('./helpers/material-fixture');
const copy=x=>JSON.parse(JSON.stringify(x));
function setup(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cue-materials-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const adapter=loadAdapter(directory);const config={directory,bundled:fixture(),sourceAdapter:adapter,...options};return {directory,adapter,config,service:new ProjectMaterialService(config)};}
async function importIndex(service,index,mode='merge'){const preview=await service.prepareImport({kind:'json',index,mode});await service.commitImport(preview);return preview;}

test('I01/P01/P02 facts-only import and legacy source identity preserve actual scopes',async t=>{
 const {service}=setup(t,{legacySource:sourceFixture()});const registry=service.snapshot.registry.projects;
 assert.equal(registry.length,2);assert.deepEqual(registry.find(p=>p.id==='cae').sourceScopes,['@project:legacy-cae']);assert.equal(registry[0].sourceRevision,'source-v1');
 const privateLike=fixture(109);await importIndex(service,privateLike,'replace-all');assert.equal(service.snapshot.facts.cards.length,109);
 assert.ok(!strictProjectScopes([]));assert.ok(!strictProjectScopes([undefined]));assert.ok(!strictProjectScopes(['']));
 const only=buildRegistry(fixture(),{projects:[],chunks:[]}).projects;
 const plan=planProjectRetrieval([{channel:'them',text:'CAE 项目介绍'}],'say',{catalog:only});assert.deepEqual(plan.canonicalProjectIds,['cae']);assert.equal(plan.retrieveSources,false);assert.deepEqual(plan.sourceScopes,[]);
});

test('I02-I05 folder and rooted ZIP share facts, exclude fact text, retain package.json and accept 500KiB',async t=>{
 const {service,directory}=setup(t);const index=fixture();index.sourceDocuments={'extra/unused.md':'x'.repeat(520*1024)};
 const files={'interview/facts.json':JSON.stringify(index),'package.json':'{"name":"cae-job-platform","description":"synthetic project configuration, not a fact pack"}','src/run.js':'export function run(){ return "synthetic source"; }'};
 const folder=writeFolder(directory,'cae-job-platform',files),preview=await service.prepareImport({kind:'folder',path:folder});
 assert.equal(service.snapshot.sources.chunks.length,0);await service.commitImport(preview);
 assert.ok(service.snapshot.sources.chunks.some(c=>c.path==='package.json'));assert.ok(!service.snapshot.sources.chunks.some(c=>c.path.endsWith('facts.json')));
 const archive=path.join(directory,'cae-job-platform.zip');fs.writeFileSync(archive,zip(Object.fromEntries(Object.entries(files).map(([k,v])=>['cae-job-platform-main/'+k,v]))));
 const other=setup(t).service;await other.commitImport(await other.prepareImport({kind:'zip',path:archive}));
 assert.deepEqual(other.snapshot.facts.cards,service.snapshot.facts.cards);assert.deepEqual(other.snapshot.sources.chunks.map(c=>c.path).sort(),service.snapshot.sources.chunks.map(c=>c.path).sort());
 assert.deepEqual(other.snapshot.registry.projects.find(p=>p.id==='cae').sourceScopes.length,1);
});

test('I06 invalid combined input, traversal, symlinks and custom paths do not publish',async t=>{
 const {service,directory}=setup(t);const old=service.snapshot.generation;
 const folder=writeFolder(directory,'bad',{'interview/facts.json':'{"schemaVersion":7}','src/run.js':'export const marker=1;'});
 await assert.rejects(service.prepareImport({kind:'folder',path:folder}),/facts.json/);assert.equal(service.snapshot.generation,old);
 for(const [name,content,opts] of [['traversal',{'../secret.json':'secret'},{}],['link',{'interview/facts.json':JSON.stringify(fixture())},{symlink:true}]]){const file=path.join(directory,name+'.zip');fs.writeFileSync(file,zip(content,opts));await assert.rejects(service.prepareImport({kind:'zip',path:file}),/越界|符号链接/);}
 await assert.rejects(service.prepareImport({kind:'folder',path:folder,factPaths:['../x.json']}),/相对路径/);
 const custom=writeFolder(directory,'custom',{'interview/custom.json':JSON.stringify(fixture()),'run.js':'export const custom=1;'});
 const p=await service.prepareImport({kind:'folder',path:custom,factPaths:['interview/custom.json']});assert.deepEqual(p.summary.factFiles,['interview/custom.json']);
 assert.equal(service.snapshot.generation,old);
});

test('I07-I09 merge, keep, replace and final validation preserve unrelated materials',async t=>{
 const {service}=setup(t,{legacySource:sourceFixture()});const old=copy(service.snapshot.facts),source=service.snapshot.sourceRevision;
 const incoming=fixture();incoming.projects=incoming.projects.filter(p=>p.id==='cae');incoming.cards=incoming.cards.filter(c=>c.projectId==='cae');incoming.cards[0].text='更新后的合成资料';
 const preview=await service.prepareImport({index:incoming});assert.equal(preview.changes.length,1);assert.equal(preview.changes[0].old.text,old.cards[0].text);
 await service.commitImport({...preview,resolutions:{[incoming.cards[0].cardId]:'keep'}});assert.equal(service.snapshot.facts.cards[0].text,old.cards[0].text);
 await importIndex(service,incoming);assert.equal(service.snapshot.facts.cards.find(c=>c.cardId===incoming.cards[0].cardId).text,incoming.cards[0].text);assert.equal(service.snapshot.sourceRevision,source);
 assert.deepEqual(service.snapshot.facts.cards.filter(c=>c.projectId==='arclight'),old.cards.filter(c=>c.projectId==='arclight'));
 const many=fixture(160);many.cards=many.cards.map((c,i)=>({...c,cardId:c.projectId+'.new-'+i}));await assert.rejects(service.prepareImport({index:many}),/数量/);
 const dangling=fixture();dangling.cards[0].related=['cae.synthetic-6'];const reduced=copy(dangling);reduced.cards=reduced.cards.filter(c=>c.cardId!=='cae.synthetic-6');assert.throws(()=>mergeFactIndexes(dangling,reduced,{mode:'replace-projects'}),/关联/);
 const wrong=fixture();wrong.cards[0].projectId='arclight';assert.throws(()=>mergeFactIndexes(old,wrong),/归属/);
 const p=await service.prepareImport({index:{...incoming,cards:incoming.cards.slice(0,1)},mode:'replace-projects'});assert.ok(p.changes.some(c=>c.kind==='delete'));await service.commitImport(p);assert.equal(service.snapshot.facts.cards.filter(c=>c.projectId==='arclight').length,4);
});

test('multiple fact files require explicit variant choice rather than traversal order',async t=>{
 const {service,directory}=setup(t);const a=fixture(),b=fixture();b.cards[0].text='另一份不同的合成事实';
 const folder=writeFolder(directory,'multi',{'interview/facts.json':JSON.stringify(a),'project-fact-packs.json':JSON.stringify(b)});
 const preview=await service.prepareImport({kind:'folder',path:folder});assert.equal(preview.packConflicts.length,1);
 await assert.rejects(service.commitImport(preview),{code:'conflicting-packs'});
 await service.commitImport({...preview,variants:{'card:cae.synthetic-0':0}});assert.equal(service.snapshot.facts.cards[0].text,a.cards[0].text);
});

test('I10/I11 previews bind immutable content and reject stale/concurrent commits',async t=>{
 const {service,directory}=setup(t),index=fixture();index.cards[0].text='预览时的事实';const file=path.join(directory,'any-name.json');fs.writeFileSync(file,JSON.stringify(index));
 const first=await service.prepareImport({kind:'json',path:file}),second=await service.prepareImport({index:fixture()});index.cards[0].text='预览之后的外部文本';fs.writeFileSync(file,JSON.stringify(index));
 await service.commitImport(first);assert.equal(service.snapshot.facts.cards[0].text,'预览时的事实');await assert.rejects(service.commitImport(second),{code:'revision-changed'});
});

for(const stage of ['write-facts','write-sources','write-registry','before-pointer','after-pointer'])test('I12 recovery at '+stage,async t=>{
 const {service,config}=setup(t);const old=service.snapshot.generation,next=fixture();next.cards[0].text='完整新版事实';
 const preview=await service.prepareImport({index:next});service.failpoint=point=>{if(point===stage)throw new Error('injected '+stage);};await assert.rejects(service.commitImport(preview),/injected/);
 const restarted=new ProjectMaterialService(config);assert.equal(restarted.snapshot.facts.cards[0].text,stage==='after-pointer'?'完整新版事实':fixture().cards[0].text);assert.equal(restarted.snapshot.sources.chunks.length,0);if(stage!=='after-pointer')assert.equal(restarted.snapshot.generation,old);
});

test('M01 migration copies old files, does not replay them, and rollback/recovery restores whole generations',async t=>{
 const {service,directory,config}=setup(t);const old=service.snapshot.generation;await importIndex(service,fixture(10));const next=service.snapshot.generation;
 await service.rollbackMaterials({targetGeneration:old});assert.equal(service.snapshot.facts.cards.length,8);assert.notEqual(service.snapshot.generation,next);
 const current=JSON.parse(fs.readFileSync(path.join(directory,'cue-materials/current.json')));fs.writeFileSync(path.join(directory,'cue-materials',current.files.facts.path),'corrupt');
 const recovered=new ProjectMaterialService(config);assert.equal(recovered.snapshot.facts.cards.length,10);assert.ok(recovered.state().warnings.some(w=>w.includes('恢复')));
 const separate=fs.mkdtempSync(path.join(os.tmpdir(),'cue-migrate-'));t.after(()=>fs.rmSync(separate,{recursive:true,force:true}));const overlay=fixture();overlay.cards[0].text='旧覆盖层';for(const file of ['project-fact-packs.json','cue-project-index-v1.json','cue-project-index-v2.json'])fs.writeFileSync(path.join(separate,file),JSON.stringify(file.startsWith('project')?overlay:sourceFixture()));
 const opts={directory:separate,bundled:fixture(),legacySource:sourceFixture()};const migrated=new ProjectMaterialService(opts);assert.equal(migrated.snapshot.facts.cards[0].text,'旧覆盖层');assert.ok(fs.existsSync(path.join(separate,'cue-project-index-v1.json.pre-materials.bak')));fs.writeFileSync(path.join(separate,'project-fact-packs.json'),'invalid old file');assert.equal(new ProjectMaterialService(opts).snapshot.generation,migrated.snapshot.generation);
});

test('external pointer validation retains usable memory on corruption and adopts valid update',async t=>{
 const {service,config,directory}=setup(t),other=new ProjectMaterialService(config);await importIndex(other,fixture(10));service.refresh();assert.equal(service.snapshot.generation,other.snapshot.generation);
 fs.writeFileSync(path.join(directory,'cue-materials/current.json'),'broken');service.refresh();assert.equal(service.snapshot.facts.cards.length,10);assert.ok(service.state().warnings.length);
});

test('Q01-Q06 shared resolution drives facts-only short followups, correction, suspension and comparison ambiguity',()=>{
 const packs=new ProjectFactPacks({index:fixture()}),catalog=buildRegistry(packs.getIndex(),{projects:[],chunks:[]}).projects,memory=new ConversationMemory();
 const ask=(q,ids)=>{const request=memory.begin({mode:'say',question:q,catalog,settings:{currentProjectId:'cae'}});assert.deepEqual(request.plan.canonicalProjectIds,ids,q);const selected=packs.select(q,{resolution:request.plan,maxCards:12});assert.ok(selected.evidence.every(c=>ids.includes(c.projectId)),q);memory.commit(request,'AI旧答案不成为事实');return {request,selected};};
 ask('CAE 项目介绍',['cae']);assert.ok(ask('你们几个人',['cae']).selected.evidence.some(c=>c.docType==='collaboration'));assert.ok(ask('你负责哪块',['cae']).selected.evidence.some(c=>c.docType==='ownership'));
 ask('那 Arclight 呢',['arclight']);ask('是你一个人做的吗',['arclight']);ask('不是 CAE，是 Arclight',['arclight']);ask('Redis 过期策略是什么',[]);ask('只有五种吗',[]);ask('回到刚才那个项目',['arclight']);
 ask('介绍星河项目',[]);ask('比较 CAE 与 Arclight 的实现',['cae','arclight']);const ambiguous=ask('那你们几个人',[]);assert.equal(ambiguous.request.plan.kind,'unresolved');
 const empty=packs.select('CAE',{resolution:{canonicalProjectIds:[],retrieveFacts:false}});assert.equal(empty.evidence.length,0);
});

test('E04-E06/D01 mixed evidence reserves implementation source, refills after oversized card and reports only sent IDs',()=>{
 const packs=new ProjectFactPacks({index:fixture(16)}),resolution={kind:'project',canonicalProjectIds:['cae'],sourceScopes:['@project:legacy-cae'],retrieveFacts:true,retrieveSources:true,intent:['implementation']},facts=packs.select('CAE 恢复机制怎么实现',{resolution,maxCards:12}).evidence;
 const source={...sourceFixture().chunks[0],sourceType:'imported',docType:'implementation',truthScope:'implemented',status:'confirmed'};
 facts.splice(1,0,{...facts[0],id:'oversize',text:'超大'.repeat(5000)});
 const plan=planProjectEvidence({question:'CAE 恢复机制怎么实现',resolution,facts,sources:[source],evidenceTokens:1500,maxSources:4});assert.ok(plan.evidence.some(c=>c.id==='cae-source'));assert.equal(plan.evidence.length,4);assert.ok(plan.dropped.some(c=>c.id==='oversize'&&c.reason==='budget-pruned'));
 const diagnostics=sentEvidenceDiagnostics(plan,plan.evidence.slice(0,2));assert.equal(diagnostics.sentFactIds.length+diagnostics.sentSourceIds.length,2);assert.ok(diagnostics.dropped.length>=2);
 const question='CAE 恢复机制怎么实现？不能把 UNKNOWN 当完成。'+('完整约束；'.repeat(300));const ctx=buildInstantContext({question,settings:{aiRules:'用户风格'.repeat(150)},request:{plan:resolution},readyEvidence:{evidence:plan.evidence}}),final=prepareFinalRequest({system:ctx.system,currentSections:ctx.currentSections,evidence:ctx.evidence,maxTokens:400,contextWindow:16384});assert.ok(final.turns.some(t=>t.text.includes(question)));assert.ok(final.evidence.every(e=>final.system.includes(e.text)));
 for(const flags of [{factsEnabled:false,sourcePolicy:'off'},{factsEnabled:true,sourcePolicy:'off'}]){const r=planProjectEvidence({resolution,facts,sources:[source],...flags});assert.equal(r.contextSourceIds.length,0);assert.equal(r.contextFactIds.length>0,flags.factsEnabled);}
 const rejected=planProjectEvidence({resolution:{...resolution,sourceScopes:[]},sources:[source]});assert.ok(rejected.dropped.some(c=>c.reason==='scope-mismatch'));
});

test('E07/E08 original embedded UTF8 hash is optional but checked, USER replaces only active version',()=>{
 const base=fixture(),incoming=fixture(),text='# 原始文本\r\n中文空格  \r\n';incoming.sourceDocuments={[incoming.cards[0].sources[0].path]:text};incoming.cards[0].sources[0].contentSha256=sha(text);assert.doesNotThrow(()=>validateIndex(incoming));
 const wrong=copy(incoming);wrong.sourceDocuments[incoming.cards[0].sources[0].path]=text.trim();assert.throws(()=>validateIndex(wrong),/哈希/);delete wrong.sourceDocuments;assert.doesNotThrow(()=>validateIndex(wrong));
 base.cards[0].status='missing';base.cards[0].text='旧缺口';const merged=mergeFactIndexes(base,incoming).index;assert.equal(merged.cards.filter(c=>c.cardId===base.cards[0].cardId).length,1);assert.ok(!new ProjectFactPacks({index:merged}).select('CAE 项目介绍').evidence.some(e=>e.text.includes('旧缺口')));
});

test('R01-R03 ordered Markdown uses safe lists, non-one starts, continuation, fence and literal version numbers',()=>{
 assert.equal(renderMarkdown('1. 一\n2. 二\n3. 三'),'<ol start="1"><li>一</li><li>二</li><li>三</li></ol>');
 const html=renderMarkdown('3. 三\n\n  续行\n4. 四\n- 切换\n段落版本 1.2.3\n```js\n1. code <img onerror="boom">\n```\n1. <script>alert(1)</script>');
 assert.match(html,/<ol start="3">/);assert.match(html,/<br>续行/);assert.match(html,/<ul><li>切换<\/li><\/ul>/);assert.match(html,/版本 1.2.3/);assert.match(html,/<pre><code>1. code &lt;img/);assert.doesNotMatch(html,/<script>|<img/);
});

test('P03 normalized source identity ambiguity is previewed and requires explicit canonical mapping',async t=>{
 const index=fixture();index.projects[0].aliases.push('shared-name');index.projects[1].aliases.push('shared_name');
 const source={version:2,projects:[{id:'ambiguous-source',name:'Shared Name'}],chunks:[],stats:{}};
 const {service}=setup(t,{legacySource:source});const p=await service.prepareImport({index});assert.deepEqual(p.conflicts[0].candidates,['cae','arclight']);
 await assert.rejects(service.commitImport(p),{code:'ambiguous-project'});
 const result=await service.commitImport({...p,mappings:{'ambiguous-source':'cae'}});assert.deepEqual(result.projects.find(p=>p.id==='cae').sourceScopes,['@project:ambiguous-source']);assert.equal(result.projects.find(p=>p.id==='arclight').sourceScopes.length,0);
});

test('embedded origin retained with keep resolution and legacy migration is lazy after first publication',async t=>{
 const {service,config}=setup(t),base=fixture(),incoming=fixture(),name=base.cards[0].sources[0].path;
 base.sourceDocuments={[name]:'old\r\n'};base.cards[0].sources[0].contentSha256=sha(base.sourceDocuments[name]);incoming.sourceDocuments={[name]:'new\n'};incoming.cards[0].sources[0].contentSha256=sha(incoming.sourceDocuments[name]);
 const kept=mergeFactIndexes(base,incoming,{resolutions:{[base.cards[0].cardId]:'keep'}}).index;assert.equal(kept.sourceDocuments[name],'old\r\n');
 let reads=0;new ProjectMaterialService({...config,legacySource:()=>{reads++;return sourceFixture();}});assert.equal(reads,0);
 assert.ok(Object.isFrozen(service.snapshot.facts));assert.ok(Object.isFrozen(service.snapshot.sources.chunks));
});

test('overview and duration intent keep the primary fact ahead of unrelated implementation supplements',()=>{
 const index=fixture(16);for(const c of index.cards)c.keywords=c.keywords.filter(k=>k!=='时间');index.cards[8].keywords=['时间线','开发周期'];index.cards[8].text='合成开发周期：测试阶段分步推进。';const packs=new ProjectFactPacks({index}),catalog=buildRegistry(index,{projects:[],chunks:[]}).projects;
 for(const [q,required] of [['CAE 项目介绍','cae.synthetic-0'],['用了多久','cae.synthetic-8']]){const resolution=planProjectRetrieval([{channel:'them',text:q}],'say',{catalog,currentProjectId:'cae'});const facts=packs.select(q,{resolution,maxCards:12}).evidence;const plan=planProjectEvidence({question:q,resolution,facts,sourcePolicy:'off'});assert.equal(plan.evidence[0].id,required);}
});

test('facts-only instant referential history uses canonical identity while source scopes remain empty',()=>{
 const catalog=buildRegistry(fixture(),{projects:[],chunks:[]}).projects,memory=new ConversationMemory();const first=memory.begin({mode:'say',question:'CAE 项目介绍',catalog,executionProfile:'instant'});memory.commit(first,'第一点校验输入。第二点检查恢复。');
 const next=memory.begin({mode:'say',question:'刚才第二点为什么这样处理',catalog,executionProfile:'instant'});assert.deepEqual(next.plan.sourceScopes,[]);assert.deepEqual(next.plan.canonicalProjectIds,['cae']);assert.ok(next.turns.some(t=>t.text.includes('旧 AI 建议（非项目事实）')));
 const switched=memory.begin({mode:'say',question:'那 Arclight 呢',catalog,executionProfile:'instant'});assert.equal(switched.turns.length,0);
});

test('replacing all facts preserves canonical identity and mappings of retained source projects',async t=>{
 const {service,config}=setup(t,{legacySource:sourceFixture()});const source=service.snapshot.sourceRevision;
 const incoming=fixture();incoming.projects=incoming.projects.filter(p=>p.id==='arclight');incoming.cards=incoming.cards.filter(c=>c.projectId==='arclight');await importIndex(service,incoming,'replace-all');
 const retained=service.snapshot.registry.projects.find(p=>p.id==='cae');assert.equal(retained.factProjectId,null);assert.deepEqual(retained.sourceScopes,['@project:legacy-cae']);assert.equal(service.snapshot.sourceRevision,source);
 const plan=planProjectRetrieval([{channel:'them',text:'CAE 项目介绍'}],'say',{catalog:service.snapshot.registry.projects});assert.deepEqual(plan.canonicalProjectIds,['cae']);assert.equal(plan.retrieveSources,true);
 assert.deepEqual(new ProjectMaterialService(config).snapshot.registry.projects,service.snapshot.registry.projects);
});
