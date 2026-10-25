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

test('Python multiline constructors keep their body and declared instance calls link to the correct project implementation',()=>{
  const {chunkText}=require('../src/project-chunks'),{buildProjectCodeRelations}=require('../src/project-code-relations'),{hasImplementationBody}=require('../src/project-search');
  const input='class Router:\n    def __init__(\n        self,\n        gate: Gate,\n    ) -> None:\n        self.gate = gate\n\n    def check(self, value):\n        return self.gate.decide(value)\n';
  const gate='class Gate:\n    def decide(self, value):\n        if value:\n            return True\n        return False\n';
  const chunks=[...chunkText('router.py',input).map(c=>({...c,projectId:'one'})),...chunkText('gate.py',gate).map(c=>({...c,projectId:'one'})),...chunkText('gate.py',gate.replace('True','FOREIGN')).map(c=>({...c,projectId:'two'}))];
  const init=chunks.find(c=>c.symbol==='Router#__init__'),caller=chunks.find(c=>c.symbol==='Router#check');
  assert.match(init.text,/self.gate = gate/);assert.equal(caller.fieldTypes.gate,'Gate');
  const edges=buildProjectCodeRelations(chunks).edges.get(chunks.indexOf(caller));
  const edge=edges.find(e=>e.status==='resolved'&&e.method==='decide');assert.ok(edge);assert.equal(chunks[edge.targetId].projectId,'one');assert.equal(edge.toSymbol,'Gate#decide');
  assert.equal(hasImplementationBody({path:'tool.py',text:'class Tool:\n    description = "work with files; return a result if needed"\n'}),false);
  assert.equal(hasImplementationBody(chunks[edge.targetId]),true);
  const java=chunkText('Feed.java','class Feed {\n  int feed() { return one(); }\n  int one() { return 1; }\n}').map(c=>({...c,projectId:'one'}));
  const feed=java.findIndex(c=>c.symbol==='Feed#feed'),related=buildProjectCodeRelations(java).edges.get(feed)||[];
  assert.ok(related.some(e=>e.status==='resolved'&&e.toSymbol==='Feed#one'));
  assert.ok(!related.some(e=>e.status==='resolved'&&e.toSymbol==='Feed#feed'));
});

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

test('a current mechanism question retains its relevant reference through the final budget instead of unrelated USER or inherited intents',()=>{
  const {migrateFactIndex}=require('../src/project-fact-packs');
  const index=migrateFactIndex(fixture(8));
  for(const card of index.cards) {
    card.docType='decision';card.questions=['上线后怎样做治理？'];card.keywords=['上线治理'];
    card.text='合成用户资料：我观察部署指标并复核日志。';card.answerShort=card.text;
  }
  const mechanism=index.cards[6];
  Object.assign(mechanism,{provenance:'REFERENCE',implementation:'unverified_reference',docType:'implementation',
    topic:'可靠投递',questions:['为什么用 DurableRelay，不直接 RPC 调用？','ClaimService 负责什么？'],keywords:['投递设计'],
    text:'合成设计参考：事务保存投递意图，领取者持有租约，重复投递按业务身份去重。'});
  const ownership=index.cards[2];
  Object.assign(ownership,{docType:'ownership',questions:['你负责哪部分？'],keywords:['个人职责'],text:'我负责合成接口模块。'});
  const packs=new ProjectFactPacks({index});
  const resolution={kind:'project',canonicalProjectIds:['cae'],scopes:['@project:cae'],retrieveFacts:true,intent:['overview','ownership','decision']};
  for(const question of ['为什么不直接 RPC 调用？','ClaimService 负责什么？','你负责的 ClaimService 怎样领取消息？']) {
    const selected=packs.select(question+'\n候选人之前说：我负责团队联调。',{resolution,primaryQuestion:question,maxCards:4});
    assert.equal(selected.evidence[0].id,mechanism.cardId);
    const plan=planProjectEvidence({question,resolution,facts:selected.evidence,sourcePolicy:'off',maxSources:1,evidenceTokens:1500});
    assert.deepEqual(plan.evidence.map(row=>row.id),[mechanism.cardId]);
    assert.equal(plan.evidence[0].provenance,'REFERENCE');
  }
  assert.equal(packs.select('你负责哪部分？',{resolution,maxCards:1}).evidence[0].id,ownership.cardId);
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
