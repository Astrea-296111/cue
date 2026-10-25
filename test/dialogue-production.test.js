'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DialogueStore } = require('../src/spoken-claim-ledger');
const { buildInstantContext } = require('../src/instant-answer-context');
const { prepareFinalRequest, requestText } = require('../src/final-request-budget');
const { createInterviewRuntime, currentText, deferred } = require('./helpers/interview-agent-runtime');
const {fixture,sourceFixture} = require('./helpers/material-fixture');

const plain = value => JSON.parse(JSON.stringify(value));

test('whole interview TXT keeps both speakers, corrections and distinct suggestions beyond ledger eviction and session reset',async t=>{
  const app=createInterviewRuntime(t,{settings:{saveInterviewTranscript:true,apiKeys:{custom:'SYNTHETIC_SETTINGS_SECRET'}}});await app.ready;
  app.value('dialogue.maxEvents = 3');
  app.interim('尚未确认的识别草稿');
  const first=app.final('合成面试问题：为什么要固定输入版本？');
  app.candidate('我会先保留输入版本，再开始执行。');
  const snapshot=plain(await app.invoke('dialogue:snapshot')),candidate=snapshot.events.find(e=>e.speaker==='candidate');
  await app.invoke('dialogue:correct',{sessionId:snapshot.sessionId,eventId:candidate.eventId,text:'我会保存快照并核对内容指纹。',speaker:'candidate'});
  app.answer('这是单独标注的合成 CUE 建议。');await app.ask('say','手动输入的另一个合成问题？');
  for(let i=0;i<5;i++)app.candidate('后续合成发言 '+i+'。');
  const saved=await app.invoke('dialogue:recording:flush'),directory=path.join(app.temp,'interview-records');
  const original=path.join(directory,saved.fileName),body=fs.readFileSync(original,'utf8');
  assert.match(body,/面试官/);assert.match(body,/为什么要固定输入版本/);
  assert.match(body,/我会先保留输入版本/);assert.match(body,/修订 · 本人/);assert.match(body,/保存快照并核对内容指纹/);
  assert.match(body,/手动输入的问题（非语音记录）/);assert.match(body,/CUE 建议（未确认说出）/);
  assert.match(body,/后续合成发言 4/);assert.doesNotMatch(body,/尚未确认的识别草稿|SYNTHETIC_SETTINGS_SECRET/);
  assert.equal((await app.invoke('dialogue:snapshot')).events.length,3);
  app.clear();app.candidate('新的面试会话。');const next=await app.invoke('dialogue:recording:flush');
  assert.notEqual(next.fileName,saved.fileName);assert.ok(fs.existsSync(original));
  await app.invoke('settings:set',{saveInterviewTranscript:false});app.candidate('关闭后不写入的发言。');await app.invoke('dialogue:recording:flush');
  const all=fs.readdirSync(directory).map(name=>fs.readFileSync(path.join(directory,name),'utf8')).join('\n');
  assert.doesNotMatch(all,/关闭后不写入的发言/);assert.equal(fs.readdirSync(directory).length,2);
  await app.invoke('settings:set',{saveInterviewTranscript:true});
  app.value("transcriptRecorder.io = {mkdir: fs.promises.mkdir.bind(fs.promises), appendFile: async () => {const error = new Error('disk full'); error.code = 'ENOSPC'; throw error;}};");
  app.candidate('磁盘故障仍保留在当前台账的发言。');const failed=await app.invoke('dialogue:recording:flush');
  assert.equal(failed.error.code,'ENOSPC');assert.match((await app.invoke('dialogue:snapshot')).events.at(-1).text,/磁盘故障/);
});

test('both answer modes give experience-based fallbacks and examples through the real SDK when project details are absent',async t=>{
  for(const mode of ['instant','standard']){
    const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:mode,projectFactsEnabled:false,manualProjectKnowledgeEnabled:false,sourceRagPolicies:{instant:'off',standard:'off'}}});await app.ready;
    app.answer('我会先用一个小例子说明，再解释设计取舍。');await app.ask('say','如果用一个冷门协议做数据同步，你会如何处理重复请求？');
    const actual=app.calls.at(-1).messages.map(m=>m.content||'').join('\n');
    assert.match(actual,/项目事实卡未覆盖当前细节时，仍直接给出面试答案/);
    assert.match(actual,/比如.*输入、处理和结果/);assert.doesNotMatch(actual,/资料不足时只简短指出具体缺口/);
    assert.match(actual,/经验方案和例子不反写成已核实/);
  }
});

test('diagnostics preserve the actual deep request identity after configuration changes and retain the latest failed attempt',async t=>{
  const secret='synthetic-transport-secret',app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'standard',smart:true,models:{custom:{fast:'configured-fast',smart:'actual-deep'}},apiKeys:{custom:secret},activeJobProfileId:'ai_supply_chain',jobDescription:'SYNTHETIC_AI_JD',jobProfiles:[{id:'ai_supply_chain',jobDescription:'SYNTHETIC_AI_JD',priorityTopics:[]},{id:'java_security',jobDescription:'SYNTHETIC_JAVA_JD',priorityTopics:[]}]}});
  app.answer('合成回答 '+secret+'。联系 sample@example.test 或 13800000000。');await app.ask('say','一般解释缓存的取舍。');
  const original=plain(app.value('redactedDiagnostics()'));
  assert.equal(app.calls.at(-1).model,'actual-deep');assert.equal(original.lastActualRequest.model,'actual-deep');assert.equal(original.lastActualRequest.modelIdentitySource,'serialized-request');assert.equal(original.lastActualRequest.provider,'custom');assert.equal(original.lastActualRequest.status,'completed');assert.equal(original.lastActualRequest.dispatched,true);assert.equal(original.lastActualRequest.jobProfileId,'ai_supply_chain');assert.equal(original.lastActualRequest.servedModel,null);assert.deepEqual(original.lastActualRequest.build,original.build);assert.deepEqual(original.lastActualRequest.materials.factRevision,original.materials.factRevision);
  assert.equal(original.lastRequest.actualRequest.requestId,original.lastActualRequest.requestId);assert.equal(original.lastRequest.actualRequest.model,'actual-deep');assert.ok(Number.isFinite(original.lastActualRequest.metrics.prepareMs));
  app.value('store.setSettings({models:{custom:{fast:"later-fast",smart:"later-deep"}},activeJobProfileId:"java_security",jobDescription:"SYNTHETIC_JAVA_JD"})');
  const changed=plain(app.value('redactedDiagnostics()'));assert.equal(changed.configuredModel.fast,'later-fast');assert.equal(changed.configuredModel.smart,'later-deep');assert.equal(changed.jobProfileId,'java_security');assert.deepEqual(changed.lastActualRequest,original.lastActualRequest);assert.equal(changed.model.model,'actual-deep');
  app.answer('',{error:new Error('SYNTHETIC_FAILURE '+secret)});await app.ask('say','一般解释事务的取舍。');
  const failed=plain(app.value('redactedDiagnostics()'));assert.equal(failed.lastActualRequest.status,'failed');assert.equal(failed.lastActualRequest.dispatched,true);assert.equal(failed.lastActualRequest.model,'later-deep');assert.equal(failed.lastActualRequest.jobProfileId,'java_security');assert.notEqual(failed.lastActualRequest.requestId,original.lastActualRequest.requestId);assert.equal(failed.lastRequest.actualRequest.requestId,original.lastActualRequest.requestId);assert.equal(failed.lastActualRequest.errorClass,'Error');
  const serialized=JSON.stringify(failed);for(const privateValue of [secret,'sample@example.test','13800000000','SYNTHETIC_FAILURE','apiKeys'])assert.ok(!serialized.includes(privateValue),privateValue);
});

for(const executionProfile of ['instant','standard'])test(`${executionProfile}: production request preserves hypothetical and question speech labels`,async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:executionProfile}});await app.importMaterialSnapshot({facts:fixture(2),sources:sourceFixture()});
  for(const [eventId,text] of [['actual','CAE 当前用 RabbitMQ 派发任务。'],['hypothesis','如果换成Kafka，我会评估分区键。'],['candidate-question','为什么不用Kafka？']])await app.invoke('dialogue:event',{eventId,channel:'you',speaker:'candidate',text,isFinal:true,revision:1});
  await app.ask('say','CAE 消息队列的分区键怎么选？');const context=app.requests.at(-1).spokenContext,serialized=JSON.stringify(app.calls.at(-1).messages);
  for(const label of ['候选人提出的假设或后续设计，不是项目已实现事实','候选人提出的问题，不当成实现断言']){assert.ok(context.includes(label),label);assert.ok(serialized.includes(label),label);}
});

for(const executionProfile of ['instant','standard']) test(`${executionProfile}: an indexed unique mechanism starts the right project thread without hijacking explicit general questions`,async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:executionProfile}});
  const facts=fixture(2);
  facts.cards[0].keywords.push('Outbox');facts.cards[0].text='合成 CAE 项目用 Outbox 保存持久待发意图，不代表全部外部动作恰好一次。';
  await app.importMaterialSnapshot({facts,sources:sourceFixture()});
  await app.ask('say','Outbox 的事务边界在哪？');
  assert.deepEqual(plain(app.requests.at(-1).plan.canonicalProjectIds),['cae']);
  assert.equal(app.requests.at(-1).plan.reason,'indexed-project-entity');
  app.clear();
  await app.ask('say','先不谈项目，一般讲 Outbox 的机制。');
  assert.equal(app.requests.at(-1).plan.retrieve,false);
  assert.equal(app.requests.at(-1).spokenContext,'');
});

test('speech revisions, final replay, aliases and unknown roles retain the original observation', () => {
  const store = new DialogueStore({sessionId:'unit-session'});
  assert.equal(store.ingest({event_id:'a',channel:'you',text:'卡夫卡 Out box',is_final:false,revision:1,at_ms:0,confidence:0}).accepted,true);
  assert.equal(store.ingest({event_id:'a',channel:'you',text:'卡夫卡 Out box 完成',is_final:true,revision:2,at_ms:0}).accepted,true);
  assert.equal(store.ingest({event_id:'a',channel:'you',text:'较旧草稿',is_final:false,revision:1}).reason,'stale-revision');
  assert.equal(store.ingest({event_id:'a',channel:'you',text:'卡夫卡 Out box 完成',is_final:true,revision:2}).reason,'duplicate');
  assert.equal(store.ingest({event_id:'a',channel:'you',text:'迟到草稿',is_final:false,revision:3}).reason,'final-already-committed');
  const first=store.snapshot().events[0];
  assert.equal(first.startMs,0);
  assert.equal(first.rawText,'卡夫卡 Out box 完成');
  assert.equal(first.normalizedText,'Kafka Outbox 完成');
  assert.equal(store.ingest({eventId:'unknown',channel:'you',speaker:'unknown',text:'测量是281 ms',confidence:0}).event.confidence,0);
  assert.equal(store.ledger.claims.at(-1).status,'uncertain');
  assert.equal(store.ingest({speaker:'assistant',text:'模型建议'}).reason,'not-human-speech');
  assert.equal(store.correct({sessionId:'previous-session',eventId:'unknown',speaker:'candidate'}).reason,'stale-session');
});

for(const channels of [['you','them'],['them','you']]) test(`cross-channel echo is uncertain in ${channels.join(' then ')} arrival order and can be corrected`,()=>{
  const store=new DialogueStore();
  channels.forEach((channel,index)=>store.ingest({eventId:'e'+index,channel,text:'我使用 Kafka 派发任务',startMs:1000+index*10}));
  assert.ok(store.snapshot().events.every(event=>event.speaker==='unknown'));
  assert.ok(store.ledger.claims.every(claim=>claim.status==='uncertain'));
  const fixed=store.correct({sessionId:store.sessionId,eventId:'e0',speaker:'candidate'});
  assert.equal(fixed.event.echoOf,undefined);
  assert.equal(store.ledger.claims.filter(claim=>claim.status==='affirmed').length,1);
});

test('out-of-order corrections and mixed missing/relative times preserve chronology and evidence versions',()=>{
  const store=new DialogueStore();
  store.setActiveProject(['cae'],'evidence-v1');
  for(let i=0;i<24;i++) store.ingest({eventId:'history-'+i,channel:'you',text:'受理测量281 ms，第'+i+'组'});
  store.ingest({eventId:'old',channel:'you',text:'CAE 使用 Kafka',at_ms:100,revision:1});
  store.ingest({eventId:'correct',channel:'you',text:'刚才口误，实际用 RabbitMQ',at_ms:300,revision:1});
  store.ingest({eventId:'late',channel:'you',text:'Kafka 负责派发',at_ms:200,revision:1});
  store.setActiveProject(['cae'],'evidence-v2');
  const snapshot=store.snapshot({question:'消息队列怎么防重复？'});
  assert.equal(snapshot.events[23].eventId,'history-23');
  assert.equal(snapshot.events.at(-1).eventId,'correct');
  assert.equal(snapshot.claims.find(claim=>claim.id==='spoken:late').status,'corrected');
  assert.equal(snapshot.claims.at(-1).evidenceRevision,'evidence-v1');
  assert.match(snapshot.context.text,/RabbitMQ/);
  assert.doesNotMatch(snapshot.context.text,/Kafka/);
  assert.match(snapshot.context.text,/不重复提醒/);
  store.setActiveProject(['arclight'],'evidence-v2');
  assert.equal(store.selectContext({question:'受理测量281 ms'}).text,'');
});

test('a named benchmark correction keeps independent CI speech and recognizes a correction within one final',()=>{
  const store=new DialogueStore();store.setActiveProject(['arclight']);
  store.ingest({eventId:'ci',channel:'you',text:'合成例子的 CI 有17项测试。',at_ms:1});
  store.ingest({eventId:'benchmark',channel:'you',text:'合成例子的 SWE-bench 成功率是62.5%。',at_ms:2});
  store.ingest({eventId:'benchmark-fixed',channel:'you',text:'刚才口误，合成例子的 SWE-bench 成功率是54.2%。',at_ms:3});
  const claims=store.snapshot().claims;
  assert.equal(claims.find(claim=>claim.id==='spoken:ci').status,'affirmed');
  assert.equal(claims.find(claim=>claim.id==='spoken:benchmark').status,'corrected');
  assert.deepEqual(claims.at(-1).replaces,['spoken:benchmark']);
  store.ingest({eventId:'inline',channel:'you',text:'合成测量是27.4%总费用。不是，我更正，是累计输入Token。',at_ms:4});
  const inline=store.selectContext({question:'刚才的 Token 口径怎样说？'});
  assert.equal(inline.claims.find(claim=>claim.id==='spoken:inline').correction,true);
  assert.match(inline.text,/不重复提醒旧口误/);
});

test('hypothetical broker design and candidate questions do not contradict an actual implementation statement',()=>{
  const store=new DialogueStore();store.setActiveProject(['cae']);
  store.ingest({eventId:'actual',channel:'you',text:'当前用 RabbitMQ 派发任务。',at_ms:1});
  store.ingest({eventId:'hypothesis',channel:'you',text:'如果换成Kafka，我会评估分区键。',at_ms:2});
  store.ingest({eventId:'question',channel:'you',text:'为什么不用Kafka？',at_ms:3});
  const claims=store.snapshot().claims;
  assert.equal(claims[0].status,'affirmed');
  assert.equal(claims[1].status,'hypothetical');
  assert.equal(claims[2].status,'question');
  const context=store.selectContext({question:'消息队列的分区键怎么选？'});
  assert.match(context.text,/假设或后续设计，不是项目已实现事实/);
  assert.match(context.text,/问题，不当成实现断言/);
});

test('an English self-correction observed by live ASR reaches production SDK speech context without repeated correction or unrelated claim retirement',async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'instant'}});await app.ready;
  app.candidate('I said CI has 17 tests in this synthetic example.');
  app.candidate('Earlier I said Kafka dispatched the jobs.');
  // This is the recognized candidate sentence from real ASR run 40164527719.
  // The regression replays that final text; it does not simulate another ASR run.
  const recognized='I said Kafka, I meant RabbitMQ.';
  app.candidate(recognized);
  await app.ask('say','刚才的消息队列怎样派发任务？');
  const snapshot=plain(await app.invoke('dialogue:snapshot'));
  assert.equal(snapshot.claims[0].status,'affirmed');
  assert.equal(snapshot.claims[1].status,'corrected');
  assert.equal(snapshot.claims[2].correction,true);
  assert.equal(snapshot.claims[2].rawText,recognized);
  assert.deepEqual(snapshot.claims[2].replaces,[snapshot.claims[1].id]);
  assert.match(currentText(app.calls.at(-1)),/I said Kafka, I meant RabbitMQ\./);
  assert.match(currentText(app.calls.at(-1)),/候选人已主动纠正，沿用新版本，不重复提醒旧口误/);
  assert.doesNotMatch(currentText(app.calls.at(-1)),/Earlier I said Kafka dispatched the jobs/);
  await app.ask('say','那 RabbitMQ 怎样避免消息重复？');
  assert.match(currentText(app.calls.at(-1)),/I said Kafka, I meant RabbitMQ\./);
  assert.match(currentText(app.calls.at(-1)),/不重复提醒旧口误/);
  // The same recognized correction must survive an immediate follow-up that
  // has no shared broker word, as observed in the real PCM-to-answer run.
  await app.ask('say','How do you handle retries after a timeout?');
  assert.match(currentText(app.calls.at(-1)),/I said Kafka, I meant RabbitMQ\./);
  // "Actually" can introduce an ordinary assertion; it is not a sufficient
  // signal to silently retire an earlier human claim.
  const store=new DialogueStore();
  for(const [index,text]of ['I mean RabbitMQ.','Let me correct that: RabbitMQ.','I was wrong: RabbitMQ.','More precisely, RabbitMQ.','I misspoke: RabbitMQ.'].entries()) {
    store.ingest({eventId:'english-'+index,channel:'you',text});
    assert.equal(store.ledger.claims.at(-1).correction,true);
  }
  store.ingest({eventId:'ordinary',channel:'you',text:'Actually, CI has 17 tests.'});
  assert.equal(store.ledger.claims.at(-1).correction,false);
});

test('production speech keeps an early corrected subject after thirty rounds and an interrupted two-speaker turn',async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'instant'}});await app.ready;
  const sessionId=(await app.invoke('dialogue:snapshot')).sessionId;
  const deliver=(eventId,text,extra={})=>app.invoke('dialogue:event',{sessionId,eventId,channel:'you',speaker:'candidate',text,revision:1,isFinal:true,...extra});
  await deliver('early','合成例子的 SWE-bench 成功率是62.5%。',{at_ms:1});
  await deliver('fixed','口误，合成例子的 SWE-bench 成功率是54.2%。',{at_ms:2});
  for(let round=0;round<30;round++) {
    await deliver('other-'+round,'这是合成对话的第'+round+'轮，描述另外一种日常安排。',{at_ms:10+round*2});
    await deliver('ask-'+round,'接着聊下一个日常安排。',{speaker:'interviewer',channel:'them',at_ms:11+round*2});
  }
  await deliver('partial','我想补充一半',{isFinal:false,at_ms:80});
  await deliver('overlap','刚才那个成功率是什么口径？',{speaker:'interviewer',channel:'them',at_ms:80});
  await deliver('partial','我先听完问题。',{revision:2,isFinal:true,at_ms:80});
  const revision=(await app.invoke('dialogue:snapshot')).revision;
  const silence=await deliver('silence','   ',{at_ms:90});
  assert.equal(silence.accepted,false);assert.equal(silence.reason,'empty');
  assert.equal((await app.invoke('dialogue:snapshot')).revision,revision);
  await app.ask('say','回到刚才 SWE-bench 的成功率，补充正确口径。');
  assert.match(currentText(app.calls.at(-1)),/54\.2%/);
  assert.doesNotMatch(currentText(app.calls.at(-1)),/62\.5%/);
  assert.match(currentText(app.calls.at(-1)),/不重复提醒旧口误/);
  const snapshot=await app.invoke('dialogue:snapshot');
  assert.equal(snapshot.events.find(event=>event.eventId==='partial').text,'我先听完问题。');
  assert.equal(snapshot.events.find(event=>event.eventId==='overlap').speaker,'interviewer');
  assert.ok(snapshot.claims.every(claim=>!claim.text.includes('我想补充一半')));
});

test('protected speech and numeric qualifications survive instant soft target and final request pressure',()=>{
  const spoken='我刚才把完成说错了，281 ms 是300批次、5并发、每批50 Case的持久受理P95，求解另行计时。';
  const instant=buildInstantContext({question:'仿真为何这么快？',request:{plan:{},spokenContext:spoken,turns:[{role:'assistant',text:'OLD_AI '.repeat(4000)}]},
    evidenceLimits:{softInputTokens:400},readyEvidence:{evidence:[]}});
  const speech=instant.currentSections.find(section=>section.id==='spoken-state');
  assert.equal(speech.protected,true);
  assert.ok(speech.text.includes(spoken));
  const final=prepareFinalRequest({system:instant.system,currentSections:instant.currentSections,history:[{role:'assistant',text:'OLD_AI '.repeat(4000)}],contextWindow:8192,maxTokens:640});
  assert.equal(final.fits,true);
  assert.ok(requestText(final).includes(spoken));
  assert.doesNotMatch(requestText(final),/OLD_AI/);
});

for(const profile of ['instant','standard']) test(`production ${profile} IPC uses real speech across request boundaries and continues a human correction`,async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:profile}});
  await app.ready;
  assert.ok(app.hasHandler('dialogue:event')&&app.hasHandler('dialogue:snapshot')&&app.hasHandler('dialogue:correct'));
  const session=(await app.invoke('dialogue:snapshot')).sessionId;
  const event={sessionId:session,eventId:'candidate-1',speaker:'candidate',channel:'you',text:'SPOKEN_ONLY 我用了 Kafka 派发任务。',revision:1,isFinal:true};
  await app.invoke('dialogue:event',event);
  app.answer('AI_SUGGESTION_ONLY 我建议使用别的组件。');
  app.final('介绍 RepoPilot 项目的整体架构。');
  await app.ask('say');
  const repeated=await app.invoke('dialogue:event',event);
  assert.equal(repeated.reason,'duplicate');
  assert.equal(app.snapshot('transcript.filter(t=>t.eventId==="candidate-1").length'),1);
  app.advance(20000);
  app.final('Kafka 的分区键怎么选？');
  app.answer('我刚才口误了，需要按项目实现核对。');
  await app.ask('say');
  assert.match(currentText(app.calls.at(-1)),/SPOKEN_ONLY/);
  assert.match(currentText(app.calls.at(-1)),/Kafka/);
  await app.invoke('dialogue:event',{sessionId:session,eventId:'candidate-2',speaker:'candidate',channel:'you',text:'我刚才口误，实际用 RabbitMQ，按任务身份去重。',revision:1,isFinal:true});
  app.final('消息重复会怎样处理？');
  await app.ask('say');
  assert.match(currentText(app.calls.at(-1)),/RabbitMQ/);
  assert.match(currentText(app.calls.at(-1)),/不重复提醒/);
  const snapshot=plain(await app.invoke('dialogue:snapshot'));
  assert.equal(snapshot.claims.filter(claim=>claim.status==='affirmed').length,1);
  assert.ok(snapshot.suggestions.length>=3);
  assert.ok(snapshot.claims.every(claim=>!claim.text.includes('AI_SUGGESTION_ONLY')));
  assert.equal(snapshot.suggestions.at(-1).sourceEventIds[0],'candidate-2');
});

test('production cancel and reset reject late tokens and suggestion state while preserving occurred speech',async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'instant'}});
  await app.ready;
  const gate=deferred();
  app.behavior(()=> (async function*(){yield {choices:[{delta:{content:'FIRST'}}]};await gate.promise;yield {choices:[{delta:{content:'LATE_SHOULD_DROP'},finish_reason:'stop'}]};})());
  const session=(await app.invoke('dialogue:snapshot')).sessionId;
  await app.invoke('dialogue:event',{sessionId:session,eventId:'human',channel:'you',text:'我负责任务身份核验。'});
  app.final('介绍你的职责。');
  const running=app.ask('say');
  await app.waitForCalls(1);
  const canceled=await app.invoke('llm:cancel');
  assert.equal(canceled.canceled,true);
  assert.equal((await app.invoke('dialogue:snapshot')).claims.length,1);
  app.clear();
  gate.resolve();
  await running;
  const snapshot=await app.invoke('dialogue:snapshot');
  assert.notEqual(snapshot.sessionId,session);
  assert.equal(snapshot.events.length,0);
  assert.equal(snapshot.suggestions.length,0);
  const diagnostic=plain(app.value('redactedDiagnostics()'));assert.equal(diagnostic.lastActualRequest.status,'canceled');assert.equal(diagnostic.lastActualRequest.sessionId,session);assert.equal(diagnostic.lastActualRequest.metrics.aborted,true);
  assert.ok(!app.events.some(event=>event.channel==='llm:token'&&event.text==='LATE_SHOULD_DROP'));
  assert.equal((await app.invoke('dialogue:event',{sessionId:session,eventId:'late-human',channel:'you',text:'迟到语音'})).reason,'stale-session');
});

test('production manual role/text correction updates one transcript and keeps the source observation',async t=>{
  const app=createInterviewRuntime(t);
  await app.ready;
  const session=(await app.invoke('dialogue:snapshot')).sessionId;
  await app.invoke('dialogue:event',{sessionId:session,eventId:'uncertain',speaker:'unknown',channel:'you',text:'这里用 Kafka',isFinal:true,revision:1});
  assert.equal((await app.invoke('question:get-target')).snapshot.text,'');
  const fixed=await app.invoke('dialogue:correct',{sessionId:session,eventId:'uncertain',text:'这里用 RabbitMQ',speaker:'candidate',revision:2});
  assert.equal(fixed.accepted,true);
  const snapshot=plain(await app.invoke('dialogue:snapshot',{question:'消息队列怎么处理？'}));
  assert.equal(snapshot.events[0].rawText,'这里用 Kafka');
  assert.equal(snapshot.events[0].normalizedText,'这里用 RabbitMQ');
  assert.equal(snapshot.events[0].correctionHistory[0].revision,1);
  assert.equal(snapshot.claims[0].status,'affirmed');
  assert.equal(app.snapshot('transcript.filter(t=>t.eventId==="uncertain").length'),1);
});

test('configured code output budget reaches production request planning and remains frozen',async t=>{
  const app=createInterviewRuntime(t,{settings:{responseBudgets:{oral:900,code:6000},contextWindowTokens:16384}});
  await app.ready;
  app.final('用 Java 实现二分查找函数，给完整代码。');
  await app.ask('technical');
  const request=app.commits.at(-1).request;
  assert.deepEqual(plain(request.responseBudget),{kind:'code',maxTokens:6000});
  assert.equal(request.settingsSnapshot.responseBudgets.code,6000);
  assert.equal(app.calls.at(-1).max_tokens,6000);
});

test('diagnostic export writes only a user-selected local file with contacts and configured keys redacted',async t=>{
  const app=createInterviewRuntime(t);
  await app.ready;
  const destination=path.join(app.temp,'diagnostics.json');
  app.value(`dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(destination)}})`);
  await app.invoke('dialogue:event',{eventId:'contact',channel:'you',text:'联系 sample@example.com，13800138000，test-transport-only，sk-syntheticSecret1234567890。'});
  const result=await app.invoke('diagnostics:export');
  assert.equal(result.canceled,false);
  const output=fs.readFileSync(destination,'utf8');
  assert.doesNotMatch(output,/sample@example\.com|13800138000|test-transport-only|sk-syntheticSecret/);
  assert.match(output,/联系方式已省略/);
  const diagnostics=JSON.parse(output);
  assert.equal(diagnostics.dialogue.events.length,1);
  assert.ok(diagnostics.materials.generation!=null);
});

for(const pauseAt of ['model-verification','transcriber-start']) for(const stopAfterReset of [false,true])
test(`production local Whisper reset during ${pauseAt} ${stopAfterReset?'respects a subsequent stop':'restarts under the new session'}`,{timeout:5000},async t=>{
  const gate=deferred(),instances=[];
  let verifications=0;
  t.after(()=>gate.resolve());
  class ModelManager {
    async verifyInstalledModel() {
      if(++verifications===1&&pauseAt==='model-verification')await gate.promise;
      return '/synthetic/model.bin';
    }
  }
  class Transcriber {
    constructor(options) {this.options=options;this.forced=0;this.stopped=0;this.index=instances.length;instances.push(this);}
    async start() {
      if(this.index===0&&pauseAt==='transcriber-start')await gate.promise;
      this.options.onStatus({status:'ready'});
    }
    async forceStop() {this.forced++;}
    async stop() {this.stopped++;}
  }
  const app=createInterviewRuntime(t,{settings:{sttProvider:'local',localWhisper:{modelId:'synthetic'}},localWhisperHardware:{
    'src/whisper-model-manager.js':{WhisperModelManager:ModelManager},
    'src/whisper-model-catalog.js':{requireWhisperModel:id=>({id,englishOnly:false,tinydiarize:false})},
    'src/whisper-runtime.js':{locateWhisperRuntime:()=>({available:true,executablePath:'/synthetic/whisper',runtimeDirectory:'/synthetic'})},
    'src/local-whisper-transcriber.js':{LocalWhisperTranscriber:Transcriber}
  }});
  await app.ready;
  app.value('whisperModelManager=new WhisperModelManager({})');
  const sessionId=(await app.invoke('dialogue:snapshot')).sessionId;
  const starting=app.invoke('capture:toggle');
  for(let tries=0;tries<100&&!(pauseAt==='model-verification'?verifications:instances.length);tries++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.snapshot('state.capturing'),false);
  assert.equal(app.snapshot('desiredCaptureState'),true);
  app.clear();
  let stopping=null;
  if(stopAfterReset)stopping=app.invoke('capture:toggle');
  await starting;
  if(stopping)await stopping;
  await app.value('captureTransition');
  const newSessionId=(await app.invoke('dialogue:snapshot')).sessionId;
  assert.notEqual(newSessionId,sessionId);
  assert.equal(app.snapshot('desiredCaptureState'),!stopAfterReset);
  assert.equal((await app.invoke('capture:state')).active,!stopAfterReset);
  const active=instances.at(-1);
  const previous=pauseAt==='transcriber-start'?instances[0]:null;
  if(previous) {
    previous.options.onError(new Error('STALE_WHISPER_ERROR'));
    previous.options.onStatus({status:'STALE_WHISPER_STATUS'});
    previous.options.onTranscript('you','STALE_WHISPER_SPEECH');
  }
  gate.resolve();
  for(let turn=0;turn<5;turn++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.snapshot('sttDisabled'),false);
  assert.ok(!app.events.some(event=>String(event.message||event.status||'').includes('STALE_WHISPER')));
  assert.equal((await app.invoke('dialogue:snapshot')).events.length,0);
  if(!stopAfterReset) {
    assert.ok(active&&active!==previous);
    active.options.onTranscript('you','新会话的真实发言。');
    const spoken=(await app.invoke('dialogue:snapshot')).events;
    assert.equal(spoken.length,1);
    assert.equal(spoken[0].sessionId,newSessionId);
    assert.equal((await app.invoke('capture:state')).active,true);
    await app.invoke('capture:toggle');
  } else assert.equal((await app.invoke('capture:state')).active,false);
});
