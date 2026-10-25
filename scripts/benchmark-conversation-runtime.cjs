#!/usr/bin/env node
'use strict';

// Local, production-entry benchmark. The only replacement is the SDK stream;
// this file never builds model prompts, calls a provider, or saves a dialogue.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile, execFileSync} = require('node:child_process');
const {promisify} = require('node:util');
const {performance, monitorEventLoopDelay} = require('node:perf_hooks');
const {setTimeout:pause} = require('node:timers/promises');
const ROOT = path.resolve(__dirname, '..');
const BASELINE = '9898a05184a8f860411da8e084cd4b1ed22093a6';
const runFile = promisify(execFile);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rounded = value => Number.isFinite(value) ? +value.toFixed(3) : null;
const FIELDS = ['prepareMs', 'contextMs', 'factSelectionMs', 'contextBuildMs', 'afterEvidenceContextMs', 'outsideContextBuildMs', 'promptPrepareMs', 'triggerToDispatchMs', 'sdkBoundaryDispatchMs'];

function argumentsFor(args) {
  const options = {payload:path.join(ROOT,'.cue-private/results/fixtures/compatible-v1-workspace.json'),
    scenarios:path.join(ROOT,'.cue-private/task-2026-10-24/data/multiturn_scenarios.json'),
    baselineRoot:'/tmp/cue-frozen-9898a05', currentRoot:ROOT, variants:'both', sessionLimit:20,
    outputDir:path.join(ROOT,'.cue-private/reports/conversation-runtime-benchmark'), timeoutMs:600000,
    summaryReports:[]};
  const names = {'--payload':'payload','--scenarios':'scenarios','--baseline-root':'baselineRoot','--current-root':'currentRoot',
    '--output-dir':'outputDir','--variants':'variants','--session-limit':'sessionLimit','--timeout-ms':'timeoutMs','--worker':'worker'};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help'||args[i]==='-h')options.help=true;
    else if(args[i]==='--summary-only')options.summaryOnly=true;
    else if(args[i]==='--summary-report'&&args[i+1])options.summaryReports.push(path.resolve(args[++i]));
    else if(names[args[i]]&&args[i+1]&&!args[i+1].startsWith('--'))options[names[args[i]]]=args[++i];
    else throw new Error('Invalid benchmark argument. Use --help.');
  }
  options.sessionLimit=Number(options.sessionLimit);options.timeoutMs=Number(options.timeoutMs);
  if(!Number.isInteger(options.sessionLimit)||options.sessionLimit<3||options.sessionLimit>100||
    !Number.isInteger(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>3600000||
    !['both','baseline','current'].includes(options.variants)||options.worker&&!['baseline','current'].includes(options.worker)||options.summaryOnly&&!options.summaryReports.length)throw new Error('Invalid benchmark configuration.');
  for(const key of ['payload','scenarios','baselineRoot','currentRoot','outputDir'])options[key]=path.resolve(options[key]);
  return options;
}
function readJson(file,maximum=32*1024*1024) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw new Error('Invalid benchmark data file.');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function distribution(values) {
  const sorted=values.filter(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
  const rank=q=>sorted.length?rounded(sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]):null;
  return{count:sorted.length,min:sorted.length?rounded(sorted[0]):null,p50:rank(.5),p95:rank(.95),p99:rank(.99),max:sorted.length?rounded(sorted.at(-1)):null};
}
function summarizeRows(rows) {
  return{caseCount:rows.length,completedCalls:rows.filter(r=>r.completed).length,failedCalls:rows.filter(r=>!r.completed).length,
    measurements:Object.fromEntries(FIELDS.map(field=>[field,distribution(rows.map(row=>row[field]))])),
    byMode:[...new Set(rows.map(row=>row.mode))].map(mode=>({mode,caseCount:rows.filter(row=>row.mode===mode).length,
      measurements:Object.fromEntries(FIELDS.map(field=>[field,distribution(rows.filter(row=>row.mode===mode).map(row=>row[field]))]))}))};
}
function memory() {
  const m=process.memoryUsage();return{rssBytes:m.rss,heapUsedBytes:m.heapUsed,heapTotalBytes:m.heapTotal,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers};
}
function codeIdentity(root) {
  let commit=null,dirty=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* The content fingerprint still identifies a non-git application copy. */}
  const files=['main.js','package.json'];
  const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&/\.(?:js|cjs|json)$/.test(entry.name))files.push(path.relative(root,file));}};
  walk(path.join(root,'src'));files.sort();
  return{commit,dirty,productionFileCount:files.length,productionContentSha256:hash(JSON.stringify(files.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))])))};
}
function safeError(error,stage) {return{code:'benchmark-'+stage,type:['Error','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'Error'};}
async function worker(options) {
  const variant=options.worker,targetRoot=variant==='baseline'?options.baselineRoot:options.currentRoot;
  const identityBefore=codeIdentity(targetRoot);
  if(variant==='baseline'&&identityBefore.commit!==BASELINE)throw new Error('The frozen baseline SHA does not match.');
  const stages=[],observations={},cleanups=[];
  const histogram=monitorEventLoopDelay({resolution:1});
  let input,suite,bundle,runtime,inputs,imported,peakHeap=0,stageName='startup';
  async function stage(name,run) {
    stageName=name;histogram.enable();await pause(4);histogram.reset();
    // Anchor the histogram in a completed timers turn. Without this check-phase
    // yield a synchronous operation begun in a timer continuation can occur
    // before the histogram's next sampling anchor and disappear from its max.
    await new Promise(setImmediate);
    const before=memory(),cpu=process.cpuUsage(),started=performance.now();peakHeap=before.heapUsedBytes;
    let firstTimerLatenessMs=null;
    const witness=setTimeout(()=>{firstTimerLatenessMs=rounded(Math.max(0,performance.now()-started-1));},1);
    let result,error;try{result=await run();}catch(caught){error=caught;}
    const elapsedMs=performance.now()-started,usedCpu=process.cpuUsage(cpu),after=memory();
    peakHeap=Math.max(peakHeap,after.heapUsedBytes);
    // Let the pending histogram timer observe the synchronous work above.
    await pause(3);histogram.disable();
    clearTimeout(witness);
    const measured={name,elapsedMs:rounded(elapsedMs),cpuUserMs:rounded(usedCpu.user/1000),cpuSystemMs:rounded(usedCpu.system/1000),
      cpuPercentOfOneCore:elapsedMs?rounded((usedCpu.user+usedCpu.system)/10/elapsedMs):null,memoryBefore:before,memoryAfter:after,
      heapUsedDeltaBytes:after.heapUsedBytes-before.heapUsedBytes,peakSampledHeapUsedBytes:peakHeap,firstTimerLatenessMs,
      eventLoopDelayMs:{count:histogram.count,min:histogram.count?rounded(histogram.min/1e6):null,mean:histogram.count?rounded(histogram.mean/1e6):null,
        p50:histogram.count?rounded(histogram.percentile(50)/1e6):null,p95:histogram.count?rounded(histogram.percentile(95)/1e6):null,
        p99:histogram.count?rounded(histogram.percentile(99)/1e6):null,max:histogram.count?rounded(histogram.max/1e6):null}};
    stages.push(measured);if(error)throw error;return result;
  }
  try {
    await stage('input-validation-and-frozen-source-load',async()=>{
      const {validatePrivatePayload,loadTrustedSources}=require('./evaluate-private-projects.cjs');
      const {validateScenarios}=require('./evaluate-multiturn-projects.cjs');
      const workspace=readJson(options.payload,8*1024*1024);suite=validateScenarios(readJson(options.scenarios,8*1024*1024));
      input=validatePrivatePayload({schemaVersion:2,facts:workspace.facts,profile:workspace.profile,revision:workspace.revision,scenarios:suite,evaluation:{profile:'regression'}});
      if(input.facts.schemaVersion!==1)throw new Error('The comparison requires identical v1-compatible facts.');
      bundle=loadTrustedSources(options.baselineRoot);
      inputs={factsSha256:hash(JSON.stringify(input.facts)),profileSha256:hash(JSON.stringify(input.profile)),
        scenariosSha256:hash(JSON.stringify(suite)),sourceBundleSha256:hash(JSON.stringify(bundle)),factCount:input.facts.cards.length,
        sourceChunkCount:bundle.sources.chunks.length,sourceSnapshot:'frozen-baseline',
        sourceCommits:bundle.sources.projects.map(project=>({id:project.id,commit:project.sourceRevision||null}))};
      suite={...suite,sessions:suite.sessions.slice(0,options.sessionLimit)};
      if(suite.sessions.length<3)throw new Error('At least three complete sessions are required.');
    });
    await stage('cold-entry-and-empty-index-initialization',async()=>{
      const {createProviderRuntime,providerConfig}=require('./e2e-live-llm.cjs');
      runtime=createProviderRuntime({id:'qwen',config:providerConfig('qwen',{},true),options:{mock:true,targetRoot,firstContentTimeoutMs:120000},budget:{},provider:{},cleanups});
      await runtime.ready;
      runtime.behavior(async()=> (async function*(){
        yield{choices:[{delta:{content:'MOCK：本地上下文基准固定回复。'}}]};
        yield{choices:[{delta:{},finish_reason:'stop'}]};
      })());
    });
    await stage('cold-private-material-import-and-index-warm',async()=>{
      imported=await require('./evaluate-multiturn-projects.cjs').importMaterials(runtime,input,bundle);
    });
    const {deliverEvent}=require('./evaluate-multiturn-projects.cjs');
    for(const phase of ['first-workload-pass','matched-warm-replay']) {
      const rows=[];let dialogueEvents=0,dialogueDeliveryMs=0,questionCount=0,resetCount=0;
      await stage(phase,async()=>{
        for(const session of suite.sessions) {
          runtime.clear();resetCount++;
          if(runtime.hasHandler('materials:personal:job')&&(input.profile.jobProfiles||[]).some(job=>job.id===session.job_profile))
            await runtime.invoke('materials:personal:job',{jobProfileId:session.job_profile});
          else await runtime.invoke('settings:set',{activeJobProfile:session.job_profile||'',activeJobProfileId:session.job_profile||''});
          const sessionId=runtime.hasHandler('dialogue:snapshot')?(await runtime.invoke('dialogue:snapshot')).sessionId:session.id;
          for(const event of [...(session.context_prelude||[]),...session.events]) {
            const eventStarted=performance.now();await deliverEvent(runtime,event,sessionId);dialogueDeliveryMs+=performance.now()-eventStarted;dialogueEvents++;
            if(!event.invoke_cue)continue;
            await runtime.invoke('settings:set',{realtimeAnswerMode:session.execution_profile,
              sourceRagPolicies:{instant:'ready-only',standard:'standard'},projectFactsEnabled:true});
            const eventStart=runtime.events.length,logStart=runtime.logs.length,callStart=runtime.calls.length,started=performance.now();
            await runtime.ask('say',event.text);questionCount++;
            const events=runtime.events.slice(eventStart),metrics=events.filter(e=>e.channel==='llm:metrics').at(-1)||{},materials=events.filter(e=>e.channel==='llm:materials').at(-1)||{};
            let prompt={};for(const entry of runtime.logs.slice(logStart))for(const item of entry)if(typeof item==='string'&&item.startsWith('[latency][prompt] ')){
              try{const parsed=JSON.parse(item.slice('[latency][prompt] '.length));if(!metrics.requestId||parsed.requestId===metrics.requestId)prompt=parsed;}catch{/* Unknown fields stay unavailable. */}
            }
            const dispatchAt=runtime.observedTimes.find(item=>item.type==='request')?.at;
            const row={mode:session.execution_profile,completed:runtime.calls.length-callStart===1&&!events.some(e=>e.channel==='llm:error'),
              prepareMs:metrics.prepareMs??null,triggerToDispatchMs:metrics.triggerToDispatchMs??null,
              contextMs:prompt.contextMs??null,promptPrepareMs:prompt.prepareMs??null,
              factSelectionMs:materials.factSelectionMs??null,contextBuildMs:materials.contextBuildMs??null,
              afterEvidenceContextMs:Number.isFinite(materials.contextBuildMs)&&Number.isFinite(prompt.contextMs)?Math.max(0,materials.contextBuildMs-prompt.contextMs):null,
              outsideContextBuildMs:Number.isFinite(materials.contextBuildMs)&&Number.isFinite(metrics.prepareMs)?Math.max(0,metrics.prepareMs-materials.contextBuildMs):null,
              sdkBoundaryDispatchMs:Number.isFinite(dispatchAt)?dispatchAt-started:null};
            rows.push(row);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
            // Capturing entire SDK contexts is useful to quality evaluation but
            // irrelevant here; release observation copies, preserving all real
            // production memory and material caches, before the next question.
            for(const list of ['calls','requestOptions','requests','commits','searches','events','logs','transportEvents'])runtime[list].length=0;
            // Ensure the 1ms histogram sees each synchronous foreground span.
            await pause(2);
          }
        }
      });
      observations[phase]={...summarizeRows(rows),sessionCount:suite.sessions.length,questionCount,dialogueEvents,resetCount,dialogueDeliveryMs:rounded(dialogueDeliveryMs)};
    }
    await stage('runtime-disposal',async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
    const identityAfter=codeIdentity(targetRoot),stable=identityBefore.productionContentSha256===identityAfter.productionContentSha256;
    const first=observations['first-workload-pass'],warm=observations['matched-warm-replay'];
    return{variant,status:stable&&!first.failedCalls&&!warm.failedCalls?'completed':'needs-review',application:identityBefore,
      applicationStableDuringRun:stable,applicationAfter:identityAfter,inputs,importCounts:imported.counts,
      sessionCount:suite.sessions.length,questionsPerPass:first.caseCount,totalMockGenerations:first.caseCount+warm.caseCount,
      stages,observations,retainedMemoryAfterDisposal:memory(),
      warmPreparationTarget:{thresholdP95Ms:200,observedP95Ms:warm.measurements.prepareMs.p95,
        passed:warm.measurements.prepareMs.count===warm.caseCount?warm.measurements.prepareMs.p95<=200:null}};
  }catch(error){return{variant,status:'failed',application:identityBefore,inputs:inputs||null,stages,error:safeError(error,stageName)};}
  finally{histogram.disable();for(const cleanup of cleanups.reverse())try{await cleanup();}catch{/* Private errors are not logged. */}}
}
function reportPreparationSummary(report) {
  const groups=[];
  for(const provider of report.providers||[]) {
    const rows=(provider.cases||[]).flatMap(item=>(item.attempts?.length?item.attempts:[item]).map(attempt=>({mode:attempt.mode||item.mode,
      completed:attempt.transportStatus==='passed',prepareMs:attempt.metrics?.prepareMs??null,
      triggerToDispatchMs:attempt.metrics?.triggerToDispatchMs??null,contextMs:null,promptPrepareMs:null,sdkBoundaryDispatchMs:attempt.metrics?.requestDispatchMs??null})));
    groups.push({provider:provider.id,model:provider.model||null,sourceCaseCount:(provider.cases||[]).length,attemptCount:rows.length,...summarizeRows(rows)});
  }
  return{kind:report.kind||'unknown',mode:report.mode||null,applicationCommit:report.application?.commit||report.build?.commit||null,
    sourceBundleSha256:report.inputs?.sourceBundleSha256||null,providers:groups,
    limitation:'Production prepareMs is available per attempt. Prompt-log contextMs was not retained by the live runner and cannot be reconstructed.'};
}
function write(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.tmp-'+crypto.randomBytes(6).toString('hex');
  try{fs.writeFileSync(temporary,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,file);}finally{fs.rmSync(temporary,{force:true});}
}
function markdown(report) {
  const lines=[report.variants.length?'# 本地生产会话准备基准':'# 已有生产请求准备时间汇总','',`状态：${report.status}。本次命令新增真实 API 调用：0。Mock TTFT 不作为模型性能指标。`,'',
    report.variants.length?'双方使用同一私有 v1 资料、冻结源码材料、问题和真人事件。每个版本在独立 Node 进程运行，先完成全量事件回放，再在同一材料实例上重放完全相同的会话；每会话均按生产入口 reset。':'本次只汇总已有逐题报告，包含失败重试。没有执行本地重放或新增模型请求。',
    '', '| 版本 | 会话/每遍问题 | 冷入口 ms | 私有材料导入及索引 ms | 首遍 prepare P50/P95 ms | 预热重放 prepare P50/P95 ms | 预热上下文 P95 ≤ 200 ms |',
    '| --- | --- | --- | --- | --- | --- | --- |'];
  for(const variant of report.variants) {
    const first=variant.observations?.['first-workload-pass']?.measurements.prepareMs,warm=variant.observations?.['matched-warm-replay']?.measurements.prepareMs;
    lines.push(`| ${variant.variant} | ${variant.sessionCount??'unknown'}/${variant.questionsPerPass??'unknown'} | ${variant.stages.find(s=>s.name==='cold-entry-and-empty-index-initialization')?.elapsedMs??'unknown'} | ${variant.stages.find(s=>s.name==='cold-private-material-import-and-index-warm')?.elapsedMs??'unknown'} | ${first?.p50??'unknown'}/${first?.p95??'unknown'} | ${warm?.p50??'unknown'}/${warm?.p95??'unknown'} | ${variant.warmPreparationTarget?.passed??'unknown'} |`);
  }
  lines.push('','| 版本/阶段 | wall ms | user/system CPU ms | heap 变化 bytes | 观测 heap 峰值 bytes | event loop P95/max ms |','| --- | --- | --- | --- | --- | --- |');
  for(const variant of report.variants)for(const stage of variant.stages)lines.push(`| ${variant.variant}/${stage.name} | ${stage.elapsedMs} | ${stage.cpuUserMs}/${stage.cpuSystemMs} | ${stage.heapUsedDeltaBytes} | ${stage.peakSampledHeapUsedBytes} | ${stage.eventLoopDelayMs.p95??'unknown'}/${stage.eventLoopDelayMs.max??'unknown'} |`);
  if(report.existingReportPreparation.length) {
    lines.push('','已有逐题报告的准备时间（包含所有尝试）：','','| 类型/服务 | 已观测 prepare / 尝试 | prepare P50/P95/max ms | trigger-to-dispatch P95 ms |','| --- | --- | --- | --- |');
    for(const existing of report.existingReportPreparation)for(const provider of existing.providers)lines.push(`| ${existing.kind}/${provider.provider} | ${provider.measurements.prepareMs.count}/${provider.caseCount} | ${provider.measurements.prepareMs.p50??'unknown'}/${provider.measurements.prepareMs.p95??'unknown'}/${provider.measurements.prepareMs.max??'unknown'} | ${provider.measurements.triggerToDispatchMs.p95??'unknown'} |`);
  }
  lines.push('','边界：','',...report.limitations.map(line=>'- '+line),'');return lines.join('\n');
}
async function main(args=process.argv.slice(2)) {
  const options=argumentsFor(args);
  if(options.help){process.stdout.write('node scripts/benchmark-conversation-runtime.cjs [--payload PRIVATE_V1_WORKSPACE] [--scenarios PRIVATE_SCENARIOS] [--output-dir PRIVATE_DIR] [--variants both|baseline|current] [--session-limit 3..100]\nOptional: --summary-report PRIVATE_LIVE_REPORT_JSON (repeatable); --summary-only skips the benchmark and aggregates those reports. No real API calls; only anonymous aggregate reports are saved.\n');return 0;}
  if(options.worker){const result=await worker(options);process.stdout.write(JSON.stringify(result)+'\n');return result.status==='failed'?1:0;}
  const startedAt=new Date().toISOString(),variants=[];
  fs.mkdirSync(options.outputDir,{recursive:true,mode:0o700});fs.chmodSync(options.outputDir,0o700);
  for(const variant of options.summaryOnly?[]:options.variants==='both'?['baseline','current']:[options.variants]) {
    process.stdout.write('Measuring '+variant+' production runtime with local mock transport.\n');
    const flags=['--worker',variant,'--payload',options.payload,'--scenarios',options.scenarios,'--baseline-root',options.baselineRoot,
      '--current-root',options.currentRoot,'--session-limit',String(options.sessionLimit)];
    try{
      const {stdout}=await runFile(process.execPath,[__filename,...flags],{cwd:ROOT,timeout:options.timeoutMs,maxBuffer:4*1024*1024,
        env:{PATH:process.env.PATH,LANG:process.env.LANG||'C.UTF-8',TZ:'UTC'}});
      variants.push(JSON.parse(stdout));
    }catch(error){try{variants.push(JSON.parse(error.stdout));}catch{variants.push({variant,status:'failed',stages:[],error:{code:error.killed?'benchmark-worker-timeout':'benchmark-worker-failed'}});}}
  }
  const identical=variants.length<2?null:['factsSha256','profileSha256','scenariosSha256','sourceBundleSha256'].every(key=>variants[0].inputs?.[key]&&variants[0].inputs[key]===variants[1].inputs?.[key]);
  const report={schemaVersion:1,kind:options.summaryOnly?'existing-private-report-preparation-summary':'local-production-runtime-mock-benchmark',status:variants.every(v=>v.status==='completed')&&identical!==false?'completed':'needs-review',
    startedAt,finishedAt:new Date().toISOString(),realApiCalls:0,identicalInputsAcrossVariants:identical,
    environment:{node:process.version,platform:process.platform,arch:process.arch,logicalCpus:os.availableParallelism?.()||os.cpus().length,
      eventLoopResolutionMs:1,isolatedProcessPerVariant:true,variantOrder:variants.map(v=>v.variant),forcedGc:false},variants,
    measurementDefinitions:{prepareMs:'Production trigger to provider dispatch.',contextMs:'Production prompt-log duration from context start through selected evidence composition.',
      factSelectionMs:'Production material diagnostics: fact-card selection only; unavailable on the frozen baseline.',
      contextBuildMs:'Production material diagnostics: context start through evidence selection plus final prompt/window preparation; unavailable on the frozen baseline.',
      afterEvidenceContextMs:'contextBuildMs minus prompt-log contextMs. Includes system/current-turn assembly and final budget work; not an isolated budget timer.',
      outsideContextBuildMs:'prepareMs minus contextBuildMs. Includes planning, setup and dispatch-related residual work; not an isolated planner timer.',
      firstTimerLatenessMs:'Lateness of the first scheduled 1ms timer across each measured phase. Complements the event-loop histogram when its sampling anchor misses an initial synchronous block.'},
    existingReportPreparation:options.summaryReports.map(file=>reportPreparationSummary(readJson(file,256*1024*1024))),
    limitations:['Finite local sample; no claim of stable service-level attainment.',
      'Cold means a fresh Node/production VM and fresh private material import. OS disk/page caches are not flushed; execution order can affect caches.',
      'First workload pass and matched warm replay contain identical events and questions. The first pass is not 80 independent cold process launches; later questions already benefit from earlier production work.',
      'Warm replay means an initialized index and the same material instance, not guaranteed cache hits for every query; bounded query caches can evict earlier entries during a full-suite replay.',
      'prepareMs is production trigger-to-provider dispatch, while contextMs and promptPrepareMs come from production prompt logs. Missing measurements remain null.',
      'The SDK is replaced with a fixed local stream. Network, real TTFT, model generation, ASR, Electron painted pixels and a physical Windows device are not measured.',
      'CPU and heap include VM/harness observation overhead. Large observation copies are released after each question without changing production conversation memory or material caches; GC is natural and its timing can move between phases.',
      'Heap peak is sampled after questions and at phase boundaries, not a continuous allocation peak. RSS need not return to its initial value after disposal.',
      'Event-loop histograms use 1ms resolution and include explicit 2ms diagnostic yielding after each question; they are not per-question latency percentiles.',
      'No prompts, answers, dialogue text, private fact cards, person names, or input paths are saved in the aggregate report.']};
  write(path.join(options.outputDir,'summary.json'),report);write(path.join(options.outputDir,'summary.md'),markdown(report));
  process.stdout.write('Anonymous aggregate report: '+path.join(options.outputDir,'summary.json')+'\n');return report.status==='completed'?0:1;
}
if(require.main===module)main().then(code=>process.exit(code)).catch(()=>{process.stderr.write('Local benchmark failed; no private data or credentials are logged.\n');process.exit(1);});
module.exports={argumentsFor,distribution,summarizeRows,reportPreparationSummary,worker,main};
