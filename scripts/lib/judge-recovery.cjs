'use strict';

// Archived answers are data. This module never creates an application runtime,
// imports project materials, calls an answer provider, or executes uploaded code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cipher=require('./private-live-crypto.cjs');
const {validateEvaluationWorkspace,validateJudgeReference}=require('./evaluation-workspace.cjs');
const {prepareJudgeInput,parseJudgeOutput}=require('./multiturn-judge.cjs');
const {roleConfig}=require('./evaluation-role-client.cjs');
const {evaluateJudges,privateWrite,POLICY,summarizeJudging}=require('../judge-private-projects.cjs');
const {writeReports}=require('./live-evaluation-report.cjs');
const {createReviewPlan,stableCaseKey}=require('./multiturn-quality.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const HEX64=/^[a-f0-9]{64}$/,HEX40=/^[a-f0-9]{40}$/;
const CASE_FIELDS=['id','sessionId','repeat','mode','category','question','answer','projectIds','sentFactIds','sentSourceIds','sentSources','authoritativeSources','scenarioEvaluation','dialogueEvents','jobProfile','tags','sessionTags','familyIds','precedingCandidateBehavior','applicationCommit'];
const ATTEMPT_FIELDS=['attempt','role','status','startedAt','finishedAt','provider','requestedModel','model','responseId','usage','finishReason','durationMs','rawOutput','result','error'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,clone(value[key])]));
function read(file,max=cipher.MAX_REPORT_BYTES){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Invalid recovery data file.');return JSON.parse(fs.readFileSync(file,'utf8'));}
function bounded(value,max){return typeof value==='string'&&Buffer.byteLength(value)<=max;}
function priorJudging(value){
  if(!value)return null;
  return {...pick(value,['inputDigest','authorityIds','consensus','modelDiversity']),judges:(value.judges||[]).map(judge=>({...pick(judge,['provider','status','model','result','error']),attempts:(judge.attempts||[]).map(attempt=>({...pick(attempt,ATTEMPT_FIELDS),requestMessagesSha256:attempt.requestMessages?hash(attempt.requestMessages):null}))}))};
}
function projectCase(item){
  return {...pick(item,CASE_FIELDS),archivedGeneration:{...pick(item,['status','transportStatus','attempted','sdkRequestCount','completion','metrics','usage','routing','error']),
    attempts:(item.attempts||[]).map(attempt=>pick(attempt,['attempt','attempted','status','transportStatus','error','metrics','usage','completion'])),actualMessagesSha256:item.actualMessages?hash(item.actualMessages):null},
    archivedJudging:priorJudging(item.judging)};
}
function hasVerifiedJudges(item){return item.judging?.modelDiversity==='verified-distinct-served-models'&&item.judging?.consensus&&item.judging.judges?.length===2&&item.judging.judges.every(judge=>judge.status==='completed');}
function validateRecoveryPayload(payload){
  if(!object(payload)||payload.schemaVersion!==3||payload.kind!=='judge-recovery'||Object.keys(payload).some(key=>!['schemaVersion','kind','workspace','judgeReference','source','report','oracle','evaluation'].includes(key))||Buffer.byteLength(JSON.stringify(payload))>cipher.MAX_INPUT_BYTES)throw new Error('Invalid or oversized judge recovery payload.');
  const workspace=validateEvaluationWorkspace(payload.workspace),judgeReference=validateJudgeReference(payload.judgeReference),source=payload.source,report=payload.report,evaluation=payload.evaluation||{};
  if(!object(source)||Object.keys(source).some(key=>!['repository','trustedSha','combinedReportSha256','payloadSha256','artifacts','selectedCasesSha256','generationCallsObserved','partition','authenticationBoundary'].includes(key))||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(source.repository||'')||!HEX40.test(source.trustedSha||'')||!HEX64.test(source.combinedReportSha256||'')||!HEX64.test(source.payloadSha256||'')||!HEX64.test(source.selectedCasesSha256||'')||!Number.isInteger(source.generationCallsObserved)||source.generationCallsObserved<1||source.generationCallsObserved>10000||!Array.isArray(source.artifacts)||!source.artifacts.length||source.artifacts.length>100)throw new Error('Invalid recovery provenance.');
  if(!object(source.partition)||!Number.isInteger(source.partition.index)||!Number.isInteger(source.partition.count)||source.partition.count<1||source.partition.count>100||source.partition.index<0||source.partition.index>=source.partition.count)throw new Error('Invalid recovery partition.');
  for(const artifact of source.artifacts)if(!object(artifact)||Object.keys(artifact).some(key=>!['runId','runAttempt','commitSha','fingerprint','envelopeSha256','reportSha256','checkpointSha256'].includes(key))||!/^\d+$/.test(artifact.runId||'')||!/^\d+$/.test(artifact.runAttempt||'')||artifact.commitSha!==source.trustedSha||!['fingerprint','envelopeSha256','reportSha256'].every(key=>HEX64.test(artifact[key]||''))||artifact.checkpointSha256!==null&&!HEX64.test(artifact.checkpointSha256||''))throw new Error('Invalid recovery artifact identity.');
  if(!object(report)||Object.keys(report).some(key=>!['application','build','inputs','providers'].includes(key))||!object(report.application)||!HEX40.test(report.application.commit||'')||!object(report.build)||report.build.commit!==source.trustedSha||!object(report.inputs)||report.inputs.factsSha256!==hash(workspace.facts)||report.inputs.profileSha256!==hash(workspace.profile)||report.inputs.judgeReferenceSha256!==judgeReference.sha256||!Array.isArray(report.providers)||!report.providers.length||report.providers.length>2)throw new Error('Invalid archived report identity.');
  const identities=new Set();let count=0;
  for(const provider of report.providers){
    if(!object(provider)||Object.keys(provider).some(key=>!['id','model','cases'].includes(key))||!['qwen','deepseek'].includes(provider.id)||!bounded(provider.model,256)||!Array.isArray(provider.cases))throw new Error('Invalid archived provider.');
    for(const item of provider.cases){
      const key=provider.id+'/'+item?.id;
      if(!object(item)||Object.keys(item).some(name=>![...CASE_FIELDS,'archivedGeneration','archivedJudging'].includes(name))||!/^[a-zA-Z0-9._-]{1,200}$/.test(item.id||'')||identities.has(key)||!bounded(item.question,120000)||!bounded(item.answer,800000)||!item.answer.trim()||!Array.isArray(item.dialogueEvents)||item.dialogueEvents.length>600||!object(item.scenarioEvaluation)||!object(item.archivedGeneration)||item.archivedGeneration.attempted!==true)throw new Error('Invalid archived answer.');
      if(item.dialogueEvents.some(event=>!object(event)||!bounded(event.text,120000)))throw new Error('Invalid archived dialogue.');
      for(const field of ['sentFactIds','sentSourceIds','sentSources','authoritativeSources'])if(item[field]!==undefined&&(!Array.isArray(item[field])||item[field].length>128))throw new Error('Invalid archived evidence.');
      if(item.archivedJudging!==null&&item.archivedJudging!==undefined&&(!object(item.archivedJudging)||!HEX64.test(item.archivedJudging.inputDigest||'')||!Array.isArray(item.archivedJudging.judges)||item.archivedJudging.judges.length!==2))throw new Error('Invalid archived judging.');
      identities.add(key);count++;
    }
  }
  if(!count||count>80||hash(report.providers)!==source.selectedCasesSha256)throw new Error('Archived answer digest or count mismatch.');
  if(!object(evaluation)||Object.keys(evaluation).some(key=>!['concurrency','shardCount','shardIndex','label'].includes(key))||!Number.isInteger(evaluation.concurrency??1)||(evaluation.concurrency??1)<1||(evaluation.concurrency??1)>4||(evaluation.shardCount??1)!==1||(evaluation.shardIndex??0)!==0||evaluation.label!==undefined&&!bounded(evaluation.label,100))throw new Error('Invalid judge-only execution configuration.');
  if(payload.oracle!==undefined&&(!object(payload.oracle)||Object.keys(payload.oracle).some(key=>key!=='judgeEvidence')))throw new Error('Invalid recovery oracle data.');
  return {...payload,workspace,judgeReference,evaluation:{concurrency:1,shardCount:1,shardIndex:0,...evaluation}};
}
function judgePayload(input){return {...input.workspace,judgeReference:input.judgeReference,scenarios:input.oracle||{}};}
function sourceData(sourceDir){
  sourceDir=path.resolve(sourceDir);const manifest=read(path.join(sourceDir,'resume.json')),uploaded=read(path.join(sourceDir,'payload.json'),cipher.MAX_INPUT_BYTES);
  if(manifest.kind!=='cue-remote-evaluation'||!HEX40.test(manifest.trustedSha||'')||!Array.isArray(manifest.runs)||!manifest.runs.length)throw new Error('Invalid source evaluation manifest.');
  const workspace={schemaVersion:uploaded.facts?.schemaVersion,facts:uploaded.facts,profile:uploaded.profile};for(const key of ['revision','sourceManifest','mergeLog'])if(uploaded[key]!==undefined)workspace[key]=uploaded[key];
  const validated=validateEvaluationWorkspace(workspace),reference=validateJudgeReference(uploaded.judgeReference),reports=[],artifacts=[];
  const {verifySession}=require('../eval-remote.cjs');
  for(const run of manifest.runs){
    if(!Number.isInteger(run.shardIndex)||run.shardIndex<0||run.shardIndex>99)throw new Error('Invalid source shard.');
    const directory=path.join(sourceDir,'shard-'+run.shardIndex),session=verifySession(read(path.join(directory,'session/session.json'),16384),manifest,run,{allowExpired:true}),local=read(path.join(directory,'local-key.json'),16384),envelopeFile=path.join(directory,'encrypted/report.encrypted.json'),envelopeBytes=fs.readFileSync(envelopeFile);
    if(local.fingerprint!==session.fingerprint||run.fingerprint!==session.fingerprint||envelopeBytes.length>cipher.MAX_ENVELOPE_BYTES)throw new Error('Source response key identity mismatch.');
    const key=cipher.bytes64(local.key,32);let decoded;try{decoded=cipher.decryptReports({session,key,envelope:JSON.parse(envelopeBytes)});}finally{key.fill(0);}
    const report=decoded.report;
    if(report.kind!=='live'||report.build?.commit!==manifest.trustedSha||report.inputs?.factsSha256!==hash(validated.facts)||report.inputs?.profileSha256!==hash(validated.profile)||report.inputs?.judgeReferenceSha256!==reference.sha256)throw new Error('Authenticated source report does not match its workspace or authority.');
    const originalReportSha256=hash(decoded.report),checkpoint=decoded.artifacts?.['judge-checkpoint.json'];
    for(const provider of report.providers||[])for(const item of provider.cases||[]){const entry=checkpoint?.entries?.[stableCaseKey(item,provider.id)];if(entry&&(!item.judging||JSON.stringify(entry)!==JSON.stringify(item.judging)))item.judging=entry;}
    reports.push(report);artifacts.push({runId:session.runId,runAttempt:session.runAttempt,commitSha:session.commitSha,fingerprint:session.fingerprint,envelopeSha256:bytesHash(envelopeBytes),reportSha256:originalReportSha256,checkpointSha256:checkpoint?hash(checkpoint):null});
  }
  const providers=['qwen','deepseek'].map(id=>{const entries=reports.flatMap(report=>(report.providers||[]).filter(provider=>provider.id===id));const models=[...new Set(entries.map(provider=>provider.model).filter(Boolean))];if(models.length>1)throw new Error('Source generation models changed between shards.');return{id,model:models[0]||null,cases:entries.flatMap(provider=>provider.cases||[])};}).filter(provider=>provider.cases.length);
  const ids=new Set();for(const provider of providers)for(const item of provider.cases){const key=provider.id+'/'+item.id;if(ids.has(key))throw new Error('Source contains duplicate generated answers.');ids.add(key);}
  const combinedFile=path.join(sourceDir,'reports/report.json'),combinedBytes=fs.readFileSync(combinedFile),combined=JSON.parse(combinedBytes);
  const generationIdentity=item=>hash(pick(item,CASE_FIELDS));
  for(const provider of providers)for(const item of provider.cases){const saved=combined.providers?.find(p=>p.id===provider.id)?.cases?.find(row=>row.id===item.id);if(!saved||generationIdentity(saved)!==generationIdentity(item))throw new Error('Local combined answers differ from their authenticated source artifacts.');}
  if(combined.providers.flatMap(provider=>provider.cases||[]).length!==ids.size)throw new Error('Local source report case count mismatch.');
  return {manifest,workspace:validated,judgeReference:reference,oracle:uploaded.scenarios?.judgeEvidence?{judgeEvidence:uploaded.scenarios.judgeEvidence}:undefined,
    report:{...combined,providers:combined.providers.map(provider=>({...provider,cases:providers.find(p=>p.id===provider.id).cases}))},
    provenance:{repository:manifest.repository,trustedSha:manifest.trustedSha,combinedReportSha256:bytesHash(combinedBytes),payloadSha256:hash(uploaded),artifacts,generationCallsObserved:reports.reduce((total,report)=>total+(report.budget?.attemptedCalls||0),0),authenticationBoundary:'Original report ciphertext authenticated locally with its retained response key; the server receives hashes and archived data, never that key.'}};
}
function prepareRecovery({sourceDir,outputDir,shards=8}){
  if(!Number.isInteger(shards)||shards<1||shards>100)throw new Error('Invalid recovery shard count.');
  const source=sourceData(sourceDir),rows=source.report.providers.flatMap(provider=>provider.cases.filter(item=>!hasVerifiedJudges(item)).map(item=>({provider:provider.id,model:provider.model,item:projectCase(item)})));
  if(!rows.length)throw new Error('All source answers already have two verified judge results.');
  const count=Math.min(shards,rows.length),jobs=[];
  for(let index=0;index<count;index++){
    const assigned=rows.filter((_,ordinal)=>ordinal%count===index),providers=['qwen','deepseek'].map(id=>({id,model:source.report.providers.find(provider=>provider.id===id)?.model,cases:assigned.filter(row=>row.provider===id).map(row=>row.item)})).filter(provider=>provider.cases.length);
    const payload=validateRecoveryPayload({schemaVersion:3,kind:'judge-recovery',workspace:source.workspace,judgeReference:source.judgeReference,
      source:{...source.provenance,partition:{index,count},selectedCasesSha256:hash(providers)},
      report:{application:source.report.application,build:source.report.build,inputs:source.report.inputs,providers},...(source.oracle?{oracle:source.oracle}:{}),evaluation:{concurrency:1,shardCount:1,shardIndex:0,label:'judge-recovery-'+index}});
    const payloadFile=path.join(path.resolve(outputDir),'payload-'+index+'.json'),runDir=path.join(path.resolve(outputDir),'run-'+index);privateWrite(payloadFile,payload);
    jobs.push({index,payloadFile,outputDir:runDir,caseCount:assigned.length,payloadBytes:Buffer.byteLength(JSON.stringify(payload)),arguments:['--payload',payloadFile,'--profile','regression','--provider','all','--shards','1','--output-dir',runDir]});
  }
  const plan={schemaVersion:1,kind:'cue-judge-recovery-plan',sourceDir:path.resolve(sourceDir),outputDir:path.resolve(outputDir),sourceCombinedReportSha256:source.provenance.combinedReportSha256,sourceArtifactCount:source.provenance.artifacts.length,sourceGenerationCallsObserved:source.provenance.generationCallsObserved,selectedCases:rows.length,judgeReferenceSha256:source.judgeReference.sha256,generationCallsToExecute:0,jobs};
  privateWrite(path.join(outputDir,'plan.json'),plan);return plan;
}
async function evaluateRecovery({payload,outputDir,env=process.env,mock=false,evaluateJudgesImpl=evaluateJudges}){
  if(mock)throw new Error('Judge recovery cannot certify mock archived answers.');
  const input=validateRecoveryPayload(payload),authority=judgePayload(input),configurations=['qwen','deepseek'].map(id=>roleConfig(id,env,'judge'));
  const providers=input.report.providers.map(provider=>({id:provider.id,model:provider.model,status:'archived',attemptedCalls:0,cases:provider.cases.map(item=>({...clone(item),attempted:false,attempts:[],metrics:{},usage:null,status:item.archivedGeneration.status,transportStatus:'archived-source',generationReused:true}))}));
  const report={schemaVersion:2,kind:'live',mode:'judge-recovery',status:providers.every(provider=>provider.cases.every(item=>item.status==='passed'))?'passed':'failed',startedAt:new Date().toISOString(),finishedAt:null,
    build:require('../e2e-live-llm.cjs').buildIdentity(env),application:input.report.application,inputs:{...input.report.inputs,recoverySourceReportSha256:input.source.combinedReportSha256,recoveryCasesSha256:input.source.selectedCasesSha256},providers,failures:[],budget:{attemptedCalls:0,callsByProvider:{qwen:0,deepseek:0},maxCalls:0,maxCallsPerProvider:0,concurrency:input.evaluation.concurrency},
    recovery:{generationExecutedThisRun:0,sourceGenerationCallsObserved:input.source.generationCallsObserved,source:input.source,continuedCases:providers.reduce((n,p)=>n+p.cases.length,0),sourceCasesAreArchived:true},privacy:{containsPrivateAnswers:true,publicAnswerArtifactsAllowed:false,encryptBeforeUpload:true},
    measurementLimits:{generation:'No application runtime or answer-provider invocation occurs. Answers, generation metrics and attempts are archived observations under archivedGeneration; they are not new performance samples.',provenance:input.source.authenticationBoundary}};
  const initialEntries={};
  for(const provider of providers)for(const item of provider.cases){
    const prepared=prepareJudgeInput({item,payload:authority}),prior=item.archivedJudging;
    if(prior&&prior.inputDigest!==prepared.digest)throw new Error('Archived judge input changed; refusing to reuse its results.');
    const judges=configurations.map(config=>{
      const old=prior?.judges?.find(judge=>judge.provider===config.id),completed=old?.attempts?.findLast(attempt=>attempt.status==='completed'&&attempt.result!==undefined);
      if(old?.status==='completed'&&completed?.model&&old.model===config.model&&completed.requestedModel===config.model){
        parseJudgeOutput(JSON.stringify(completed.result),prepared.input);
        return {...clone(old),attempts:old.attempts.map(attempt=>({...clone(attempt),executedThisRun:false,reusedFromSource:true}))};
      }
      return {provider:config.id,status:'pending',model:config.model||null,attempts:[]};
    });
    initialEntries[stableCaseKey(item,provider.id)]={inputDigest:prepared.digest,authorityIds:prepared.authorityIds,input:prepared.input,judges};
  }
  const save=value=>writeReports(value||report,{outputDir,sanitize:{secrets:[env.QWEN_API_KEY,env.DEEPSEEK_API_KEY].filter(Boolean)}});
  save();
  try{await evaluateJudgesImpl({report,payload:authority,env,outputDir,concurrency:input.evaluation.concurrency,initialEntries,onCheckpoint:save});}
  finally{report.finishedAt=new Date().toISOString();save();}
  return save();
}
function mergeRecovery({sourceDir,recoveryDir,outputDir}){
  const source=sourceData(sourceDir),plan=read(path.join(recoveryDir,'plan.json'));
  if(plan.kind!=='cue-judge-recovery-plan'||plan.sourceCombinedReportSha256!==source.provenance.combinedReportSha256||plan.judgeReferenceSha256!==source.judgeReference.sha256)throw new Error('Recovery plan belongs to a different source or authority.');
  const report=source.report,seen=new Set(),operations=[];
  for(const job of plan.jobs){
    // Re-authenticate each new encrypted response rather than trusting a local
    // editable report. sourceData is for generation archives; recovery needs no
    // generation payload, so use its manifest/session binding directly here.
    const directory=path.join(path.resolve(recoveryDir),'run-'+job.index),manifest=read(path.join(directory,'resume.json'));
    if(manifest.runs.length!==1)throw new Error('A recovery partition must have one workflow run.');
    const run=manifest.runs[0],base=path.join(directory,'shard-0'),session=require('../eval-remote.cjs').verifySession(read(path.join(base,'session/session.json'),16384),manifest,run,{allowExpired:true}),local=read(path.join(base,'local-key.json'),16384),encrypted=read(path.join(base,'encrypted/report.encrypted.json'),cipher.MAX_ENVELOPE_BYTES);
    if(local.fingerprint!==session.fingerprint||run.fingerprint!==session.fingerprint)throw new Error('Recovery response identity mismatch.');
    const key=cipher.bytes64(local.key,32);let resumed;try{resumed=cipher.decryptReports({session,key,envelope:encrypted}).report;}finally{key.fill(0);}
    const payload=validateRecoveryPayload(read(path.join(recoveryDir,'payload-'+job.index+'.json'),cipher.MAX_INPUT_BYTES));
    if(resumed.mode!=='judge-recovery'||resumed.recovery?.generationExecutedThisRun!==0||resumed.inputs?.recoverySourceReportSha256!==source.provenance.combinedReportSha256||resumed.inputs?.recoveryCasesSha256!==payload.source.selectedCasesSha256||resumed.inputs?.judgeReferenceSha256!==source.judgeReference.sha256)throw new Error('Recovery result identity mismatch.');
    for(const provider of resumed.providers||[])for(const recovered of provider.cases||[]){
      const original=report.providers.find(item=>item.id===provider.id)?.cases.find(item=>item.id===recovered.id),expected=payload.report.providers.find(item=>item.id===provider.id)?.cases.find(item=>item.id===recovered.id),identity=provider.id+'/'+recovered.id;
      if(!original||!expected||seen.has(identity)||hash(pick(recovered,CASE_FIELDS))!==hash(pick(original,CASE_FIELDS)))throw new Error('Recovery changed or duplicated an archived answer.');
      if(original.judging)original.judgingHistory=[...(original.judgingHistory||[]),clone(original.judging)];
      original.judging=clone(recovered.judging);original.quality={...original.quality,...pick(recovered.quality||{},['semanticJudged','semanticStatus','manualReviewRequired'])};
      seen.add(identity);
    }
    operations.push({runId:run.runId,runAttempt:run.runAttempt,trustedSha:manifest.trustedSha,sourcePartition:job.index,continuedCases:(resumed.providers||[]).reduce((n,p)=>n+p.cases.length,0),generationExecutedThisRun:0,judgeAttemptsExecutedThisRun:resumed.judging?.attempts??null});
  }
  if(seen.size!==plan.selectedCases)throw new Error('Recovery results omit selected archived answers.');
  report.recovery={source:source.provenance,operations,generationExecutedAcrossRecoveryRuns:0,originalGenerationCalls:source.provenance.generationCallsObserved};report.judging=summarizeJudging(report);report.manualReview=createReviewPlan(report);
  report.status=report.providers.some(provider=>provider.cases.some(item=>item.status==='failed'))||report.judging.failed||report.judging.unverified||report.judging['needs-review']?'failed':'needs-review';
  const packets=report.manualReview.selectedCases.map(selection=>{const rows=report.providers.flatMap(provider=>provider.cases.map(item=>({provider:provider.id,item}))),row=rows.find(entry=>stableCaseKey(entry.item,entry.provider)===selection.key),session=rows.filter(entry=>entry.provider===row.provider&&entry.item.sessionId===row.item.sessionId&&entry.item.repeat===row.item.repeat);return{...selection,question:row.item.question,answer:row.item.answer,completeSession:{reportFile:'report.json',provider:row.provider,sessionId:row.item.sessionId,repeat:row.item.repeat,caseIds:session.map(entry=>entry.item.id)},judgingRef:{reportFile:'report.json',provider:row.provider,caseId:row.item.id},consensus:row.item.judging?.consensus||null};});
  privateWrite(path.join(outputDir,'manual-review-queue.json'),{schemaVersion:2,packetLayout:'report-references',...report.manualReview,packets});report.judging.humanReview='pending';report.judging.status='needs-review';return writeReports(report,{outputDir});
}
module.exports={validateRecoveryPayload,projectCase,hasVerifiedJudges,sourceData,prepareRecovery,evaluateRecovery,mergeRecovery,hash};
