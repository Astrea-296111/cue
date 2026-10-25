#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {setTimeout:pause}=require('node:timers/promises');
const {resolveProfile,buildTasks}=require('./lib/evaluation-profiles.cjs');
const {providerConfig,createBudget,createProviderRuntime,runCase,buildIdentity,codePositions}=require('./e2e-live-llm.cjs');
const {writeReports,sanitizeText}=require('./lib/live-evaluation-report.cjs');
const ROOT=path.resolve(__dirname,'..'), BASELINE='9898a05184a8f860411da8e084cd4b1ed22093a6';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validateScenarios(value){
 if(!value||value.schema_version!=='cue_multiturn_seed_v1'||!Array.isArray(value.sessions)||!value.sessions.length||value.sessions.length>100)throw new Error('Invalid private multi-turn suite.');
 const ids=new Set();let count=0;
 for(const s of value.sessions){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(s.id||'')||ids.has(s.id)||!Array.isArray(s.events)||s.events.length>300||s.context_prelude!=null&&(!Array.isArray(s.context_prelude)||s.context_prelude.length>300)||!['instant','standard'].includes(s.execution_profile))throw new Error('Invalid private session.');ids.add(s.id);
  const eventIds=new Set();
  for(const e of [...(s.context_prelude||[]),...s.events]){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(e.event_id||'')||typeof e.text!=='string'||e.text.length>30000||!['candidate','interviewer','unknown'].includes(e.speaker)||!['you','them'].includes(e.channel)||e.revision!=null&&(!Number.isInteger(e.revision)||e.revision<1)||e.is_final!=null&&typeof e.is_final!=='boolean')throw new Error('Invalid private dialogue event.');
   if(e.invoke_cue){if(e.speaker!=='interviewer'||!e.is_final||eventIds.has(e.event_id))throw new Error('Invalid question event.');count++;eventIds.add(e.event_id);}
  }
 }
 if(count>1000)throw new Error('Too many question events.');return value;
}
function validateEvaluation(value={}){
 const allowed=['profile','repeats','sessionIds','shardIndex','shardCount','applicationCommit','label','judge','concurrency','retryLimit','baselineRoot','timeoutMs','outputCeiling','dynamic','sourceSnapshot'];
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Invalid evaluation configuration.');
 if(value.label!=null&&(typeof value.label!=='string'||value.label.length>100))throw new Error('Invalid evaluation label.');
 if(value.applicationCommit!=null&&!['current','baseline',BASELINE].includes(value.applicationCommit)&&!/^[a-f0-9]{40}$/.test(value.applicationCommit))throw new Error('Invalid application commit.');
 if(value.baselineRoot!=null)throw new Error('Input cannot select local application paths.');
 if(value.sourceSnapshot!=null&&!['baseline','current'].includes(value.sourceSnapshot))throw new Error('Invalid trusted source snapshot.');
 if(value.judge!=null&&typeof value.judge!=='boolean'||value.dynamic!=null&&typeof value.dynamic!=='boolean'&&(typeof value.dynamic!=='object'||Array.isArray(value.dynamic)))throw new Error('Invalid evaluation role configuration.');
 resolveProfile(value);
 return value;
}
function applicationRoot(input,env){
 const commit=input.applicationCommit||'current';
 if(commit==='baseline'||commit===BASELINE){
  const candidate=path.resolve(env.CUE_BASELINE_ROOT||path.join(ROOT,'.cue-baseline'));
  const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim();
  if(actual!==BASELINE)throw new Error('Frozen baseline commit mismatch.');return {root:candidate,commit:BASELINE,kind:'frozen-baseline'};
 }
 const actual=buildIdentity(env).commit;
 if(commit!=='current'&&commit!==actual)throw new Error('Application commit differs from trusted checkout.');
 return {root:ROOT,commit:actual,kind:'trusted-current'};
}
function neutralQuality({status,error}){const ok=status==='passed'&&!error;return{scored:false,passed:ok,qualityStatus:'needs-review',deterministic:{passed:ok,checks:[{id:'production-call-completed',passed:ok}]},manualReviewRequired:true,reviewWarnings:['Semantic judge pending.']};}
function getQuality(){try{return require('./lib/multiturn-quality.cjs').evaluateMultiturnCase;}catch{return neutralQuality;}}
async function deliverEvent(runtime,event,sessionId){
 const data={sessionId,eventId:event.event_id,speaker:event.speaker,channel:event.channel,text:event.text,revision:event.revision||1,isFinal:!!event.is_final,startMs:event.at_ms??null,endMs:event.at_ms??null,receivedAt:Date.now(),confidence:null,source:'private-fixed-event-replay'};
 if(runtime.hasHandler('dialogue:event')){const result=await runtime.invoke('dialogue:event',data);if(result?.accepted===false)throw new Error('Production dialogue event rejected: '+(result.reason||'unknown'));return 'production-dialogue-ipc';}
 // The frozen baseline has only the original actual-speech publishing boundary.
 // This is an observation adapter, not a replacement memory/router/prompt.
 const meta={sourceId:'private-fixed-event-replay',utteranceKey:data.eventId,utteranceOrder:event.at_ms||0,revision:data.revision};
 if(event.speaker==='candidate')runtime.candidate(event.text,meta);else if(event.speaker==='interviewer'){if(event.is_final)runtime.final(event.text,meta);else runtime.interim(event.text,meta);}
 return 'legacy-production-transcript-publisher';
}
async function importMaterials(runtime,input,bundle){
 const state=await runtime.importMaterialSnapshot({facts:input.facts,sources:bundle.sources});
 const activeJobProfileId=input.profile.activeJobProfileId||input.profile.activeJobProfile||'';
 await runtime.invoke('settings:set',{resumeText:input.profile.resumeText,jobDescription:input.profile.jobDescription,currentProjectId:'',projectFactsEnabled:true,manualProjectKnowledgeEnabled:false,projectKnowledge:'',...(input.profile.jobProfiles?{jobProfiles:input.profile.jobProfiles}:{}),activeJobProfileId});
 await runtime.exports('src/project-knowledge.js').warmProjectIndex();
 return {generation:state.generation,counts:state.counts,projects:state.projects.map(p=>({id:p.id,factCount:p.factCount,sourceChunks:p.sourceChunks}))};
}
async function evaluateMultiturn({payload,outputDir,env=process.env,provider='all',providers,mock=false}){
 const input=payload,configuration=validateEvaluation(input.evaluation||{}),suite=validateScenarios(input.scenarios);
 const selected=providers||provider,providerIds=selected==='all'?['qwen','deepseek']:[selected];
 if(providerIds.some(id=>!['qwen','deepseek'].includes(id)))throw new Error('Invalid provider selection.');
 const profile=resolveProfile(configuration,providerIds.length),tasks=buildTasks(suite.sessions,profile,providerIds),app=applicationRoot(configuration,env);
 const questionCount=tasks.reduce((n,t)=>n+t.session.events.filter(e=>e.invoke_cue).length,0);
 if(!questionCount||questionCount>10000)throw new Error('Invalid shard question count.');
 const options={mock,outputDir,targetRoot:app.root,maxCalls:questionCount*(1+profile.retryLimit),maxCallsPerProvider:questionCount*(1+profile.retryLimit),maxOutputTokens:profile.outputCeiling,firstContentTimeoutMs:profile.timeoutMs,totalTimeoutMs:profile.timeoutMs};
 const budget=createBudget(options,providerIds),secrets=[env.QWEN_API_KEY,env.DEEPSEEK_API_KEY].filter(Boolean),tempRoots=[];
 const report={schemaVersion:2,kind:mock?'mock':'live',status:'running',mode:'multiturn',startedAt:new Date().toISOString(),finishedAt:null,build:buildIdentity(env),application:{commit:app.commit,kind:app.kind},evaluation:{...profile,label:configuration.label||null,expectedQuestionCount:questionCount},providers:providerIds.map(id=>({id,model:null,status:'running',attemptedCalls:0,cases:tasks.filter(t=>t.provider===id).flatMap(t=>t.session.events.filter(e=>e.invoke_cue).map(e=>({id:t.session.id+'-r'+(t.repeat+1)+'-'+e.event_id,sessionId:t.session.id,repeat:t.repeat+1,scenarioEventId:e.event_id,question:e.text,mode:t.session.execution_profile,status:'pending',attempted:false,transportStatus:'not-attempted',answer:'',attempts:[]})))})),failures:[],budget:budget.snapshot(),codePositions:codePositions(),privacy:{containsPrivateAnswers:true,publicAnswerArtifactsAllowed:false,encryptBeforeUpload:true},inputs:{factsSha256:hash(input.facts),profileSha256:hash(input.profile),scenariosSha256:hash(suite),schema:input.facts.version||input.facts.schemaVersion,materialRevision:input.revision||hash({facts:input.facts,profile:input.profile})},measurementLimits:{renderer:'virtual Electron IPC delivery, not painted pixels',audio:'fixed text replay; audio-to-final unavailable',baseline:'Frozen application modules untouched; new harness only observes old production boundaries'}};
 fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
 const save=()=>{report.budget={...budget.snapshot(),concurrency:profile.concurrency,profileVersion:profile.version,retryLimit:profile.retryLimit};return writeReports(report,{outputDir,sanitize:{secrets,workspaceRoot:ROOT,tempRoots}});};save();
 if(app.kind==='frozen-baseline'&&input.facts.schemaVersion!==1){report.status='failed';report.compatibility={status:'incompatible',reason:'The frozen application only accepts original v1 facts; no silent downgrade is applied.',applicationSchema:1,inputSchema:input.facts.schemaVersion};report.finishedAt=new Date().toISOString();report.failures.push({code:'baseline-schema-incompatible',message:report.compatibility.reason});return save();}
 const configs=Object.fromEntries(providerIds.map(id=>[id,providerConfig(id,env,mock)]));
 for(const p of report.providers){const c=configs[p.id];p.model=c.model||null;p.endpointHostname=c.hostname||null;if(c.error){p.status='failed';p.error=c.error;report.failures.push({provider:p.id,...c.error});}}
 const {loadTrustedSources}=require('./evaluate-private-projects.cjs');
 const sourceRoot=configuration.sourceSnapshot==='baseline'?applicationRoot({applicationCommit:'baseline'},env).root:ROOT;
 const bundle=loadTrustedSources(sourceRoot);report.inputs.sourceRevision=bundle.revision;report.inputs.sourceSnapshot=configuration.sourceSnapshot||'current';report.inputs.sourceBundleSha256=hash(bundle);report.inputs.sourceProjects=bundle.sources.projects.map(p=>({id:p.id,sourceName:p.sourceName,commit:p.sourceRevision||null,contentHash:p.contentHash||null,revision:p.revision||null}));
 let cursor=0;const fatalProviders=new Set();
 async function work(){
  while(cursor<tasks.length){const task=tasks[cursor++],p=report.providers.find(p=>p.id===task.provider),config=configs[p.id];if(config.error||fatalProviders.has(p.id))continue;
   const cleanups=[];let runtime;
   try{
    runtime=createProviderRuntime({id:p.id,config,options,budget,provider:p,cleanups});tempRoots.push(runtime.temp);await runtime.ready;
    const imported=await importMaterials(runtime,input,bundle);p.materialImport||=imported;
    runtime.clear();
    if(runtime.hasHandler('materials:personal:job')&&(input.profile.jobProfiles||[]).some(job=>job.id===task.session.job_profile))
      await runtime.invoke('materials:personal:job',{jobProfileId:task.session.job_profile});
    else await runtime.invoke('settings:set',{activeJobProfile:task.session.job_profile||'',activeJobProfileId:task.session.job_profile||''});
    const jobDescriptionSha256=hash(runtime.exports('src/store.js').getSettings().jobDescription||'');
    const activeSessionId=runtime.hasHandler('dialogue:snapshot')?(await runtime.invoke('dialogue:snapshot')).sessionId:task.session.id;
    const dialogue=[];let deliveryMode='';
    for(const event of [...(task.session.context_prelude||[]),...task.session.events]){
     deliveryMode=await deliverEvent(runtime,event,activeSessionId);dialogue.push({...event});if(!event.invoke_cue)continue;
     const item={id:task.session.id+'-r'+(task.repeat+1)+'-'+event.event_id,sessionId:task.session.id,mode:task.session.execution_profile,question:event.text,category:task.session.tags?.join(',')||'multiturn',sourcePolicy:task.session.execution_profile==='instant'?'ready-only':'standard',factsEnabled:true,eventAlreadyPublished:true};
     const history=[];let result;
     for(let attempt=0;attempt<=profile.retryLimit;attempt++){
      const judge=getQuality();
      result=await runCase(runtime,item,p,options,budget,args=>judge({...args,event,scenarioEvaluation:event.evaluation,dialogueEvents:dialogue,jobProfile:task.session.job_profile}));
      result.attempt=attempt+1;history.push({...result});if(mock&&result.attempted)p.attemptedCalls++;
      if(!result.error||!/^provider-http-(?:429|5\d\d)$|^(?:provider-error|total-timeout|first-content-timeout)$/.test(result.error.code)||attempt===profile.retryLimit)break;
      await pause(Math.min(10000,1000*(2**attempt)));
     }
     result={...result,repeat:task.repeat+1,attempts:history,scenarioEventId:event.event_id,scenarioEvaluation:event.evaluation,dialogueEvents:dialogue.slice(),deliveryMode,jobProfile:task.session.job_profile,jobDescriptionSha256,applicationCommit:app.commit,tags:task.session.tags||[],sessionTags:task.session.tags||[]};
     const sent=new Set(result.sentSourceIds||[]);result.authoritativeSources=bundle.sources.chunks.filter(c=>sent.has(c.id)).map(c=>({id:c.id,projectId:c.projectId,path:c.path,text:c.text,startLine:c.startLine,endLine:c.endLine}));
     // Preserve every observed attempt. A successful retry cannot erase it.
     p.cases[p.cases.findIndex(c=>c.id===result.id)]=result;if(result.error)report.failures.push({provider:p.id,caseId:result.id,...result.error});save();
     if(/^provider-http-(?:401|403)$/.test(result.error?.code||'')){fatalProviders.add(p.id);break;}
    }
   }catch(error){report.failures.push({provider:p.id,caseId:task.session.id,code:'multiturn-runner',message:sanitizeText(error.message,{secrets,workspaceRoot:ROOT,tempRoots})});}
   finally{for(const cleanup of cleanups.reverse())await cleanup();}save();
  }
 }
 await Promise.all(Array.from({length:Math.min(profile.concurrency,tasks.length)},work));
 for(const p of report.providers){const expected=tasks.filter(t=>t.provider===p.id).reduce((n,t)=>n+t.session.events.filter(e=>e.invoke_cue).length,0);p.expectedCaseCount=expected;p.unexecutedCaseIds=p.cases.filter(c=>c.status==='pending').map(c=>c.id);p.status=p.cases.length===expected&&p.cases.every(c=>c.status==='passed')?'passed':'failed';}
 report.status=report.providers.every(p=>p.status==='passed')&&!report.failures.some(f=>f.code==='multiturn-runner')?'passed':'failed';report.finishedAt=new Date().toISOString();let document=save();
 if(configuration.judge&&!mock){
  const {evaluateJudges}=require('./judge-private-projects.cjs');
  const updateJudged=value=>{const judged=value?.report||value;if(judged?.judging){report.judging=judged.judging;if(judged.providers)report.providers=judged.providers;if(judged.manualReview)report.manualReview=judged.manualReview;if(judged.status)report.status=judged.status;}save();};
  try{updateJudged(await evaluateJudges({report:document,payload:input,env,outputDir,concurrency:Math.min(profile.concurrency,4),onCheckpoint:updateJudged}));}
  catch(error){report.judging={status:'failed',error:sanitizeText(error.message,{secrets,workspaceRoot:ROOT,tempRoots})};report.status='failed';}
  document=save();
 }
 return document;
}
module.exports={evaluateMultiturn,validateScenarios,validateEvaluation,deliverEvent,importMaterials,applicationRoot,BASELINE};
