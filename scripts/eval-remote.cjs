#!/usr/bin/env node
'use strict';

// GitHub receives ciphertext only. No input branch is checked out or executed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {setTimeout:pause} = require('node:timers/promises');
const cipher = require('./lib/private-live-crypto.cjs');
const {resolveProfile, buildTasks} = require('./lib/evaluation-profiles.cjs');
const {validateScenarios, validateEvaluation} = require('./evaluate-multiturn-projects.cjs');
const {validateEvaluationWorkspace, projectJudgeReference} = require('./lib/evaluation-workspace.cjs');
const execute = promisify(execFile);
const WORKFLOW = 'project-deep-live.yml', INPUT_BRANCH = 'cue-evaluation-inputs';
const ROOT = path.resolve(__dirname, '..');
function save(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {mode:0o600}); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, {force:true}); }
}
function read(file, maximum = cipher.MAX_INPUT_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Invalid or oversized local evaluation file.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function parseArgs(args) {
  const options = {profile:'smoke', provider:'all', pollMs:5000, waitMs:8*60*60*1000, discoverModels:false, detach:false};
  const names = {'--payload':'payloadFile','--judge-reference':'judgeReferenceFile','--scenarios':'scenarioFile','--profile':'profile','--provider':'provider','--application':'applicationCommit',
    '--output-dir':'outputDir','--resume':'resumeFile','--repository':'repository','--imports':'importsFile','--shards':'shards','--only-shard':'onlyShard','--repeats':'repeats','--concurrency':'concurrency',
    '--retry-limit':'retryLimit','--poll-ms':'pollMs','--wait-ms':'waitMs','--label':'label','--output-ceiling':'outputCeiling','--timeout-ms':'timeoutMs','--source-snapshot':'sourceSnapshot'};
  for (let index=0; index<args.length; index++) {
    const key=args[index];
    if (key==='--discover-models') options.discoverModels=true;
    else if (key==='--publish-readable') options.publishReadable=true;
    else if (key==='--judge') options.judge=true;
    else if (key==='--dynamic') options.dynamic=true;
    else if (key==='--detach') options.detach=true;
    else if (key==='--help' || key==='-h') options.help=true;
    else if (names[key] && args[index+1] && !args[index+1].startsWith('--')) options[names[key]]=args[++index];
    else throw new Error('Unknown remote evaluation argument. Use --help.');
  }
  for (const [key,min,max] of [['shards',1,100],['onlyShard',0,99],['repeats',1,20],['concurrency',1,4],['retryLimit',0,3],['pollMs',100,60000],['waitMs',1000,86400000],['outputCeiling',1,16384],['timeoutMs',60000,120000]]) {
    if (options[key]===undefined) continue;
    options[key]=Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key]<min || options[key]>max) throw new Error('Invalid remote evaluation '+key+'.');
  }
  if (!['smoke','regression','deep','stress'].includes(options.profile) || !['all','qwen','deepseek'].includes(options.provider)) throw new Error('Invalid remote evaluation profile/provider.');
  if (options.repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) throw new Error('Invalid GitHub repository.');
  if(options.onlyShard!==undefined&&options.shards===undefined)throw new Error('--only-shard requires the explicit original --shards partition count.');
  return options;
}
function preparePayload(options) {
  const uploaded=read(options.payloadFile);
  if(uploaded?.schemaVersion===3){
    options.shards??=1;
    if(options.shards!==1||options.scenarioFile||options.judgeReferenceFile||options.dynamic||options.applicationCommit||options.sourceSnapshot||options.repeats!==undefined)throw new Error('Judge recovery accepts one prepared partition without generation options.');
    return require('./lib/judge-recovery.cjs').validateRecoveryPayload(uploaded);
  }
  if(Object.keys(uploaded).some(key=>!['schemaVersion','facts','profile','revision','sourceManifest','mergeLog','scenarios','evaluation'].includes(key)))throw new Error('Invalid evaluation workspace fields.');
  const {scenarios:embeddedScenarios,evaluation:embeddedEvaluation,...workspaceData}=uploaded;
  const workspace=validateEvaluationWorkspace(workspaceData),sourceProfile=workspace.profile||{};
  if(sourceProfile.activeJobProfileId&&sourceProfile.activeJobProfile&&sourceProfile.activeJobProfileId!==sourceProfile.activeJobProfile)throw new Error('Conflicting active job profiles.');
  const profile=Object.fromEntries(['resumeText','jobDescription','jobProfiles','candidateProfile'].filter(key=>sourceProfile[key]!==undefined).map(key=>[key,sourceProfile[key]]));
  const activeJobProfileId=sourceProfile.activeJobProfileId||sourceProfile.activeJobProfile;
  if(activeJobProfileId!==undefined)profile.activeJobProfileId=activeJobProfileId;
  const payload={schemaVersion:2,facts:workspace.facts,profile,revision:workspace.revision,
    scenarios:options.scenarioFile?read(options.scenarioFile):embeddedScenarios,evaluation:embeddedEvaluation||{}};
  if(options.importsFile)payload.imports=require('./lib/evaluation-imports.cjs').validateImports(read(options.importsFile));
  for (const name of ['sourceManifest','mergeLog']) if (workspace[name] !== undefined) payload[name]=workspace[name];
  if (options.judgeReferenceFile) payload.judgeReference=projectJudgeReference(read(options.judgeReferenceFile));
  if (!payload.facts || !payload.profile || !payload.scenarios) throw new Error('A workspace payload and multi-turn scenarios are required.');
  const config={...(payload.evaluation||{}), profile:options.profile, shardCount:options.shards??1, shardIndex:0};
  for (const name of ['applicationCommit','repeats','concurrency','retryLimit','label','judge','outputCeiling','timeoutMs','sourceSnapshot','dynamic']) if (options[name]!==undefined) config[name]=options[name];
  validateScenarios(payload.scenarios); validateEvaluation(config);
  const providers=options.provider==='all'?['qwen','deepseek']:[options.provider];
  const allTasks=buildTasks(payload.scenarios.sessions,resolveProfile({...config,shardCount:1,shardIndex:0},providers.length),providers);
  const answerCount=config.audioFixture?providers.length*2:config.dynamic
    ? allTasks.length*((typeof config.dynamic==='object'?config.dynamic.turns:6)||6)+allTasks.length
    : allTasks.reduce((n,task)=>n+task.session.events.filter(event=>event.invoke_cue).length,0);
  const target=config.judge?60:120;
  options.shards??=Math.max(1,Math.min(100,allTasks.length,Math.ceil(answerCount/target)));
  if(config.audioFixture&&options.shards!==1||options.shards>allTasks.length)throw new Error('Selected shards would create empty or unsupported evaluation partitions.');
  config.shardCount=options.shards;
  if(options.onlyShard!==undefined&&(options.onlyShard>=options.shards||config.audioFixture))throw new Error('Selected recovery shard is outside the original partition plan.');
  const shardAnswers=Array.from({length:options.shards},(_,shardIndex)=>{
    const assigned=buildTasks(payload.scenarios.sessions,resolveProfile({...config,shardIndex},providers.length),providers);
    return config.audioFixture?providers.length*2:config.dynamic?assigned.length*((typeof config.dynamic==='object'?config.dynamic.turns:6)||6)+assigned.length
      :assigned.reduce((n,task)=>n+task.session.events.filter(event=>event.invoke_cue).length,0);
  });
  options.workloadPlan={generationAnswers:answerCount,shards:options.shards,maximumAnswersPerShard:Math.max(...shardAnswers),
    automaticTargetAnswersPerShard:target,judges:!!config.judge,
    note:'Finite workload planning; provider slowdowns and retries remain bounded and recoverable.'};
  if(options.onlyShard!==undefined)Object.assign(options.workloadPlan,{generationAnswers:shardAnswers[options.onlyShard],dispatchedShards:1,onlyShard:options.onlyShard,
    note:'One explicit original partition; use only after checking which original calls completed.'});
  const evaluationProfile=resolveProfile(config,options.provider==='all'?2:1);
  if (!buildTasks(payload.scenarios.sessions,evaluationProfile,options.provider==='all'?['qwen','deepseek']:[options.provider]).length) throw new Error('The selected shard has no sessions.');
  payload.evaluation=config;
  if (Buffer.byteLength(JSON.stringify(payload))>cipher.MAX_INPUT_BYTES) throw new Error('Evaluation payload is too large.');
  return payload;
}
class Github {
  constructor(repository) { this.repository=repository; }
  async command(args, input) {
    try {
      const {stdout}=await execute('gh',args,{cwd:ROOT,maxBuffer:cipher.MAX_ENVELOPE_BYTES+1024*1024,input,timeout:120000});
      return stdout;
    } catch { throw new Error('GitHub operation failed; verify gh authentication, repository access, and retry with --resume.'); }
  }
  async api(endpoint, method='GET', body) {
    // Use stdin via an unguessable private temporary file: execFile has no stdin option.
    let file;
    try {
      const args=['api',endpoint,'--method',method];
      if (body!==undefined) {
        file=path.join('/tmp','cue-remote-api-'+crypto.randomBytes(12).toString('hex')+'.json'); save(file,body);
        args.push('--input',file);
      }
      const value=await this.command(args); return value.trim()?JSON.parse(value):null;
    } finally { if(file) fs.rmSync(file,{force:true}); }
  }
  async artifacts(runId) { return (await this.api(`repos/${this.repository}/actions/runs/${runId}/artifacts?per_page=100`)).artifacts || []; }
  async download(runId,name,directory) {
    fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
    const staging=fs.mkdtempSync(path.join(path.dirname(directory),'.cue-download-'));
    try {
      await this.command(['run','download',String(runId),'--repo',this.repository,'--name',name,'--dir',staging]);
      // gh refuses existing artifact files. Replace only this cached artifact
      // after a complete fresh download, so --resume works after decode errors.
      fs.rmSync(directory,{recursive:true,force:true});fs.renameSync(staging,directory);
    } finally { fs.rmSync(staging,{recursive:true,force:true}); }
  }
  async publish(runId,envelope) {
    const endpoint=`repos/${this.repository}/contents/${runId}.json`;
    let sha;
    try { sha=(await this.api(endpoint+'?ref='+INPUT_BRANCH)).sha; } catch { /* New run file. */ }
    try { await this.api(`repos/${this.repository}/git/ref/heads/${INPUT_BRANCH}`); }
    catch {
      const main=await this.api(`repos/${this.repository}/git/ref/heads/main`);
      try { await this.api(`repos/${this.repository}/git/refs`,'POST',{ref:'refs/heads/'+INPUT_BRANCH,sha:main.object.sha}); }
      catch { await this.api(`repos/${this.repository}/git/ref/heads/${INPUT_BRANCH}`); }
    }
    for(let attempt=0;attempt<4;attempt++) {
      try {await this.api(endpoint,'PUT',{message:`Encrypted evaluation input for run ${runId}`,branch:INPUT_BRANCH,
        content:Buffer.from(JSON.stringify(envelope)+'\n').toString('base64'),...(sha?{sha}:{})});return;}
      catch(error) {if(attempt===3)throw error;await pause(250*(2**attempt));try {sha=(await this.api(endpoint+'?ref='+INPUT_BRANCH)).sha;}catch{/* New file; retry branch contention. */}}
    }
  }
}
async function until(check,{deadline,pollMs,pauseImpl=pause}) {
  while(Date.now()<deadline) { const result=await check(); if(result) return result; await pauseImpl(Math.min(pollMs,Math.max(1,deadline-Date.now()))); }
  throw new Error('Remote evaluation wait expired. Run the same command with --resume and the saved manifest.');
}
function verifySession(session,state,run,{allowExpired=false}={}) {
  cipher.validateSession(session,{allowExpired});
  if (session.repository!==state.repository || session.runId!==String(run.runId) || session.runAttempt!==String(run.runAttempt) || session.commitSha!==state.trustedSha) throw new Error('Session does not match the dispatched trusted main SHA/run/attempt.');
  return session;
}
async function runRemote(options,{github,log=message=>process.stdout.write(message+'\n'),pauseImpl=pause}={}) {
  let state,manifest;
  if(options.resumeFile) {
    manifest=path.resolve(options.resumeFile);state=read(manifest,cipher.MAX_REPORT_BYTES);
    if(state.schemaVersion!==1 || state.kind!=='cue-remote-evaluation' || !/^[a-f0-9]{40}$/.test(state.trustedSha) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(state.repository) || !Array.isArray(state.runs)) throw new Error('Invalid remote resume manifest.');
    options={...state.options,...options,provider:state.options.provider,profile:state.options.profile,shards:state.options.shards};
  } else {
    if(!options.payloadFile) throw new Error('--payload is required for a new evaluation.');
    const client=github||new Github(options.repository);
    const repository=options.repository||(await client.command(['repo','view','--json','nameWithOwner','--jq','.nameWithOwner'])).trim();
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
    client.repository=repository;github=client;
    const trustedSha=(await github.api(`repos/${repository}/git/ref/heads/main`)).object.sha;
    const tag='cue-'+Date.now()+'-'+crypto.randomBytes(5).toString('hex');
    const directory=path.resolve(options.outputDir||path.join(ROOT,'.cue-private','eval-remote',tag));
    fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
    manifest=path.join(directory,'resume.json');
    const payload=preparePayload(options);save(path.join(directory,'payload.json'),payload);
    state={schemaVersion:1,kind:'cue-remote-evaluation',repository,trustedSha,tag,directory,createdAt:new Date().toISOString(),options:{...options,payloadFile:undefined,scenarioFile:undefined,judgeReferenceFile:undefined,importsFile:undefined},runs:Array.from({length:options.shards},(_,index)=>({shardIndex:index,tag:tag+'-s'+index,stage:'pending'})).filter(run=>options.onlyShard===undefined||run.shardIndex===options.onlyShard)};
    save(manifest,state);
  }
  github ||= new Github(state.repository);
  const deadline=Date.now()+options.waitMs;
  const wait=check=>until(check,{deadline,pollMs:options.pollMs,pauseImpl});
  log('Private resume manifest: '+manifest);
  if(state.options.workloadPlan)log('Evaluation workload: '+JSON.stringify(state.options.workloadPlan));
  const pendingFeeds=[],feedWaiters=[];let activeFeeds=0;
  async function scheduledFeed(run) {
    if(activeFeeds>=4)await new Promise(resolve=>feedWaiters.push(resolve));
    activeFeeds++;
    try {await feed(run);}finally {activeFeeds--;feedWaiters.shift()?.();}
  }
  // Every dispatch checks the same trusted SHA. Feed its session immediately:
  // discovering later shards can outlast the first runner's bounded input wait.
  for(const run of state.runs) {
    if(!run.runId) {
      // Store correlation before dispatch. A crash after dispatch finds the same run.
      if(!run.dispatchStartedAt) {run.dispatchStartedAt=new Date().toISOString();save(manifest,state);}
      const find=async()=>{
        const result=await github.api(`repos/${state.repository}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=100`);
        return (result.workflow_runs||[]).filter(item=>item.head_sha===state.trustedSha && item.display_title===`Private project evaluation ${run.tag}` && Date.parse(item.created_at)>=Date.parse(run.dispatchStartedAt)-1000).sort((a,b)=>b.id-a.id)[0];
      };
      let found=await find();
      if(!found) {
        const current=(await github.api(`repos/${state.repository}/git/ref/heads/main`)).object.sha;
        if(current!==state.trustedSha) throw new Error('Trusted main changed before dispatch. Start a new evaluation to bind its new SHA.');
        await github.api(`repos/${state.repository}/actions/workflows/${WORKFLOW}/dispatches`,'POST',{ref:'main',inputs:{mode:options.profile,provider:options.provider,request_tag:run.tag,discover_models:String(!!options.discoverModels),publish_readable_reports:String(!!options.publishReadable)}});
        found=await wait(find);
      }
      run.runId=String(found.id);run.runAttempt=String(found.run_attempt||1);run.url=found.html_url;run.stage='dispatched';save(manifest,state);
      log(`Shard ${run.shardIndex+1}/${state.runs.length}: ${run.url}`);
    }
    pendingFeeds.push(scheduledFeed(run).then(()=>({status:'fulfilled'}),reason=>({status:'rejected',reason})));
  }
  async function feed(run) {
    const directory=path.join(state.directory,'shard-'+run.shardIndex);fs.mkdirSync(directory,{recursive:true,mode:0o700});
    if(['decrypted','no-report'].includes(run.stage)) return;
    if(!['uploaded','completed'].includes(run.stage)) {
      const artifact=await wait(async()=>{
        const artifacts=await github.artifacts(run.runId);const result=artifacts.find(item=>item.name===`private-session-${run.runId}-${run.runAttempt}`&&!item.expired);
        if(result)return result;
        const status=await github.api(`repos/${state.repository}/actions/runs/${run.runId}`);
        if(status.status==='completed') throw new Error('Workflow ended before publishing an encryption session. Inspect the run and resume a new evaluation.');
        return null;
      });
      const sessionDir=path.join(directory,'session');await github.download(run.runId,artifact.name,sessionDir);
      const session=verifySession(read(path.join(sessionDir,'session.json'),16384),state,run);
      const keyFile=path.join(directory,'local-key.json'),envelopeFile=path.join(directory,'input.encrypted.json');
      let envelope;
      if(fs.existsSync(keyFile)&&fs.existsSync(envelopeFile)) {
        const local=read(keyFile,16384);envelope=read(envelopeFile,cipher.MAX_ENVELOPE_BYTES);
        if(local.fingerprint!==session.fingerprint||envelope.fingerprint!==session.fingerprint) throw new Error('Saved ciphertext belongs to a different workflow attempt. Start a new evaluation.');
      } else {
        const payload=read(path.join(state.directory,'payload.json'));payload.evaluation.shardIndex=run.shardIndex;
        const encrypted=cipher.encryptPayload({session,payload});envelope=encrypted.envelope;
        save(keyFile,{schemaVersion:1,fingerprint:session.fingerprint,key:encrypted.key.toString('base64')});encrypted.key.fill(0);save(envelopeFile,envelope);
      }
      await github.publish(run.runId,envelope);run.stage='uploaded';run.fingerprint=session.fingerprint;save(manifest,state);
    }
  }
  const fed=await Promise.all(pendingFeeds);
  const failedFeed=fed.find(value=>value.status==='rejected');if(failedFeed)throw failedFeed.reason;
  if(options.detach) return {state,manifest};
  for(const run of state.runs) {
    if(run.stage==='decrypted')continue;
    const directory=path.join(state.directory,'shard-'+run.shardIndex);
    const completed=await wait(async()=>{const value=await github.api(`repos/${state.repository}/actions/runs/${run.runId}`);return value.status==='completed'?value:null;});
    if(String(completed.run_attempt||1)!==run.runAttempt||completed.head_sha!==state.trustedSha) throw new Error('Workflow attempt or trusted SHA changed; saved response key cannot be reused.');
    run.stage='completed';run.conclusion=completed.conclusion;save(manifest,state);
    const artifact=await wait(async()=>(await github.artifacts(run.runId)).find(item=>item.name===`private-live-${run.runId}-${run.runAttempt}`&&!item.expired));
    const artifactDir=path.join(directory,'encrypted');await github.download(run.runId,artifact.name,artifactDir);
    if(!fs.existsSync(path.join(artifactDir,'report.encrypted.json'))) {
      const summaryFile=path.join(artifactDir,'summary.json');
      const summary=fs.existsSync(summaryFile)?read(summaryFile,1024*1024):{};
      run.stage='no-report';run.failure={code:'no-encrypted-report',reportedError:summary.error?.code||null,
        noInferenceVerified:summary.runId===run.runId&&summary.commitSha===state.trustedSha&&summary.reportEncrypted===false&&summary.attemptedCalls===0};
      save(manifest,state);log(`Shard ${run.shardIndex+1}: no encrypted report; input/API status preserved in the private manifest.`);continue;
    }
    const session=read(path.join(directory,'session','session.json'),16384),local=read(path.join(directory,'local-key.json'),16384);
    // Input expiry prevents late uploads. An authenticated archived response
    // can still be opened with its original private key after that window.
    verifySession(session,state,run,{allowExpired:true});
    if(local.fingerprint!==session.fingerprint || run.fingerprint!==session.fingerprint) throw new Error('Saved response key does not match the session.');
    const key=cipher.bytes64(local.key,32);let reports;
    try {reports=cipher.decryptReports({session,key,envelope:read(path.join(artifactDir,'report.encrypted.json'),cipher.MAX_ENVELOPE_BYTES)});} finally {key.fill(0);}
    const plainDir=path.join(directory,'reports');save(path.join(plainDir,'report.json'),reports.report);
    fs.writeFileSync(path.join(plainDir,'report.md'),String(reports.markdown||''),{mode:0o600});
    for(const [name,value] of Object.entries(reports.artifacts||{})) {
      if(!/^(?:judge-checkpoint|manual-review-queue|dynamic-[a-f0-9]{24})\.json$/.test(name))throw new Error('Encrypted report contains an invalid auxiliary data filename.');
      save(path.join(plainDir,name),value);
    }
    run.stage='decrypted';run.reportPath=path.join(plainDir,'report.json');run.status=reports.report.status;run.summary=reports.report.summary||null;save(manifest,state);
    log(`Shard ${run.shardIndex+1}: ${run.status}; private report ${run.reportPath}`);
  }
  if(state.runs.some(run=>!run.reportPath)) {
    state.status='incomplete';save(manifest,state);
    throw new Error('Some workflow runs produced no encrypted report. Available artifacts and zero-inference evidence were collected; inspect the saved manifest before retrying.');
  }
  if(state.runs.every(run=>run.stage==='decrypted')) {
    const reports=state.runs.map(run=>read(run.reportPath,cipher.MAX_REPORT_BYTES));
    const {writeReports}=require('./lib/live-evaluation-report.cjs');
    const providers=[...new Set(reports.flatMap(report=>(report.providers||[]).map(p=>p.id)))].map(id=>{
      const entries=reports.flatMap(r=>(r.providers||[]).filter(p=>p.id===id)),models=[...new Set(entries.map(p=>p.model).filter(Boolean))];
      return{...(entries.length===1?entries[0]:{}),id,model:models.length===1?models[0]:models.length?'mixed':null,models,status:entries.every(p=>p.status==='passed')?'passed':'failed',attemptedCalls:entries.reduce((n,p)=>n+(p.attemptedCalls||0),0),expectedCaseCount:entries.reduce((n,p)=>n+(p.expectedCaseCount||p.cases?.length||0),0),cases:entries.flatMap(p=>p.cases||[])};
    });
    const attemptedCalls=reports.reduce((n,r)=>n+(r.budget?.attemptedCalls||0),0);
    const callsByProvider=Object.fromEntries(providers.map(p=>[p.id,reports.reduce((n,r)=>n+(r.budget?.callsByProvider?.[p.id]||0),0)]));
    const merged={...reports[0],status:reports.every(r=>r.status==='passed')?'passed':'failed',finishedAt:new Date().toISOString(),providers,failures:reports.flatMap(r=>r.failures||[]),evaluation:{...reports[0].evaluation,shardIndex:null,shardCount:reports.length,expectedQuestionCount:reports.reduce((n,r)=>n+(r.evaluation?.expectedQuestionCount||0),0)},budget:{...reports[0].budget,maxCalls:reports.reduce((n,r)=>n+(r.budget?.maxCalls||0),0),maxCallsPerProvider:reports.reduce((n,r)=>n+(r.budget?.maxCallsPerProvider||0),0),callsByProvider,attemptedCalls,shards:reports.length,concurrencyPerShard:reports[0].budget?.concurrency,concurrency:reports.reduce((n,r)=>n+(r.budget?.concurrency||0),0)},shardReports:state.runs.map(run=>({runId:run.runId,runAttempt:run.runAttempt,reportPath:run.reportPath}))};
    if(reports.some(r=>r.dynamicSessions)) {
      merged.dynamicSessions=reports.flatMap(r=>r.dynamicSessions||[]);
      const actors=merged.dynamicSessions.flatMap(s=>s.turns.flatMap(t=>[...(t.candidate?.attempts||[]),...(t.followup?.attempts||[])]));
      const {usageSummary}=require('./judge-private-projects.cjs');
      merged.dynamicActors={...reports[0].dynamicActors,...usageSummary(actors),byRole:['candidate','followup'].map(role=>({role,...usageSummary(actors.filter(a=>a.role===role))}))};
    }
    if(reports.some(r=>r.judging)) {
      merged.judging=require('./judge-private-projects.cjs').summarizeJudging(merged);
      merged.manualReview=require('./lib/multiturn-quality.cjs').createReviewPlan(merged);
    }
    const combined=writeReports(merged,{outputDir:path.join(state.directory,'reports')});
    state.status=combined.status;state.reportPath=path.join(state.directory,'reports','report.json');save(manifest,state);log('Combined private report: '+state.reportPath);
  }
  return {state,manifest};
}
async function main(args=process.argv.slice(2)) {
  const options=parseArgs(args);
  if(options.help) {process.stdout.write('npm run eval:remote -- --payload PRIVATE_WORKSPACE --scenarios PRIVATE_SCENARIOS --profile smoke|regression|deep|stress [--application baseline|current|SHA] [--shards N] [--judge --judge-reference CANONICAL_PRIVATE_WORKSPACE] [--discover-models] [--publish-readable]\nResume: npm run eval:remote -- --resume PRIVATE_RESUME_JSON\n--publish-readable also preserves credential-redacted plaintext reports in Actions artifacts.\n--detach returns after encrypted input upload. Keys and complete reports remain in the private output directory.\n');return 0;}
  const {state}=await runRemote(options);return state.status==='failed'?1:0;
}
if(require.main===module) main().then(code=>process.exit(code)).catch(error=>{process.stderr.write(error.message+'\n');process.exit(1);});
module.exports={Github,parseArgs,preparePayload,verifySession,runRemote,main,WORKFLOW,INPUT_BRANCH};
