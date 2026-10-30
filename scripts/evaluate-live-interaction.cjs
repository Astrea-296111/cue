#!/usr/bin/env node
'use strict';
// Only authored synthetic questions/screens. Production main and adapters remain
// unchanged; OS capture is replaced with the supplied PNG, SDK transport is real.
const fs=require('fs'),path=require('path');
const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');
const {providerConfig}=require('./e2e-live-llm.cjs');
const {sanitizeReport}=require('./lib/live-evaluation-report.cjs');
const ROOT=path.resolve(__dirname,'..');
async function run(output=path.resolve('artifacts/oct27-live'),env=process.env){
 fs.mkdirSync(output,{recursive:true});const secrets=[env.QWEN_API_KEY,env.DEEPSEEK_API_KEY].filter(Boolean);
 const report={schemaVersion:1,buildCommit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),
  scope:'Real model SDK; synthetic interviewer interim and screenshots; no physical keyboard/audio/screen capture claim. No generation retries or model judge.',providers:[],rows:[],status:'running'};
 const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(sanitizeReport(report,{secrets,workspaceRoot:ROOT}),null,2));
 let calls=0;
 for(const id of ['qwen','deepseek']){
  const config=providerConfig(id,env,false);if(config.error){report.providers.push({id,status:'unavailable',error:config.error});save();continue;}
  const actual=id==='qwen'?'custom':'deepseek';report.providers.push({id,model:config.model,endpointHost:config.hostname});
  for(const c of [{id:'interim',mode:'say',question:'同一个任务的重复请求怎样避免创建两条记录？',interim:true},
    {id:'qa-miss',mode:'say',question:'解释 SQL 聚合时为什么需要先确定分组粒度？'},
    {id:'question-lifecycle',mode:'say',question:'Redis 出现故障时怎么保护数据库？',lifecycle:true},
    ...['vibe','algorithm','sql','debug','unknown'].map(name=>({id:name,mode:name==='algorithm'?'leetcode':'assist',question:'',image:name+'.png'}))]) {
   const cleanups=[];let app;const row={provider:id,caseId:c.id,requestedModel:config.model,attempts:0,status:'running'};report.rows.push(row);save();
   try{
    app=createInterviewRuntime({after:f=>cleanups.push(f)},{realTime:true,inMemorySettings:true,chunks:[],
     screenImagePath:c.image?path.join(ROOT,'test/fixtures/live-interaction',c.image):undefined,
     settings:{provider:actual,apiKeys:{[actual]:config.apiKey},models:{[actual]:{fast:config.model,smart:config.model}},
      baseUrl:config.baseURL,deepseekBaseUrl:config.baseURL,realtimeAnswerMode:'instant',firstContentDeadlineMs:6000,saveInterviewTranscript:false,
      providerProtocolPresets:{[actual]:id==='qwen'?'dashscope':'deepseek'},instantProviderOptions:{[actual]:id==='qwen'?{enable_thinking:false}:{thinking:{type:'disabled'}}}},
     liveTransport:{maxOutputTokens:8000,totalTimeoutMs:120000,firstContentTimeoutMs:30000,onAttempt:()=>{if(++calls>20)throw new Error('Live call cap exceeded');row.attempts++;save();}}});
    await app.ready;
    if(c.lifecycle){app.final('请做一下自我介绍。');app.candidate('我目前是计算机专业研究生，主要研究分布式系统。');
      app.final(c.question);await app.ask(c.mode);}
    else if(c.interim){app.interim(c.question,{utteranceKey:'synthetic-early',revision:1});app.candidate('嗯，我想一下');await app.ask(c.mode);}
    else await app.ask(c.mode,c.question);
    row.requests=app.calls.map(body=>({...body,messages:body.messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map(part=>part.type==='image_url'?{type:'image_fixture',path:'test/fixtures/live-interaction/'+c.image}:part):m.content}))}));
    row.answer=app.events.filter(e=>e.channel==='llm:token').map(e=>e.text).join('');
    row.diagnostic=app.snapshot('redactedDiagnostics().lastActualRequest');
    row.metrics=app.events.filter(e=>e.channel==='llm:metrics').at(-1)||row.diagnostic?.metrics;
    row.error=app.events.findLast(e=>e.channel==='llm:error')?.message||null;
    row.servedModels=[...new Set(app.providerChunks.map(p=>p.model).filter(Boolean))];
    row.rawOutput=app.providerChunks.map(p=>p.choices?.[0]?.delta?.content||'').join('');
    row.usage=app.providerChunks.filter(p=>p.usage).map(p=>p.usage);
    row.asrFinal=app.snapshot('lastFrozenSnapshot?.asrFinal');
    if(c.image&&id==='deepseek')row.status=row.attempts===0&&/视觉/.test(row.error||'')?'unsupported-vision':'failed';
    else if(c.image){const expected=c.id==='vibe'?'vibe-coding':c.id;row.expectedType=expected;row.actualType=row.diagnostic?.screen?.type;
      row.status=row.attempts===1&&row.actualType===expected&&row.answer.trim()&&!row.error&&!row.diagnostic?.truncated?'needs-human-review':'failed';}
    else {row.targetCorrect=!c.lifecycle||app.snapshot('lastFrozenSnapshot?.text')===c.question.normalize('NFKC') && !JSON.stringify(row.requests).includes('自我介绍');
      row.status=row.attempts===1&&row.answer.trim()&&!row.error&&row.targetCorrect&&(!c.interim||row.asrFinal===false)?'needs-human-review':'failed';}
   }catch(e){row.status='failed';row.error=String(e.message);}finally{for(const cleanup of cleanups.reverse())await cleanup();save();}
  }
 }
 report.calls=calls;report.finishedAt=new Date().toISOString();report.status=report.rows.some(r=>r.status==='failed')||report.providers.some(p=>p.status==='unavailable')?'failed':'completed-needs-human-review';save();
 console.log(JSON.stringify({status:report.status,calls,rows:report.rows.map(r=>({provider:r.provider,caseId:r.caseId,status:r.status,attempts:r.attempts}))}));return report;
}
module.exports={run};if(require.main===module)run(process.argv[2]).then(r=>{process.exitCode=r.status==='failed'?1:0;}).catch(e=>{console.error('Synthetic live evaluation failed:',e.message);process.exitCode=1;});
