#!/usr/bin/env node
'use strict';

// Replay the supplied private event fixtures through the actual package entry
// and production IPC. Only OS/model transport are replaced. No private event
// text, generated answer, or candidate identity is copied into this report.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {createInterviewRuntime,deferred}=require('../test/helpers/interview-agent-runtime');
const {fixture,sourceFixture}=require('../test/helpers/material-fixture');
const ROOT=path.resolve(__dirname,'..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const IDS=['asr-final-revision','asr-final-duplicate','asr-out-of-order','speaker-uncertain','echo-cross-channel','request-cancel','new-session','material-revision','candidate-self-correction','hypothesis-not-fact'];

async function replayOne(input) {
  const cleanups=[],checks=[];
  const app=createInterviewRuntime({after:fn=>cleanups.push(fn)},{settings:{realtimeAnswerMode:'instant'}});
  const check=(name,callback)=>{callback();checks.push({id:name,passed:true});};
  const pending=new Map(),gates=new Map();
  let activeSession,oldRequest,oldSuggestionId,oldEvidenceRevision,materialState,initialFactRevision,initialCandidateProfile;
  try {
    await app.ready;activeSession=(await app.invoke('dialogue:snapshot')).sessionId;
    initialFactRevision=app.snapshot('materialService.snapshot.factRevision');
    initialCandidateProfile=app.snapshot('JSON.stringify(store.getSettings().candidateProfile||null)');
    if(input.id==='material-revision') {
      await app.importMaterialSnapshot({facts:fixture(2),sources:sourceFixture()});
      await app.invoke('dialogue:event',{sessionId:activeSession,eventId:'historical-speech',channel:'you',text:'这是保留来源版本的合成历史发言。'});
      oldEvidenceRevision=(await app.invoke('dialogue:snapshot')).events[0].evidenceRevision;
    }
    let requestNumber=0;
    app.behavior(()=>{
      const current=++requestNumber;
      if(current===1&&(input.id==='request-cancel'||input.id==='material-revision'))return (async function*(){
        yield {choices:[{delta:{content:'SYNTHETIC_INITIAL'}}]};
        const gate=deferred();gates.set('first',gate);await gate.promise;
        yield {choices:[{delta:{content:input.events.find(event=>event.type==='llm_token')?.text||'SYNTHETIC_STALE_COMPLETION'},finish_reason:'stop'}]};
      })();
      return (async function*(){yield {choices:[{delta:{content:'SYNTHETIC_CURRENT_COMPLETION'},finish_reason:'stop'}]};})();
    });
    for(let index=0;index<input.events.length;index++) {
      const event=input.events[index];
      switch(event.type) {
        case 'request_start': {
          const key=event.request_id||'material-request';
          const promise=app.ask('say','解释当前请求的职责边界。');pending.set(key,promise);
          await app.waitForCalls(pending.size);oldRequest||=plain(app.requests.at(-1));
          // Let the first yielded transport token reach the real IPC boundary.
          for(let turn=0;turn<4;turn++)await new Promise(resolve=>setImmediate(resolve));
          oldSuggestionId||=(await app.invoke('dialogue:snapshot')).suggestions.find(item=>item.status==='generating')?.requestId;
          break;
        }
        case 'request_cancel': await app.invoke('llm:cancel');break;
        case 'session_reset': app.clear();activeSession=(await app.invoke('dialogue:snapshot')).sessionId;break;
        case 'materials_commit': {
          const next=fixture(2);next.cards[0].text+=' 新版合成资料。';
          materialState=await app.importMaterialSnapshot({facts:next,sources:sourceFixture()});break;
        }
        case 'background_summary': {
          // CUE has no separate background-summary model. Exercise its actual
          // stale request commit guard, rather than inventing such a subsystem.
          app.value('__fixtureOldRequest='+JSON.stringify(oldRequest));
          const accepted=app.value('conversation.commit(__fixtureOldRequest,"SYNTHETIC_STALE_BACKGROUND")');
          check('old-source-request-commit-rejected',()=>assert.equal(accepted,false));break;
        }
        case 'llm_token': gates.get('first')?.resolve();break;
        default: {
          const speaker=event.speaker||(event.type==='interviewer_final'?'interviewer':'candidate');
          const {session_id:providedSession,...speech}=event;
          await app.invoke('dialogue:event',{...speech,sessionId:activeSession,eventId:event.event_id||'provided-event-'+index,
            speaker,channel:event.channel||(speaker==='interviewer'?'them':'you'),text:event.text,
            revision:event.revision||1,isFinal:event.is_final!==false,at_ms:index*100,source:'provided-fixed-fixture'});
        }
      }
    }
    gates.get('first')?.resolve();await Promise.all(pending.values());
    const snapshot=plain(await app.invoke('dialogue:snapshot',{question:input.events.at(-1)?.text||'刚才发言'}));
    switch(input.id) {
      case 'asr-final-revision':
        check('one-final-version',()=>{assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].revision,2);assert.equal(snapshot.events[0].isFinal,true);assert.equal(snapshot.claims.length,1);});
        check('original-and-normalized-kept',()=>{assert.equal(snapshot.events[0].rawText,input.events[1].text);assert.ok(snapshot.events[0].normalizedText.includes('RabbitMQ'));assert.equal(snapshot.claims[0].correction,true);});break;
      case 'asr-final-duplicate':check('duplicate-final-idempotent',()=>{assert.equal(snapshot.events.length,1);assert.equal(snapshot.claims.length,1);assert.equal(snapshot.revision,1);});break;
      case 'asr-out-of-order':check('late-interim-cannot-replace-final',()=>{assert.equal(snapshot.events[0].text,input.events[0].text);assert.equal(snapshot.events[0].revision,2);assert.equal(snapshot.events[0].isFinal,true);});break;
      case 'speaker-uncertain':check('unknown-role-never-affirmed',()=>{assert.equal(snapshot.events[0].confidence,null);assert.equal(snapshot.claims[0].status,'uncertain');assert.equal(snapshot.events[0].speaker,'unknown');assert.equal(app.snapshot('JSON.stringify(store.getSettings().candidateProfile||null)'),initialCandidateProfile);});break;
      case 'echo-cross-channel':check('echo-never-affirmed-as-candidate',()=>{assert.ok(snapshot.events.every(event=>event.speaker==='unknown'));assert.ok(snapshot.claims.every(claim=>claim.status==='uncertain'));});break;
      case 'request-cancel': {
        const oldToken=input.events.find(event=>event.type==='llm_token').text;
        check('late-token-never-reaches-ui',()=>assert.ok(!app.events.some(event=>event.channel==='llm:token'&&event.text===oldToken)));
        check('occurred-speech-survives-cancel',()=>assert.equal(snapshot.events[0].text,input.events.find(event=>event.type==='candidate_final').text));
        check('canceled-answer-never-committed',()=>{assert.ok(!app.commits.some(commit=>commit.request.id===oldRequest.id&&commit.committed));assert.ok(oldSuggestionId);assert.equal(snapshot.suggestions.find(item=>item.requestId===oldSuggestionId)?.status,'canceled');});break;
      }
      case 'new-session':check('reset-has-no-old-candidate-claims',()=>{assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].speaker,'interviewer');assert.equal(snapshot.claims.length,0);assert.equal(snapshot.suggestions.length,0);});break;
      case 'material-revision':
        check('new-materials-remain-published',()=>assert.equal(app.snapshot('materialService.snapshot.generation'),materialState.generation));
        check('actual-history-keeps-original-evidence-label',()=>{assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].evidenceRevision,oldEvidenceRevision);assert.equal(snapshot.claims[0].evidenceRevision,oldEvidenceRevision);});
        check('stale-completion-never-recorded-as-current',()=>assert.ok(!app.commits.some(commit=>commit.committed&&commit.answer.includes('SYNTHETIC_STALE'))));break;
      case 'candidate-self-correction':check('inline-correction-recognized-and-retained',()=>{assert.equal(snapshot.claims[0].correction,true);assert.equal(snapshot.claims[0].rawText,input.events[0].text);assert.match(snapshot.context.text,/不重复提醒旧口误/);});break;
      case 'hypothesis-not-fact':check('hypothesis-keeps-conditional-scope',()=>{assert.equal(snapshot.claims[0].status,'hypothetical');assert.equal(snapshot.claims[0].modality,'hypothetical');assert.match(snapshot.context.text,/不是项目已实现事实/);assert.equal(app.snapshot('materialService.snapshot.factRevision'),initialFactRevision);});break;
    }
    return {id:input.id,status:'passed',checks,limitations:input.id==='material-revision'?['No independent background-summary model exists; replay observes the production request commit guard.']:[]};
  } catch(error) {return {id:input.id,status:'failed',checks,errorCode:error.code||error.name||'fixture-replay-error'};}
  finally {gates.get('first')?.resolve();await Promise.allSettled(pending.values());for(const cleanup of cleanups.reverse())await cleanup();}
}

async function replay(file,{output}={}) {
  const raw=fs.readFileSync(file),suite=JSON.parse(raw),fixtures=suite.deterministic_event_fixtures;
  if(!Array.isArray(fixtures)||fixtures.length!==IDS.length||IDS.some(id=>fixtures.filter(item=>item.id===id).length!==1))throw new Error('Expected the ten supplied deterministic fixture identities.');
  const report={schemaVersion:1,kind:'production-event-replay',startedAt:new Date().toISOString(),inputSha256:hash(raw),
    fixtureSha256:hash(JSON.stringify(fixtures)),transport:'synthetic LLM; actual package entry, production IPC and state',
    codeSha256:hash(['main.js','src/spoken-claim-ledger.js','src/conversation-memory.js'].map(file=>file+'\0'+fs.readFileSync(path.join(ROOT,file),'utf8')).join('\0')),
    privacy:{containsPrivateText:false},fixtures:[],measurementLimits:['Not an LLM quality score.','No microphone, loopback, ASR socket or physical-window assertions.']};
  for(const item of fixtures)report.fixtures.push(await replayOne(item));
  report.finishedAt=new Date().toISOString();report.passed=report.fixtures.filter(item=>item.status==='passed').length;
  report.status=report.passed===fixtures.length?'passed':'failed';
  if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
  return report;
}
module.exports={replay};
if(require.main===module)(async()=>{const args=process.argv.slice(2);if(!args.includes('--scenarios'))throw new Error('--scenarios is required.');const file=args[args.indexOf('--scenarios')+1],output=args.includes('--output')?args[args.indexOf('--output')+1]:null;if(!file||file.startsWith('--'))throw new Error('--scenarios is required.');const result=await replay(file,{output});console.log(JSON.stringify({status:result.status,passed:result.passed,total:result.fixtures.length,output}));if(result.status!=='passed')process.exitCode=1;})().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
