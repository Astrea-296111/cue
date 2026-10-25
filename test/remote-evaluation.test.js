'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cipher=require('../scripts/lib/private-live-crypto.cjs');
const {parseArgs,runRemote,verifySession}=require('../scripts/eval-remote.cjs');
const {resolveProfile,buildTasks}=require('../scripts/lib/evaluation-profiles.cjs');
const {validateEvaluation,validateScenarios}=require('../scripts/evaluate-multiturn-projects.cjs');
const {fixture}=require('./helpers/material-fixture');
function suite(){return{schema_version:'cue_multiturn_seed_v1',sessions:Array.from({length:20},(_,i)=>({id:'s'+i,execution_profile:'instant',events:Array.from({length:4},(_,j)=>({event_id:'s'+i+'q'+j,text:'PRIVATE_QUESTION_'+i+'_'+j,speaker:'interviewer',channel:'them',is_final:true,invoke_cue:true}))}))};}
test('deep profile partitions all 480 answers once, preserving sequential sessions and bounded retries',()=>{
 const sessions=suite().sessions;const assignments=[];
 for(let shardIndex=0;shardIndex<6;shardIndex++)assignments.push(...buildTasks(sessions,resolveProfile({profile:'deep',shardCount:6,shardIndex}),['qwen','deepseek']));
 assert.equal(assignments.length,120);assert.equal(assignments.reduce((n,t)=>n+t.session.events.length,0),480);
 assert.equal(new Set(assignments.map(t=>[t.provider,t.repeat,t.session.id].join('/'))).size,120);
 assert.throws(()=>validateEvaluation({baselineRoot:'/tmp/injected'}));assert.throws(()=>validateEvaluation({sourceSnapshot:'/tmp/injected'}));
 assert.throws(()=>resolveProfile({concurrency:5}));assert.throws(()=>resolveProfile({retryLimit:4}));assert.throws(()=>resolveProfile({timeoutMs:120001}));
 assert.equal(validateScenarios(suite()).sessions.length,20);
});
test('remote dispatch uploads ciphertext only, binds session SHA/run/attempt, resumes without duplicate inference, and decrypts locally',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cue-remote-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=path.join(dir,'payload.json'),scenarios=path.join(dir,'scenarios.json'),reference=path.join(dir,'reference.json');
 const facts=fixture(2);facts.cards[0].text='PRIVATE_FACT';
 fs.writeFileSync(input,JSON.stringify({schemaVersion:1,facts,profile:{resumeText:'PRIVATE_RESUME',jobDescription:'PRIVATE_JD'}}));fs.writeFileSync(scenarios,JSON.stringify(suite()));
 fs.writeFileSync(reference,JSON.stringify({schemaVersion:1,facts:fixture(2),profile:{resumeText:'CANONICAL_REFERENCE_SENTINEL',jobDescription:'CANONICAL_JD'}}));
 const repository='example/cue',sha='a'.repeat(40),runId='12345';let dispatched=0,uploaded=0,completed=false,encryptedReport;
 const {session,privateKey}=cipher.createSession({repository,runId,commitSha:sha});
 const calls=[],github={repository,
  async api(endpoint,method='GET',body){calls.push({endpoint,method,body});
   if(endpoint.endsWith('/git/ref/heads/main'))return{object:{sha}};
   if(endpoint.endsWith('/dispatches')){dispatched++;this.tag=body.inputs.request_tag;return null;}
   if(endpoint.includes('/workflows/')&&endpoint.includes('/runs?'))return{workflow_runs:dispatched?[{id:runId,run_attempt:1,head_sha:sha,display_title:'Private project evaluation '+this.tag,created_at:new Date().toISOString(),html_url:'https://github.com/'+repository+'/actions/runs/'+runId}]:[]};
   if(endpoint.endsWith('/actions/runs/'+runId))return{status:completed?'completed':'in_progress',run_attempt:1,head_sha:sha,conclusion:'success'};
   throw new Error('Unexpected API call '+endpoint);
  },
  async artifacts(){return[{name:'private-session-'+runId+'-1'},{name:'private-live-'+runId+'-1'}];},
  async download(id,name,directory){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name.startsWith('private-session')?'session.json':'report.encrypted.json'),JSON.stringify(name.startsWith('private-session')?session:encryptedReport));},
  async publish(id,envelope){uploaded++;assert.equal(id,runId);const serialized=JSON.stringify(envelope);for(const text of ['PRIVATE_FACT','PRIVATE_RESUME','PRIVATE_JD','PRIVATE_QUESTION','CANONICAL_REFERENCE_SENTINEL'])assert.ok(!serialized.includes(text));
   const decoded=cipher.decryptPayload({session,privateKey,envelope});assert.equal(decoded.payload.profile.resumeText,'PRIVATE_RESUME');assert.equal(decoded.payload.evaluation.applicationCommit,'baseline');
   assert.equal(decoded.payload.judgeReference.profile.resumeText,'CANONICAL_REFERENCE_SENTINEL');assert.match(decoded.payload.judgeReference.sha256,/^[a-f0-9]{64}$/);
   encryptedReport=cipher.encryptReports({session,key:decoded.key,reports:{report:{kind:'live',status:'failed',budget:{attemptedCalls:1},providers:[{id:'qwen',model:'actual-model',status:'failed',cases:[{id:'q',answer:'PRIVATE_FULL_ANSWER',status:'failed',attempted:true,transportStatus:'passed',error:{code:'quality'}}]}],failures:[]},markdown:'PRIVATE_FULL_MARKDOWN'}});decoded.key.fill(0);
  }
 };
 const options=parseArgs(['--payload',input,'--judge-reference',reference,'--scenarios',scenarios,'--repository',repository,'--application','baseline','--source-snapshot','baseline','--provider','qwen','--output-dir',path.join(dir,'private-output'),'--detach']);
 const first=await runRemote(options,{github,log:()=>{}});assert.equal(first.state.runs[0].stage,'uploaded');assert.equal(dispatched,1);assert.equal(uploaded,1);
 assert.equal(fs.statSync(first.manifest).mode&0o777,0o600);assert.equal(fs.statSync(path.join(first.state.directory,'shard-0','local-key.json')).mode&0o777,0o600);
 completed=true;const resumed=await runRemote(parseArgs(['--resume',first.manifest]),{github,log:()=>{}});
 assert.equal(dispatched,1);assert.equal(uploaded,1);assert.equal(resumed.state.runs[0].stage,'decrypted');assert.equal(resumed.state.status,'failed');
 assert.equal(JSON.parse(fs.readFileSync(resumed.state.reportPath)).providers[0].cases[0].answer,'PRIVATE_FULL_ANSWER');
 assert.ok(fs.readFileSync(path.join(resumed.state.directory,'shard-0','reports','report.md'),'utf8').includes('PRIVATE_FULL_MARKDOWN'));
 for(const text of ['PRIVATE_FACT','PRIVATE_RESUME','PRIVATE_JD','PRIVATE_QUESTION','PRIVATE_FULL_ANSWER'])assert.ok(!JSON.stringify(calls).includes(text));
 assert.throws(()=>verifySession({...session,commitSha:'b'.repeat(40)},first.state,first.state.runs[0]),/does not match/);
 assert.throws(()=>verifySession({...session,runAttempt:'2'},first.state,first.state.runs[0]),/does not match/);
});
test('workflow exposes secrets only in evaluation and never checks out the encrypted input branch',()=>{
 const file=fs.readFileSync(path.join(__dirname,'../.github/workflows/project-deep-live.yml'),'utf8');
 const evaluation=file.indexOf('- name: Wait for encrypted data and call real providers'),upload=file.indexOf('- name: Upload encrypted answers');
 for(const match of file.matchAll(/\$\{\{\s*secrets\./g))assert.ok(match.index>evaluation&&match.index<upload);
 assert.ok(file.includes('ref: ${{ github.sha }}'));assert.ok(file.includes('9898a05184a8f860411da8e084cd4b1ed22093a6'));assert.ok(!file.includes('ref: cue-evaluation-inputs'));
 assert.ok(file.includes('persist-credentials: false'));assert.ok(!file.includes('GITHUB_TOKEN:'));assert.ok(file.includes('node scripts/private-live-session.cjs evaluate'));
});
