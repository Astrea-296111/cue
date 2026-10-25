'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createInterviewRuntime}=require('./helpers/interview-agent-runtime');
const {fixture}=require('./helpers/material-fixture');
const {migrateMaterialSettings}=(()=>{const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');const file=path.resolve(__dirname,'../src/store.js'),native=createRequire(file),m={exports:{}};vm.runInThisContext('(function(require,module){'+fs.readFileSync(file,'utf8')+'\n})')(id=>id==='electron'?{app:{getPath:()=>'/tmp'}}:native(id),m);return m.exports;})();
async function install(r,index=fixture()){const p=await r.invoke('materials:prepare',{index,mode:'replace-all'});return r.invoke('materials:commit',p);}
for(const mode of ['instant','standard'])test(`E01-E03/Q01 actual ${mode} SDK sees facts with source RAG off and independent switches`,async t=>{
 const r=createInterviewRuntime(t,{chunks:[],settings:{realtimeAnswerMode:mode,sourceRagPolicies:{instant:'off',standard:'off'},manualProjectKnowledgeEnabled:false}});await install(r);
 for(const question of ['CAE 项目介绍','你们几个人','你负责哪块'])await r.ask('say',question);
 const team=r.calls[1].messages[0].content,ownership=r.calls[2].messages[0].content;assert.match(team,/cae collaboration/);assert.match(ownership,/cae ownership/);assert.doesNotMatch(team,/arclight/);
 assert.equal(r.searches.length,0);assert.equal(r.snapshot('ragSession.metrics.started'),0);
 let d=r.events.filter(e=>e.channel==='llm:materials').at(-1);assert.ok(d.sentFactIds.length);assert.equal(d.sentSourceIds.length,0);assert.ok(d.reasons.includes('source-rag-off'));assert.ok(d.generation);
 await r.invoke('settings:set',{projectFactsEnabled:false});await r.ask('say','CAE 你们几个人');d=r.events.filter(e=>e.channel==='llm:materials').at(-1);assert.equal(d.sentFactIds.length,0);assert.ok(d.reasons.includes('facts-disabled'));assert.doesNotMatch(r.calls.at(-1).messages[0].content,/合成资料/);
 await r.invoke('settings:set',{projectFactsEnabled:true});await r.ask('say','那 Arclight 呢');await r.ask('say','是你一个人做的吗');assert.match(r.calls.at(-1).messages[0].content,/arclight collaboration/);assert.doesNotMatch(r.calls.at(-1).messages[0].content,/cae collaboration/);
});

test('C01/C02 successful commit aborts old stream; failed preview leaves active generation usable',async t=>{
 const r=createInterviewRuntime(t,{chunks:[],settings:{realtimeAnswerMode:'instant',sourceRagPolicies:{instant:'off'}}});await install(r);
 let release;const gate=new Promise(resolve=>{release=resolve;});r.behavior(async()=> (async function*(){await gate;yield {choices:[{delta:{content:'旧版本迟到正文'},finish_reason:'stop'}]};})());
 const old=r.ask('say','CAE 团队几个人');await r.waitForCalls(1);const generation=r.snapshot('materialService.snapshot.generation');
 await assert.rejects(r.invoke('materials:prepare',{index:{schemaVersion:9}}));assert.equal(r.requestOptions[0].signal.aborted,false);assert.equal(r.snapshot('materialService.snapshot.generation'),generation);
 const next=fixture();next.cards[2].text='新版合成协作内容';await install(r,next);assert.equal(r.requestOptions[0].signal.aborted,true);release();await old;assert.ok(!r.events.some(e=>e.channel==='llm:token'&&e.text.includes('旧版本迟到')));
 r.answer('新一轮正文');await r.ask('say','CAE 团队几个人');assert.match(r.calls.at(-1).messages[0].content,/新版合成协作内容/);assert.notEqual(r.events.filter(e=>e.channel==='llm:materials').at(-1).generation,generation);
});

test('M02 material setting migration preserves off and explicit false across restart without repeating notice',()=>{
 const migrated=migrateMaterialSettings({instantRagPolicy:'off'});assert.equal(migrated.sourceRagPolicies.instant,'off');assert.equal(migrated.projectFactsEnabled,true);assert.equal(migrated.sourceRagPolicies.standard,'standard');assert.equal(migrated.projectMaterialMigrationNotice,true);
 const next=migrateMaterialSettings({...migrated,projectFactsEnabled:false,projectMaterialMigrationNotice:false});assert.equal(next.projectFactsEnabled,false);assert.equal(next.projectMaterialMigrationNotice,false);
});

for(const mode of ['standard','instant'])test(`E04 ${mode} final SDK retains implementation source among fact candidates`,async t=>{
 const index={version:2,projects:[{id:'cae-code',name:'cae-job-platform',stats:{fileCount:1,chunkCount:1}}],chunks:[{id:'restore-source',projectId:'cae-code',projectName:'CAE',path:'src/restore.js',startLine:1,endLine:1,docType:'implementation',truthScope:'implemented',status:'confirmed',text:'SOURCE_RESTORE 恢复机制通过幂等状态机处理重试；function restore(){ return state.compareAndSet(); }'}],stats:{fileCount:1,chunkCount:1}};
 const r=createInterviewRuntime(t,{indexSnapshot:index,settings:{realtimeAnswerMode:'standard',sourceRagPolicies:{instant:'ready-only',standard:'standard'}}});await install(r,fixture(16));await r.exports('src/project-knowledge.js').warmProjectIndex();
 await r.ask('say','CAE 恢复机制如何实现');if(mode==='instant'){await r.invoke('settings:set',{realtimeAnswerMode:'instant'});await r.ask('say','CAE 恢复机制如何实现');}
 const body=r.calls.at(-1).messages[0].content,diagnostic=r.events.filter(e=>e.channel==='llm:materials').at(-1);assert.match(body,/SOURCE_RESTORE/);assert.match(body,/合成资料 cae implementation/);assert.ok(diagnostic.sentFactIds.length);assert.ok(diagnostic.sentSourceIds.includes('restore-source'));
});

test('warm facts request performs no filesystem reads on the answer key path',async t=>{
 const r=createInterviewRuntime(t,{chunks:[],settings:{realtimeAnswerMode:'instant',sourceRagPolicies:{instant:'off'},manualProjectKnowledgeEnabled:false}});await install(r);await r.ask('say','CAE 项目介绍');
 const fs=require('node:fs'),original=fs.readFileSync,reads=[];fs.readFileSync=function(...args){reads.push(String(args[0]));return original.apply(this,args);};
 try{await r.ask('say','你们几个人');}finally{fs.readFileSync=original;}
 assert.deepEqual(reads,[]);
});

test('technical recovery answers retain the original state-changing body rather than a matching class declaration',async t=>{
  const source={version:2,projects:[{id:'cae-code',name:'cae-job-platform'},{id:'arc-code',name:'Arclight'}],chunks:[
    {id:'queue-header',projectId:'cae-code',path:'src/Queue.java',symbol:'Queue',kind:'context',startLine:1,endLine:3,text:'public class Queue { private String recoveryStatus; private String retryStatus; }'},
    {id:'queue-claim',projectId:'cae-code',path:'src/Queue.java',symbol:'Queue#claim',kind:'method',startLine:4,endLine:9,text:'Claim claim(Row row) { if (row.state.equals("DONE")) return DONE; if (row.leased) return BUSY; return ACQUIRED; }'},
    {id:'foreign-queue',projectId:'arc-code',path:'src/Queue.java',symbol:'Queue#claim',kind:'method',startLine:1,endLine:4,text:'Claim claim() { return FOREIGN_QUEUE_ONLY; }'}],stats:{fileCount:2,chunkCount:3}};
  for(const mode of ['instant','standard']) {
    const app=createInterviewRuntime(t,{indexSnapshot:source,settings:{realtimeAnswerMode:mode,sourceRagPolicies:{instant:'ready-only',standard:'standard'}}});
    const facts=fixture(8),card=facts.cards.find(c=>c.projectId==='cae'&&c.docType==='implementation');
    card.text='合成 Queue 恢复机制按状态与租约区分重试。';card.keywords=['Queue','恢复','状态','重试'];
    card.sources=[{path:'src/Queue.java',symbol:'Queue#claim',commit:null,contentSha256:'a'.repeat(64)}];
    await install(app,facts);await app.exports('src/project-knowledge.js').warmProjectIndex();
    await app.ask('say','CAE Queue 恢复状态如何区分已完成与正在处理？');
    const body=JSON.stringify(app.calls.at(-1).messages),diagnostic=app.events.filter(e=>e.channel==='llm:materials').at(-1);
    assert.match(body,/DONE/);assert.match(body,/BUSY/);assert.match(body,/ACQUIRED/);
    assert.ok(diagnostic.sentSourceIds.includes('queue-claim'));
    assert.ok(!diagnostic.sentSourceIds.includes('queue-header'));
    assert.doesNotMatch(body,/FOREIGN_QUEUE_ONLY/);
  }
});

test('manual project toggle remains independent for a facts-only canonical project in standard mode',async t=>{
 const r=createInterviewRuntime(t,{chunks:[],settings:{realtimeAnswerMode:'standard',projectFactsEnabled:false,sourceRagPolicies:{standard:'off'},projectKnowledge:'# CAE\n\nMANUAL_CANONICAL 我负责合成恢复校验；源码未导入，不能声称已检索源码。'}});await install(r);
 await r.ask('say','CAE 你负责什么');assert.match(r.calls.at(-1).messages[0].content,/MANUAL_CANONICAL/);assert.equal(r.searches.length,0);
 await r.invoke('settings:set',{manualProjectKnowledgeEnabled:false});await r.ask('say','CAE 你负责什么');assert.doesNotMatch(r.calls.at(-1).messages[0].content,/MANUAL_CANONICAL/);assert.equal(r.searches.length,0);
});
