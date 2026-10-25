'use strict';

// Fixed public PCM fixtures enter the same production capture, ASR, question
// resolver and SDK path. Private material and complete replies stay encrypted.
const path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');
const {providerConfig,createBudget,createProviderRuntime,runCase,buildIdentity}=require('./e2e-live-llm.cjs');
const {importMaterials,validateEvaluation}=require('./evaluate-multiturn-projects.cjs');
const {startAudioCapture,feedWavFixture}=require('./evaluate-audio-fixture.cjs');
const {writeReports,sanitizeText}=require('./lib/live-evaluation-report.cjs');
const {evaluateMultiturnCase}=require('./lib/multiturn-quality.cjs');
const ROOT=path.resolve(__dirname,'..'),sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function evaluateAudioProjects({payload,outputDir,env=process.env,provider='all',mock=false}) {
  const config=validateEvaluation(payload.evaluation||{});
  if(!config.audioFixture||mock)throw new Error('Full audio evaluation requires explicit live ASR and current application.');
  const ids=provider==='all'?['qwen','deepseek']:[provider];
  if(ids.some(id=>!['qwen','deepseek'].includes(id)))throw new Error('Invalid audio answer provider.');
  const options={mock:false,liveSpeech:true,outputDir,maxCalls:ids.length*2,maxCallsPerProvider:2,maxOutputTokens:16384,firstContentTimeoutMs:120000,totalTimeoutMs:120000};
  const budget=createBudget(options,ids),asrKey=env.QWEN_ASR_API_KEY||env.QWEN_API_KEY;
  const secrets=[env.QWEN_API_KEY,env.DEEPSEEK_API_KEY,asrKey].filter(Boolean),temps=[];
  const bundle=require('./evaluate-private-projects.cjs').loadTrustedSources();
  const report={schemaVersion:2,kind:'live',mode:'audio-fixture',status:'running',startedAt:new Date().toISOString(),finishedAt:null,
    build:buildIdentity(env),application:{commit:buildIdentity(env).commit,kind:'trusted-current'},
    inputs:{factsSha256:sha(payload.facts),profileSha256:sha(payload.profile),materialRevision:payload.revision,sourceRevision:bundle.revision,
      ...(payload.judgeReference?{judgeReferenceSha256:payload.judgeReference.sha256,judgeReferenceRevision:payload.judgeReference.revision}:{})},
    providers:ids.map(id=>({id,status:'running',attemptedCalls:0,cases:[],audio:[]})),failures:[],
    evaluation:{audioFixture:true,expectedQuestionCount:ids.length*2,repeats:1,shardCount:1},
    measurementLimits:{physicalMicrophone:false,physicalLoopback:false,physicalRendering:false,
      input:'Public synthetic PCM; real production VAD, ASR, ledger, recognized-question shortcut and text-model SDK. Software timestamps do not establish acoustic or pixel latency.'}};
  const save=()=>{report.budget=budget.snapshot();return writeReports(report,{outputDir,sanitize:{secrets,workspaceRoot:ROOT,tempRoots:temps}});};
  save();
  for(const p of report.providers) {
    const cleanups=[];let runtime;
    try {
      const text=providerConfig(p.id,env,false);if(text.error)throw new Error(text.error.code);
      if(!asrKey)throw new Error('Real ASR key is not configured.');p.model=text.model;
      runtime=createProviderRuntime({id:p.id,config:text,options,budget,provider:p,cleanups});temps.push(runtime.temp);await runtime.ready;
      p.materialImport=await importMaterials(runtime,payload,bundle);
      if(payload.profile.jobProfiles?.some(job=>job.id==='java_security'))await runtime.invoke('materials:personal:job',{jobProfileId:'java_security'});
      const {DEFAULT_QWEN_ASR_MODEL}=require('../src/stt-providers/qwen');
      await runtime.invoke('settings:set',{currentProjectId:'cae',sttProvider:'qwen',baseUrl:env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',
        qwenAsr:{apiKey:asrKey,model:env.QWEN_ASR_MODEL||DEFAULT_QWEN_ASR_MODEL,language:'en',useResume:false,useJobDescription:false,useProjectKnowledge:false,
          ...(env.QWEN_ASR_WEBSOCKET_URL?{websocketUrl:env.QWEN_ASR_WEBSOCKET_URL}:{})}});
      runtime.clear();await startAudioCapture(runtime);
      for(const [channel,file,expectedText] of [['them','interviewer.wav','How do you prevent duplicate task execution?'],
        ['you','candidate.wav','I said Kafka. I meant Rabbit M Q.'],['them','followup.wav','How do you handle retries after a timeout?']]) {
        const observation=await feedWavFixture(runtime,{channel,file:path.join(ROOT,'test/fixtures/dual-audio',file),expectedText});p.audio.push(observation);save();
        if(!observation.passed)throw new Error('ASR fixture did not establish a complete correctly attributed final.');
        if(channel==='you')continue;
        const target=(await runtime.invoke('question:get-target')).snapshot;
        if(!target?.text||!observation.events.some(event=>target.text.includes(event.text)||event.text.includes(target.text)))throw new Error('Recognized question target differs from the ASR final.');
        const dialogue=await runtime.invoke('dialogue:snapshot');
        const event={evaluation:{expected_route:'cae',must_convey:['直接回答当前问题，区分消息重投与执行副作用去重。'],
          must_not_assert:['把分区、确认或唯一键夸大为无条件全链路恰好一次。'],supporting_card_ids:['cae-05','cae-07']}};
        const item={id:'audio-'+p.id+'-'+p.cases.length,sessionId:dialogue.sessionId,mode:'instant',question:target.text,category:'audio-fixture',
          sourcePolicy:'ready-only',factsEnabled:true,eventAlreadyPublished:true,trigger:'recognized-shortcut'};
        const finalToTriggerMs=Date.now()-observation.lastFinalReceivedAt;
        const result=await runCase(runtime,item,p,options,budget,args=>evaluateMultiturnCase({...args,event,scenarioEvaluation:event.evaluation,dialogueEvents:dialogue.events}));
        const sent=new Set(result.sentSourceIds||[]);
        p.cases.push({...result,repeat:1,jobProfile:'java_security',scenarioEvaluation:event.evaluation,dialogueEvents:dialogue.events,
          tags:p.cases.length?['audio-fixture','active-correction']:['audio-fixture'],recognizedQuestion:target,
          audio:{fixture:file,eventIds:observation.events.map(e=>e.eventId),pcmFeedEndToLastFinalMs:observation.pcmFeedEndToLastFinalMs,finalToTriggerMs},
          metrics:{...result.metrics,audioEndToFinalMs:observation.pcmFeedEndToLastFinalMs},
          authoritativeSources:bundle.sources.chunks.filter(c=>sent.has(c.id)).map(c=>({id:c.id,projectId:c.projectId,path:c.path,text:c.text,
            commit:bundle.sources.projects.find(project=>project.id===c.projectId)?.sourceRevision||null}))});
        if(result.error)report.failures.push({provider:p.id,caseId:item.id,...result.error});save();
      }
      p.ledger=await runtime.invoke('dialogue:snapshot');
      p.status=p.cases.length===2&&p.cases.every(c=>c.transportStatus==='passed')?'passed':'failed';
    }catch(error){p.status='failed';report.failures.push({provider:p.id,code:'audio-chain',message:sanitizeText(error.message,{secrets,workspaceRoot:ROOT,tempRoots:temps})});}
    finally {
      if(runtime?.snapshot('state.capturing')){await runtime.invoke('capture:toggle').catch(()=>{});await pause(900);}
      for(const cleanup of cleanups.reverse())await cleanup();save();
    }
  }
  report.status=report.providers.every(p=>p.status==='passed')&&!report.failures.length?'passed':'failed';report.generationFinishedAt=new Date().toISOString();
  let document=save();
  if(config.judge) {
    document=await require('./judge-private-projects.cjs').evaluateJudges({report:document,payload,env,outputDir,concurrency:1,
      onCheckpoint:value=>{Object.assign(report,{providers:value.providers,judging:value.judging,manualReview:value.manualReview,status:value.status,inputs:value.inputs});save();}});
    Object.assign(report,document);
  }
  report.finishedAt=new Date().toISOString();return save();
}
module.exports={evaluateAudioProjects};
