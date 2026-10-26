'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const oral=require('../src/oral-answer-policy');
const {createInterviewRuntime,deferred}=require('./helpers/interview-agent-runtime');
const workspace=()=>JSON.parse(fs.readFileSync('materials/personal/workspace.json','utf8'));
const sources=()=>JSON.parse(fs.readFileSync('materials/bundle.json','utf8')).sources;
test('oral policy distinguishes explicit detail and complete code from ordinary design questions',()=>{
  assert.equal(oral.plan('怎么设计可靠恢复？').maxTokens,600);
  assert.equal(oral.plan('请详细展开各项比较').maxVisibleCharacters,360);
  assert.equal(oral.plan('用Java编写完整程序').code,true);
  assert.equal(oral.visibleCharacters('1. 做法：**甲😀**。\n2. 例子：乙。'),11);
  const raw='完整短句。'+'过长内容'.repeat(100)+'。';assert.equal(oral.presentation(raw).text,'完整短句。');
  assert.equal(oral.presentation(raw).displayTruncated,true);
});
for(const mode of ['instant','standard'])test(`${mode}: selected domain and complete metric reach the actual SDK; general excludes project facts`,async t=>{
  const app=createInterviewRuntime(t,{settings:{answerDomain:'arclight',realtimeAnswerMode:mode}});
  await app.importMaterialSnapshot({facts:workspace().facts,sources:sources()});
  app.answer('1. 数据：SWE-bench Lite有300题。\n2. 结果：简历记录31.33%到43.67%。');
  await app.ask('say','跑过benchmark吗？分数多少？');
  const text=JSON.stringify(app.calls.at(-1).messages);
  assert.match(text,/metric.arc.swe/);assert.match(text,/300/);assert.match(text,/31.33/);
  assert.equal(app.requests.at(-1).answerDomain,'arclight');assert.equal(app.calls.at(-1).max_tokens,600);
  assert.ok(app.commits.at(-1).config.evidence.some(e=>e.cardId==='metric.arc.swe'));
  const epoch=app.snapshot('conversation.epoch');await app.invoke('answer:domain','general');
  assert.ok(app.snapshot('conversation.epoch')>epoch);await app.ask('say','两路召回怎么融合？');
  assert.deepEqual(JSON.parse(JSON.stringify(app.requests.at(-1).plan.canonicalProjectIds)),[]);
  assert.ok(!app.commits.at(-1).config.evidence.some(e=>e.sourceType==='project-pack'));
  await app.invoke('answer:domain','cae');await app.ask('say','Arclight的Mailbox怎么传递？');
  assert.ok(app.requests.at(-1).plan.switchHint);assert.equal(app.requests.at(-1).plan.retrieveFacts,false);
});
test('domain change rejects a late stream and persists the selected scope',async t=>{
  const app=createInterviewRuntime(t,{settings:{answerDomain:'cae'}}),gate=deferred();
  app.behavior(async()=>{await gate.promise;return(async function*(){yield {choices:[{delta:{content:'STALE_CA E'}}]};})();});
  const old=app.ask('say','怎么保证可靠？');await app.waitForCalls(1);
  await app.invoke('answer:domain','arclight');gate.resolve();await old;
  assert.equal(app.commits.length,0);assert.equal(app.exports('src/store.js').getSettings().answerDomain,'arclight');
});
test('contextual ASR explains corrections and preserves ordinary/frontend terms',()=>{
  const {normalize}=require('../src/contextual-asr');
  assert.equal(normalize('骁龙实验怎么做','SWE-bench评测').normalizedText,'消融实验怎么做');
  assert.equal(normalize('高通骁龙实验').normalizedText,'高通骁龙实验');
  assert.equal(normalize('React组件的hooks','Agent').normalizedText,'React组件的hooks');
  assert.equal(normalize('行业发展趋势','SWE评测').rules.length,0);
  assert.equal(normalize('Honey词怎么控制','SWE评测').rules[0].ruleId,'harness');
});
test('public redaction preserves long numbers, names, paths and approved question text',()=>{
  const {redact}=require('../scripts/lib/public-text.cjs'),changes=[];
  const value=redact({question:'廖松毅 13800138000 /workspace/cue 31.57%',authorization:'Bearer secret-value',answer:'secret-value'},['secret-value'],changes);
  assert.equal(value.question,'廖松毅 13800138000 /workspace/cue 31.57%');assert.equal(value.authorization,'[REDACTED]');assert.equal(changes.length,2);
});
for(let variant=0;variant<12;variant++)test(`speech boundary ${variant+1}: revisions/roles cannot turn local denial or AI suggestions into benchmark facts`,()=>{
  const {DialogueStore}=require('../src/spoken-claim-ledger');const d=new DialogueStore({sessionId:'boundary-'+variant});
  d.setActiveProject(['arclight']);
  d.ingest({eventId:'question',channel:'them',text:'同P&E下单多Agent消融做过吗？',isFinal:true,startMs:100});
  d.ingest({eventId:'denial',channel:'you',text:'这个消融没测过。',revision:1,isFinal:true,startMs:200});
  d.ingest({eventId:'benchmark',channel:'you',text:'我做过SWE-bench Lite的300题评测。',revision:1,isFinal:true,startMs:300});
  assert.equal(d.ingest({eventId:'ai',speaker:'assistant',text:'我做过所有实验。'}).accepted,false);
  const repeated=d.ingest({eventId:'benchmark',channel:'you',text:'我做过SWE-bench Lite的300题评测。',revision:1,isFinal:true,startMs:300});
  assert.equal(repeated.reason,'duplicate');
  const text='我做过SWE-bench Lite的300题评测。';
  switch(variant) {
    case 0: d.correct({eventId:'benchmark',speaker:'unknown'}); break;
    case 1: d.correct({eventId:'denial',text:'我说的是没有测过同模型P&E消融。'}); break;
    case 2: assert.equal(d.ingest({eventId:'benchmark',channel:'you',text:'早期迟到片段',revision:0,isFinal:false}).accepted,false);break;
    case 3: d.ingest({eventId:'echo',channel:'them',text,isFinal:true,startMs:300});break;
    case 4: d.ingest({eventId:'short',channel:'you',text:'是的。',isFinal:true,startMs:6000});break;
    case 5: d.ingest({eventId:'overlap',channel:'them',text:'你说做过SWE-bench Lite的300题评测？',isFinal:true,startMs:301});break;
    case 6: assert.equal(d.ingest({sessionId:'previous-session',eventId:'late',channel:'you',text:'没跑任何评测'}).reason,'stale-session');break;
    case 7: d.correct({eventId:'benchmark',speaker:'unknown'});d.correct({eventId:'benchmark',speaker:'candidate'});break;
    case 8: d.correct({eventId:'denial',speaker:'interviewer'});break;
    case 9: assert.equal(d.ingest({eventId:'benchmark',channel:'you',text:'不同内容但同revision',revision:1,isFinal:true}).reason,'revision-conflict');break;
    case 10: d.recordSuggestion({requestId:'suggestion',text:'全部消融已经跑过',status:'completed'});break;
    case 11: d.ingest({eventId:'repetition',channel:'you',text,isFinal:true,startMs:10000});break;
  }
  const claims=d.ledger.snapshot();
  const benchmark=claims.find(c=>c.eventIds.includes('benchmark'));
  if(variant!==3) {
    assert.equal(benchmark.experimentId,'metric.arc.swe');
    assert.equal(benchmark.status,variant===0?'uncertain':'affirmed');
  } else assert.ok(!claims.some(c=>c.eventIds.includes('benchmark')&&c.status==='affirmed'));
  assert.ok(!claims.some(c=>c.text==='我做过所有实验。'));
});
test('frozen replay never feeds old AI suggestions to the tested model; semantic judge is distinct',()=>{
  const {cases,judgeMessages,automatic}=require('../scripts/eval-public.cjs');const suite=cases();assert.equal(suite.length,65);
  const result={answer:'1. 做法：正确示例。',transportStatus:'passed',completion:{complete:true}};
  assert.equal(JSON.parse(judgeMessages(suite[0],result,[]).at(-1).content).oldSuggestionForComparisonOnly,suite[0].oldCueSuggestion);
  assert.equal(automatic({...result,completion:{complete:false}},'怎么做？').complete,false);
});
