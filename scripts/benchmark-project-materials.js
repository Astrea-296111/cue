#!/usr/bin/env node
'use strict';
// Offline rotating-question benchmark. Private inputs are read locally; output contains timings and IDs only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const {ProjectFactPacks,validateIndex}=require('../src/project-fact-packs');
const {buildRegistry}=require('../src/project-registry');
const {planProjectRetrieval}=require('../src/project-query');
const {planProjectEvidence}=require('../src/project-evidence-policy');
const {buildInstantContext}=require('../src/instant-answer-context');
const {prepareFinalRequest}=require('../src/final-request-budget');
const {ProjectMaterialService}=require('../src/project-material-service');
const {fixture,sourceFixture}=require('../test/helpers/material-fixture');
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
const privatePath=args.includes('--facts')?arg('--facts'):null,iterations=Math.max(1000,Number(arg('--iterations'))||1000);
const bundled=new ProjectFactPacks().getIndex(),privateFacts=privatePath?validateIndex(JSON.parse(fs.readFileSync(privatePath,'utf8'))):fixture(109);
const baseQuestions=['CAE 项目介绍','你们几个人','你负责哪块','用了多久','CAE 恢复机制如何实现','不是 CAE，是 Arclight','是你一个人做的吗','Arclight 时间线是什么','Redis 过期策略是什么','只有五种吗','回到刚才那个项目','比较 CAE 和 Arclight 的实现','那你们几个人','介绍星河项目','Arclight 项目难点是什么','CAE 回调接口有什么竞态','CAE 测试指标和环境','Arclight 什么是新的设计','CAE 为什么这么拆','Arclight 负责哪些模块'];
const tails=['','？请保持简短。','？请说明限制。','？按两点说明。','？给出具体原因。'];
const questions=tails.flatMap(tail=>baseQuestions.map(q=>q+tail));assert.equal(new Set(questions).size,100);
const percentile=rows=>{const a=[...rows].sort((a,b)=>a-b);return {p50Ms:+a[Math.floor(a.length*.5)].toFixed(4),p95Ms:+a[Math.floor(a.length*.95)].toFixed(4)};};
function baselineClass(ref){const file=path.resolve(__dirname,'../src/project-fact-packs.js'),m={exports:{}},native=createRequire(file);const code=execFileSync('git',['show',ref+':src/project-fact-packs.js'],{cwd:path.dirname(__dirname),encoding:'utf8'});vm.runInThisContext('(function(require,module,exports,__dirname){'+code+'\n})')(native,m,m.exports,path.dirname(file));return m.exports.ProjectFactPacks;}
const ref=args.includes('--baseline-ref')?arg('--baseline-ref'):'1852c165abc7f8cda4f1f523e7374355ad27aee6',Baseline=baselineClass(ref);
function run(index,name){
 const at=performance.now(),packs=new ProjectFactPacks({index}),catalog=buildRegistry(packs.getIndex(),sourceFixture()).projects,coldPrepareMs=performance.now()-at;
 const legacy=new Baseline({index}),baseline=[],parse=[],select=[],evidence=[],context=[],total=[],dispatch=[];
 let prior=null,misses=0,sent=0;
 for(let i=0;i<iterations+100;i++){
  const q=questions[i%100],measure=i>=100;const start=performance.now();
  const resolution=planProjectRetrieval([{channel:'them',text:q}],'say',{catalog,previousPlan:prior,currentProjectId:'cae'});prior=resolution;
  const parsed=performance.now();const selected=packs.select(q,{resolution,maxCards:12});const picked=performance.now();
  const sources=i%2?[{...sourceFixture().chunks[0],sourceType:'imported',docType:'implementation',truthScope:'implemented',status:'confirmed'}]:[];
  const planned=planProjectEvidence({question:q,resolution,facts:selected.evidence,sources});const arranged=performance.now();
  const built=buildInstantContext({question:q,settings:{},request:{plan:resolution},readyEvidence:planned});const assembled=performance.now();
  const final=prepareFinalRequest({system:built.system,currentSections:built.currentSections,evidence:built.evidence,maxTokens:400,contextWindow:16384});const done=performance.now();
  const before=performance.now();const old=legacy.select(q,{projectId:resolution.canonicalProjectIds[0],maxCards:4});const after=performance.now();
  if(measure){parse.push(parsed-start);select.push(picked-parsed);evidence.push(arranged-picked);context.push(assembled-arranged);total.push(assembled-start);dispatch.push(done-start);baseline.push(after-before);if(resolution.retrieveFacts&&!old.evidence.length)misses++;sent+=final.evidence.length;}
 }
 return {name,cards:index.cards.length,longCards:index.cards.filter(c=>c.text.length>1200).length,iterations,questions:100,sourceAlternates:true,coldPrepareMs:+coldPrepareMs.toFixed(3),resolve:percentile(parse),factSelect:percentile(select),evidence:percentile(evidence),context:percentile(context),resolveThroughContext:percentile(total),localPrepareThroughFinalBudget:percentile(dispatch),baselineFactSelect:percentile(baseline),baselineEmptyOnResolvedProject:misses,sentEvidenceTotal:sent,targetP95Ms:10,meetsTarget:percentile(total).p95Ms<=10};
}
async function main(){
 const longIndex=fixture(160);for(let i=0;i<longIndex.cards.length;i+=7)longIndex.cards[i].text=(longIndex.cards[i].text+'长卡用于验证整张跳过与补位。'.repeat(150)).slice(0,1750);
 const report={node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTree:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()?'modified':'clean',baselineRef:ref,privateFactsUsed:!!privatePath,scenarios:[run(bundled,'bundled-25'),run(privateFacts,privatePath?'local-private-109':'synthetic-109'),run(longIndex,'synthetic-160')],limitations:['All timings are offline; no network/model latency is represented.','Baseline fact selector uses the same input and question rotation, but cannot inherit every short followup.']};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cue-material-bench-'));
 try{let t=performance.now();const svc=new ProjectMaterialService({directory:dir,bundled});report.migrationMs=performance.now()-t;t=performance.now();const p=await svc.prepareImport({index:privateFacts});report.importPrepareMs=performance.now()-t;t=performance.now();await svc.commitImport(p);report.importCommitMs=performance.now()-t;t=performance.now();const restart=new ProjectMaterialService({directory:dir,bundled});report.restartMs=performance.now()-t;assert.equal(restart.snapshot.facts.cards.length,privateFacts.cards.length);report.privateAcceptance={cardCount:restart.snapshot.facts.cards.length,projects:restart.snapshot.registry.projects.map(p=>p.id),embeddedDocuments:Object.keys(privateFacts.sourceDocuments||{}).length};}finally{fs.rmSync(dir,{recursive:true,force:true});}
 if(args.includes('--pipeline')){const cleanup=[];const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');const runtime=createInterviewRuntime({after:fn=>cleanup.push(fn)},{chunks:[],settings:{realtimeAnswerMode:'instant',sourceRagPolicies:{instant:'off'},projectFactsEnabled:true}});try{const p=await runtime.invoke('materials:prepare',{index:privateFacts,mode:'replace-all'});await runtime.invoke('materials:commit',p);for(const q of questions)await runtime.ask('say',q);const metrics=runtime.events.filter(e=>e.channel==='llm:metrics'&&Number.isFinite(e.triggerToDispatchMs));const byRequest=new Map(metrics.map(e=>[e.requestId,e.triggerToDispatchMs]));report.mockPipeline={requests:runtime.calls.length,triggerToDispatch:percentile([...byRequest.values()]),firstContent:'stream mock; not real LLM timing',sourceSearchCalls:runtime.searches.length};}finally{for(const fn of cleanup)await fn();}}
 if(args.includes('--output'))fs.writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.code||error.name,error.message);process.exitCode=1;});
