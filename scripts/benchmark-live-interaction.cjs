#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const {compile}=require('../src/qa-import');
const {QAIndex}=require('../src/qa-index');
const {QuestionResolver}=require('../src/question-resolver');
const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');
const {classify}=require('../src/screen-task-router');
const topics=['持久化快照','输入版本','幂等身份','故障恢复','执行租约','资源限额','取消请求','状态回查','消息确认','超时控制','只读权限','参数校验','重复关联','空值处理','时间范围','单位换算','聚合粒度','错误回传','任务重试','结果校验'];
function library(){return {format:'cue-qa/v1',projects:[{id:'cedar',name:'杉木平台',aliases:['Cedar'],kind:'knowledge'}],items:Array.from({length:1000},(_,i)=>({
 id:`qa.cedar.case-${i}`,projectId:'cedar',question:`第${i}类任务的${topics[i%20]}如何保证并发请求的数据一致性？`,aliases:[],
 answerShort:`这是合成设计建议。第${i}类任务先固定${topics[i%20]}的输入契约，再通过受控并发测试验证一致性。`,sourceType:'general_knowledge',delivery:'prefer_verbatim',enabled:true,applicableVersion:'synthetic-v1'}))};}
function heldout(){return topics.flatMap((topic,offset)=>{const i=100+offset;const q=`第${i}类任务的${topic}如何保证并发请求的数据一致性`;return [
 {id:`p-${i}-a`,question:'麻烦讲讲'+q+'？',expected:`qa.cedar.case-${i}`},
 {id:`p-${i}-b`,question:q.replace('如何','怎么')+'呢？',expected:`qa.cedar.case-${i}`},
 {id:`n-${i}-neg`,question:q.replace('如何保证','如何不保证')+'？',expected:null},
 {id:`n-${i}-multi`,question:q+'？失败后如何退避并补偿另一个任务？',expected:null},
 {id:`n-${i}-num`,question:q.replace(`第${i}类`,`第${i+2000}类`)+'？',expected:null}];});}
function stats(values){const x=[...values].sort((a,b)=>a-b);return {count:x.length,p50:x[Math.ceil(x.length*.5)-1],p95:x[Math.ceil(x.length*.95)-1],max:x.at(-1)};}
async function run(output=path.resolve('artifacts/live-interaction-offline')){
 fs.mkdirSync(output,{recursive:true});const root=path.resolve(__dirname,'..');
 const source=library(), start=performance.now(),index=compile(JSON.stringify(source)),prepared=new QAIndex(index,'synthetic');
 const prepareMs=performance.now()-start,cases=heldout();
 fs.writeFileSync(path.join(output,'heldout.json'),JSON.stringify(cases,null,2));
 const rows=cases.map(c=>({...c,...prepared.match(c.question,{projectId:'cedar'})}));
 const direct=rows.filter(r=>r.direct),correct=direct.filter(r=>r.expected===r.cardId),positive=rows.filter(r=>r.expected),matched=positive.filter(r=>r.direct&&r.cardId===r.expected);
 const qa={samples:rows.length,positives:positive.length,negatives:rows.length-positive.length,precision:correct.length/Math.max(1,direct.length),recall:matched.length/positive.length,
 coverage:direct.length/rows.length,rejectionRate:1-direct.length/rows.length,threshold:{score:0.9,margin:0.15,interpretation:'lexical gate, not probability'},rows};
 const cleanups=[],app=createInterviewRuntime({after:f=>cleanups.push(f)},{chunks:[],settings:{apiKeys:{custom:''},saveInterviewTranscript:false}});
 let mainTimings=[],diagnostic;
 try{await app.ready;const p=await app.invoke('qa:prepare',{text:JSON.stringify(source)});await app.invoke('qa:commit',p);
   for(let i=0;i<100;i++){const t=performance.now();await app.ask('say','杉木平台'+source.items[i].question);mainTimings.push(performance.now()-t);}
   diagnostic=app.snapshot('redactedDiagnostics()');
   if(app.calls.length!==0)throw new Error('Verbatim benchmark made model requests');
 }finally{for(const fn of cleanups.reverse())await fn();}
 const targetTimes=[];for(let i=0;i<1000;i++){const r=new QuestionResolver();r.observe({channel:'them',text:'如何保证并发任务不重复创建？',utteranceKey:'u'},false);const t=performance.now();r.resolveForSubmit();targetTimes.push(performance.now()-t);}
 const routeCases=[['algorithm','算法题，旁边有 AI 聊天栏'],['sql','只写一条 SQL'],['debug','修复当前报错'],['vibe-coding','与 AI 协作实现 NL2SQL 应用'],['unknown','只看到 IDE']];
 const confusion={};for(const [expected,text]of routeCases){const got=classify(text);(confusion[expected]||={})[got]=((confusion[expected]||{})[got]||0)+1;}
 const report={schemaVersion:1,buildCommit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),codeSha256:require('./eval-public.cjs').sourceIdentity(root),sourceDirty:diagnostic.build.sourceDirty,
 scope:'100 heldout synthetic paraphrase/negative variants on card IDs 100–119; development used 0–19. Template-based, not a human interview generalization estimate. Synthetic authored text/screens. Actual main/SDK spy; model and OS transport mocked. Hot OS file cache. No original audio or Windows hardware claim.',
 environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model,cpuCount:os.cpus().length,totalMemory:os.totalmem()},
 prepare1000CardsMs:prepareMs,localTargetSelectionMs:stats(targetTimes),qaHotMainToDeliveryMs:stats(mainTimings),modelCalls:0,qa,localExplicitRequirementRouting:confusion};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'diagnostic.json'),JSON.stringify(diagnostic,null,2));
 console.log(JSON.stringify({precision:qa.precision,recall:qa.recall,coverage:qa.coverage,qaP95:report.qaHotMainToDeliveryMs.p95,modelCalls:0}));return report;
}
module.exports={library,heldout,run};if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
