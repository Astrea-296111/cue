'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ProjectSearch}=require('../src/project-search');
const {ProjectFactPacks}=require('../src/project-fact-packs');
const {planProjectEvidence,resolveEvidenceLimits}=require('../src/project-evidence-policy');
const {createInterviewRuntime}=require('./helpers/interview-agent-runtime');
const {fixture}=require('./helpers/material-fixture');
const {requestText}=require('../src/final-request-budget');
const {peekReadyEvidence}=require('../src/instant-ready-evidence');
const {selectEvidence}=require('../src/evidence-selector');

test('expanded source selection rechecks truth and changed source text while sharing token features',()=>{
  const featureCache={questions:new Map(),sources:new Map()};
  const source={id:'source-version',projectId:'cae',path:'src/Dispatch.java',startLine:1,endLine:2,
    kind:'method',truthScope:'implemented',text:'reservation permits resource allocation before dispatch'};
  const input={question:'reservation allocation implementation',projectPlan:{scopes:['@project:cae']},
    candidates:[source],featureCache};
  assert.equal(selectEvidence(input).evidence.length,1);
  assert.equal(selectEvidence({...input,candidates:[{...source,truthScope:'hypothetical'}]}).evidence.length,0);
  assert.equal(selectEvidence({...input,candidates:[{...source,text:'unrelated setup logging'}]}).evidence.length,0);
  assert.equal(selectEvidence({...input,question:'unrelated setup logging implementation'}).evidence.length,0);
});

test('prepared source lookup is scoped and bounded without scanning or calling a model provider',()=>{
  const chunks=Array.from({length:40},(_,i)=>({id:'s'+i,projectId:i%2?'cae':'arclight',path:'src/Outbox'+i+'.java',text:'Outbox transaction event retry recovery '+i}));
  const index=ProjectSearch.build(chunks,{vectorProvider:{ready:true,search(){throw Error('must not call embedding');}}});
  index.scopedIds=()=>{throw Error('must not scan the source array');};
  const result=index.lookupPrepared('Outbox retry recovery',['@project:cae'],{limit:8,maxPostings:25});
  assert.ok(result.rows.length&&result.rows.length<=8);assert.ok(result.postingsVisited<=25);
  assert.ok(result.rows.every(row=>row.chunk.projectId==='cae'));
  assert.equal(index.embeddings.filter(Boolean).length,0);
});

test('fact and source budgets preserve multiple actual asks instead of unrelated broad intents',()=>{
  const index=fixture(8);let i=0;
  for(const card of index.cards){card.docType='implementation';card.keywords=['background'];card.text='Synthetic unrelated background '+i++;}
  const own=index.cards.filter(card=>card.projectId==='cae');
  for(const [n,topic]of ['Outbox','Inbox','取消竞态','资源预占'].entries()){own[n].keywords=[topic];own[n].text=topic+' 的实现与可验证边界。';}
  const packs=new ProjectFactPacks({index}),question='CAE Outbox如何恢复？Inbox怎样处理幂等？取消竞态如何防止终态回退？';
  const resolution={kind:'project',canonicalProjectIds:['cae'],scopes:['@project:cae'],intent:['implementation','performance'],retrieveFacts:true};
  const selected=packs.select(question,{resolution,maxCards:4});
  for(const card of own.slice(0,3))assert.ok(selected.evidence.some(item=>item.id===card.cardId));
  assert.ok(selected.evidence.every(item=>item.projectId==='cae'));
  const source={id:'state-code',sourceType:'imported',projectId:'cae',path:'src/state.js',startLine:1,endLine:1,text:'取消竞态：终态不会回退，状态转换由 CAS 校验。'};
  const limits=resolveEvidenceLimits({question,answerPlan:{questionCount:3},instant:true});
  const plan=planProjectEvidence({question,resolution,facts:selected.evidence,sources:[source],...limits});
  assert.ok(plan.evidence.some(item=>item.id===source.id));
  assert.ok(plan.evidence.length<=6&&plan.estimatedTokens<=2400);
});

test('a cold conversational cache can attach prepared source to a full >1600-character instant question; source off performs no lookup',async t=>{
  const question=require('../evaluation/deep-projects/cases.json').cases.find(item=>item.id==='deep-cae-uncertain-followup').question;
  assert.ok(question.length>1600);
  const source={id:'execution-code',projectId:'cae-code',projectName:'CAE',path:'src/execution.js',startLine:1,endLine:2,docType:'implementation',truthScope:'implemented',status:'confirmed',
    text:'PREPARED_EXECUTION ExecutionDispatchService submit query Execution executionId Job CPU License UNKNOWN CANCELING SUCCEEDED\n提交超时保持执行身份，由 query 和对账确认状态，取消竞态通过状态机校验终态，资源预占不会因为响应丢失而释放。'};
  const r=createInterviewRuntime(t,{indexSnapshot:{version:2,projects:[{id:'cae-code',name:'cae-job-platform',stats:{fileCount:1,chunkCount:1}}],chunks:[source],stats:{fileCount:1,chunkCount:1}},
    settings:{realtimeAnswerMode:'instant',sourceRagPolicies:{instant:'ready-only'},manualProjectKnowledgeEnabled:false}});
  const preview=await r.invoke('materials:prepare',{index:fixture(),mode:'replace-all'});await r.invoke('materials:commit',preview);
  await r.exports('src/project-knowledge.js').warmProjectIndex();
  await r.ask('say',question);
  const body=requestText(r.calls.at(-1));
  assert.ok(body.includes(question));assert.ok(body.includes('PREPARED_EXECUTION'));
  const sent=r.events.filter(event=>event.channel==='llm:materials').at(-1);assert.ok(sent.sentSourceIds.includes(source.id));
  assert.equal(r.searches.length,0);
  await r.invoke('settings:set',{sourceRagPolicies:{instant:'off'}});
  const disabled=peekReadyEvidence({policy:'off',projectIndexSnapshot:{lookup(){throw Error('source off must not call prepared lookup');}}});
  assert.equal(disabled.stats.searchCalls,0);
  await r.ask('say','CAE 资源预占如何处理？');
  assert.equal(r.events.filter(event=>event.channel==='llm:materials').at(-1).sentSourceIds.length,0);
});
