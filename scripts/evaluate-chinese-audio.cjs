#!/usr/bin/env node
'use strict';
// Public synthetic Mandarin speech only. Exercises the production PCM, VAD,
// cloud ASR and question resolver; no microphone or real interview is used.
const fs=require('node:fs'),path=require('node:path');
const {setTimeout:pause}=require('node:timers/promises');
const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');
const {startAudioCapture,feedWavFixture}=require('./evaluate-audio-fixture.cjs');
const {sanitizeReport}=require('./lib/live-evaluation-report.cjs');
const ROOT=path.resolve(__dirname,'..');
const cases=[
  ['01-context.wav','现在有一个订单系统，高峰期每秒有一万次请求。'],
  ['02-constraint.wav','数据库容量有限，而且不能重复创建订单。'],
  ['03-question.wav','如果服务突然宕机，怎么保证数据可靠，并且如何恢复？']
];
async function run(outputDir=path.join(ROOT,'artifacts/chinese-audio'),env=process.env){
  const key=env.QWEN_ASR_API_KEY||env.QWEN_API_KEY,cleanups=[];
  const report={schemaVersion:1,kind:'synthetic-mandarin-scenario',status:'running',startedAt:new Date().toISOString(),
    scope:'Three separately delivered synthetic Mandarin WAV fragments. Real production PCM/VAD/Qwen ASR and question resolver; no physical audio device or real interview. No live LLM call.',cases:[],checks:{}};
  const save=()=>{fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(sanitizeReport(report,{secrets:[key].filter(Boolean),workspaceRoot:ROOT}),null,2)+'\n');};
  let runtime;
  try {
    if(!key)throw new Error('QWEN_ASR_API_KEY or QWEN_API_KEY is required');
    const {DEFAULT_QWEN_ASR_MODEL}=require('../src/stt-providers/qwen');
    const qwenAsr={apiKey:key,model:env.QWEN_ASR_MODEL||DEFAULT_QWEN_ASR_MODEL,language:'zh',useResume:false,useProjectKnowledge:false,useJobDescription:false,
      ...(env.QWEN_ASR_WEBSOCKET_URL?{websocketUrl:env.QWEN_ASR_WEBSOCKET_URL}:{})};
    runtime=createInterviewRuntime({after:f=>cleanups.push(f)},{liveSpeech:true,inMemorySettings:true,realTime:true,
      settings:{provider:'custom',baseUrl:env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKeys:{custom:key},sttProvider:'qwen',qwenAsr}});
    report.build=runtime.snapshot('redactedDiagnostics().build');report.model=qwenAsr.model;
    await startAudioCapture(runtime);
    for(const [file,expectedText] of cases){
      const row=await feedWavFixture(runtime,{channel:'them',file:path.join(ROOT,'test/fixtures/dual-audio/zh-scenario',file),expectedText,settleMs:5000});
      row.target=runtime.snapshot('questionResolver.resolveForSubmit()');report.cases.push(row);save();
    }
    const recognized=report.cases.map(c=>c.events.map(e=>e.text).join(' '));
    const target=report.cases.at(-1).target;
    const actual=target.text||target.pendingText||'';
    const groups=[['订单',/订单/],['数据库',/数据库/],['重复',/重复/],['宕机',/宕机/],['恢复',/恢复/]];
    report.checks.recognized=Object.fromEntries(groups.map(([name,re])=>[name,re.test(recognized.join(' '))]));
    report.checks.retained=Object.fromEntries(groups.map(([name,re])=>[name,re.test(actual)]));
    report.checks.allSegmentsHaveFinal=report.cases.every(c=>c.passed);
    report.checks.answerable=target.semanticStatus==='answerable';
    report.status=report.checks.allSegmentsHaveFinal&&report.checks.answerable&&Object.values(report.checks.recognized).every(Boolean)&&Object.values(report.checks.retained).every(Boolean)?'passed':'failed';
  }catch(error){report.status='failed';report.error=String(error.message);}
  finally {
    if(runtime&&runtime.snapshot('state.capturing')){await runtime.invoke('capture:toggle').catch(()=>{});await pause(900);}
    for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.message);}
    report.finishedAt=new Date().toISOString();save();
  }
  return report;
}
module.exports={run,cases};
if(require.main===module)run(path.resolve(process.argv[2]||'artifacts/chinese-audio')).then(r=>{console.log(JSON.stringify({status:r.status,checks:r.checks,error:r.error}));process.exitCode=r.status==='passed'?0:1;}).catch(()=>{process.stderr.write('Chinese audio evaluation failed.\n');process.exitCode=1;});
