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
  assert.equal(oral.plan('先问Agent方面，你了解吧？').confirmation,true);
  assert.equal(oral.plan('直接调用API是吧？你有对RAG这些了解吗？').confirmation,false);
  assert.equal(oral.plan('Claude是你自己买吗？').maxTokens,180);
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
  const {cases,judgeMessages,automatic}=require('../scripts/eval-public.cjs');const suite=cases();assert.equal(suite.length,67);
  const result={answer:'1. 做法：正确示例。',transportStatus:'passed',completion:{complete:true}};
  assert.equal(JSON.parse(judgeMessages(suite[0],result,[]).at(-1).content).oldSuggestionForComparisonOnly,undefined);
  assert.equal(automatic({...result,completion:{complete:false}},'怎么做？').complete,false);
  const acceptance=cases('acceptance');assert.equal(acceptance.length,65);
  for(const domain of ['arclight','cae','general'])assert.equal(acceptance.filter(c=>c.caseId.startsWith('accept-')&&c.suggestedDomain===domain).length,8);
});

test('smoke regression: introductory CAE and dual experiment metrics select their own complete cards',()=>{
  const {ProjectFactPacks}=require('../src/project-fact-packs');const packs=new ProjectFactPacks({index:workspace().facts});
  const intro=packs.select('介绍一下cae',{resolution:{canonicalProjectIds:['cae'],retrieveFacts:true},maxCards:3});
  assert.ok(intro.evidence.some(c=>c.cardId==='cae-01'));
  const metrics=packs.select('300道修复题和60项长会话分别测什么？',{resolution:{canonicalProjectIds:['arclight'],retrieveFacts:true},maxCards:3});
  assert.deepEqual(metrics.evidence.filter(c=>c.protectedMetric).map(c=>c.cardId).sort(),['metric.arc.context','metric.arc.swe']);
});
test('public judge-only continuation preserves archived answers and makes zero generation calls',async t=>{
  const {evaluate,cases}=require('../scripts/eval-public.cjs'),path=require('node:path'),os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cue-public-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const suite=cases();
  for(const c of [suite[0],suite[10],suite[23],suite[33],suite[42],suite[60]]) {
    const directory=path.join(root,'source','qwen',c.caseId+'-r1');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'trace.json'),JSON.stringify({id:c.caseId,answer:'ARCHIVED_ANSWER',attempted:true,transportStatus:'passed',applicationCommit:'old-generation',automatic:{complete:true,lengthPassed:true,formatPassed:true}}));
    fs.writeFileSync(path.join(directory,'request.json'),JSON.stringify({messages:['ARCHIVED_REQUEST']}));
  }
  const summary=await evaluate({phase:'rejudge',provider:'qwen',mock:true,sourceDir:path.join(root,'source'),outputDir:path.join(root,'output')});
  assert.equal(summary.generations,0);assert.equal(summary.budget.attemptedCalls,0);assert.equal(summary.applicationCommit,null);
  for(const row of summary.results)assert.equal(fs.readFileSync(path.join(root,'output',row.directory,'answer.txt'),'utf8'),'ARCHIVED_ANSWER');
});

test('screen code output never enters oral sentence clipping',async t=>{
  const app=createInterviewRuntime(t);await app.ready;
  app.answer('```java\n'+('System.out.println(42);\n'.repeat(80))+'```');
  await app.ask('ask','请修改这段代码，保留接口。');
  assert.ok(app.captures>0);
  const presentation=app.events.findLast(e=>e.channel==='llm:presentation');
  assert.equal(presentation.displayTruncated,false);assert.ok(presentation.text.includes('```java'));
});
test('useful-sentence timing ignores isolated numbering, source markers and empty labels',()=>{
  let at=0;const {createReplyLatency}=require('../src/reply-latency');
  const tracker=createReplyLatency({now:()=>at,wallNow:()=>at,log:()=>{}}).start('say','怎么做？');
  for(const text of ['1.\n','[来源 1]\n','做法：\n']){at+=10;tracker.content(text);assert.equal(tracker.metrics().triggerToFirstUsefulSentenceMs,null);}
  at+=10;tracker.content('先校验输入，再执行。');assert.equal(tracker.metrics().triggerToFirstUsefulSentenceMs,40);
});

test('standalone Agent knowledge does not inherit a future supply-chain role design card',()=>{
  const {ProjectFactPacks}=require('../src/project-fact-packs');const packs=new ProjectFactPacks({index:workspace().facts});
  assert.ok(!packs.selectKnowledge('Claude Code这种agent是怎么设计的？').evidence.some(c=>c.cardId==='ai-01'));
  assert.ok(packs.selectKnowledge('如何把Coding Agent经验迁移到供应链岗位？').evidence.some(c=>c.cardId==='ai-01'));
});
test('historical replay uses only canonical human events before each original output point',()=>{
  const {adapt}=require('../scripts/lib/interview-replay.cjs');
  const cases=require('../evaluation/cases/interview-2026-10-26.json').cases;
  const events=require('../materials/personal/data/transcript-events.json').events;
  const replay=adapt(cases[5],events);
  assert.equal(replay.cutoffExclusive,61);assert.ok(replay.events.every(e=>e.sourceIndex<61));
  assert.ok(replay.events.some(e=>/temperature.*Top p/i.test(e.text)));
  assert.ok(replay.events.every(e=>!e.text.includes('（发言 ')));
  assert.equal(replay.aiSuggestionsIncluded,false);
  const revisions=adapt({sourceEventIndex:3},[
    {role:'本人',text:'旧说法\n（发言 same · 版本 1）'},
    {role:'本人',text:'已纠正\n（发言 same · 版本 2）'},
    {role:'CUE 建议（未确认说出）',text:'不应进入真人账本'},
    {role:'本人',text:'未来发言'}]);
  assert.equal(revisions.events.length,1);assert.equal(revisions.events[0].revision,2);assert.equal(revisions.events[0].text,'已纠正');
  const role=adapt({sourceEventIndex:2},[{role:'本人',text:'说过的话\n（发言 stream:you:1 · 版本 4）'},{role:'修订 · 说话人待确认',text:'说过的话\n（发言 stream:you:1 · 版本 4）'}]);
  assert.equal(role.events[0].speaker,'unknown');assert.equal(role.events[0].roleCorrected,true);
});
test('referential question freezes complete parameter and sparse/dense entities, not trailing fragments',()=>{
  const {reference}=require('../src/question-topic-context');
  const transcript=[{channel:'them',text:'Transformer为什么需要上下文窗口？'},{channel:'them',text:'temperature和top-p分别是采样时的参数，有了解过吗？'},{channel:'them',text:'你这些有了解过吗？'},{channel:'them',text:'他们是什么东西？'}];
  const text=reference('你这些有了解过吗？他们是什么东西？',transcript);
  assert.match(text,/temperature和top-p/);assert.doesNotMatch(text,/Transformer/);
  const fusion=reference('怎么融合这些？',[{channel:'them',text:'Agentic RAG是否需要路由？'},{channel:'them',text:'稀疏召回和稠密召回分别怎么做？'},{channel:'them',text:'你有了解过吗？'}]);
  assert.match(fusion,/稀疏召回和稠密召回/);assert.doesNotMatch(fusion,/Agentic/);
});
test('benchmark follow-up reference protects SWE rather than inheriting the MCP experiment',()=>{
  const {ProjectFactPacks}=require('../src/project-fact-packs');
  const packs=new ProjectFactPacks({index:workspace().facts});
  const found=packs.select('对照组怎么设计？',{resolution:{canonicalProjectIds:['arclight'],retrieveFacts:true,metricContext:'这个agent跑过什么benchmark？SWE-bench Lite有300道题。'},maxCards:3});
  assert.ok(found.evidence.find(c=>c.cardId==='metric.arc.swe')?.protectedMetric);
});
test('actual historical parameter replay freezes temperature/top-p at the production SDK boundary',async t=>{
  const app=createInterviewRuntime(t,{settings:{answerDomain:'general',realtimeAnswerMode:'instant'}});await app.ready;
  const c=require('../evaluation/cases/interview-2026-10-26.json').cases[5];
  const replay=require('../scripts/lib/interview-replay.cjs').adapt(c,require('../materials/personal/data/transcript-events.json').events);
  for(const e of replay.events) {
    const meta={eventId:e.eventId,utteranceKey:e.eventId,revision:e.revision,startMs:e.startMs,rawText:e.rawText};
    if(e.speaker==='candidate')app.candidate(e.text,meta);else if(e.speaker==='interviewer')app.final(e.text,meta);
  }
  await app.ask('say',c.rawQuestion);
  const message=JSON.stringify(app.calls.at(-1).messages);
  const reference=message.split('最近真人提问实体').at(-1);
  assert.match(reference,/temperature/i);assert.match(reference,/top p/i);assert.doesNotMatch(reference,/Transformer/);
  assert.doesNotMatch(message,/（发言 /);
});
test('MCP optimization SDK request keeps both metric and verified original-schema mechanism',async t=>{
  const app=createInterviewRuntime(t,{settings:{answerDomain:'arclight',realtimeAnswerMode:'instant'}});
  await app.importMaterialSnapshot({facts:workspace().facts,sources:sources()});
  await app.ask('say','50个MCP工具的初始Token从18.6k到4.2k，是怎么优化的？');
  const ids=app.commits.at(-1).config.evidence.map(e=>e.cardId);
  assert.ok(ids.includes('metric.arc.mcp'));assert.ok(ids.includes('oct26.code.toolsearch'));assert.ok(ids.includes('oct26.code.mcp-wrapper'));
  assert.match(JSON.stringify(app.calls.at(-1).messages),/保留(?:原始|服务端完整)inputSchema/);
});
test('partial cross-channel echo cannot promote interviewer history into candidate claims',()=>{
  const {DialogueStore}=require('../src/spoken-claim-ledger');
  const d=new DialogueStore();
  d.ingest({eventId:'mic',channel:'you',text:'其实我是来自某电商供应链的',startMs:1000,isFinal:true});
  d.ingest({eventId:'system',channel:'them',text:'其实我是来自某电商供应链的，我们团队负责库存和调度。',startMs:1800,isFinal:true});
  assert.equal(d.events.get('system').speaker,'interviewer');
  assert.equal(d.ledger.snapshot().find(c=>c.eventIds.includes('mic')).status,'uncertain');
  assert.equal(d.events.get('mic').rawText,'其实我是来自某电商供应链的');
  d.correct({eventId:'mic',speaker:'candidate'});
  assert.equal(d.ledger.snapshot().find(c=>c.eventIds.includes('mic')).status,'affirmed');
  const later=new DialogueStore();later.ingest({eventId:'a',channel:'you',text:'其实我是来自某电商供应链的',startMs:1000});
  later.ingest({eventId:'b',channel:'them',text:'其实我是来自某电商供应链的，我们团队负责库存。',startMs:10000});
  assert.equal(later.ledger.snapshot()[0].status,'affirmed');
});
test('latest interview source cards ground memory cadence, error returns and MCP schema boundaries',()=>{
  const {ProjectFactPacks}=require('../src/project-fact-packs');const w=workspace(),packs=new ProjectFactPacks({index:w.facts});
  assert.equal(w.facts.cards.length,132);
  for(const [q,id]of [['它的更新频率或存储内容是什么？','oct26.code.memory'],['这个校验错误存储在哪里？有统一错误码模块吗？','oct26.code.tool-errors']]) {
    const result=packs.select(q,{resolution:{canonicalProjectIds:['arclight'],retrieveFacts:true},maxCards:4});
    assert.ok(result.evidence.some(c=>c.cardId===id&&c.protectedMechanism));
  }
  const schema=w.facts.cards.find(c=>c.cardId==='oct26.code.mcp-wrapper');assert.match(schema.text,/默认可能类型转换/);
});
test('latest regression contains 17 real oral points and two authored SQL checks, never fabricates screen replay',()=>{
  const suite=require('../evaluation/cases/latest-interview-2026-10-26.json'),source=require('../evaluation/cases/latest-technical-events.json');
  assert.equal(suite.cases.filter(c=>Number.isInteger(c.sourceEventIndex)).length,17);
  assert.equal(suite.cases.filter(c=>c.derivedCase).length,2);assert.equal(source.unreplayableScreenSuggestionIndices.length,9);
  const {automatic}=require('../scripts/eval-public.cjs');assert.equal(automatic({answer:'```sql\nSELECT 1;\n```',transportStatus:'passed',completion:{complete:true}},suite.cases.at(-1).rawQuestion).formatPassed,true);
});
test('SQL fixtures reject the old buyer/buyer formula and duplicate-signup join',()=>{
  const {spawnSync}=require('node:child_process'),cases=require('../evaluation/cases/latest-interview-2026-10-26.json').cases.filter(c=>c.derivedCase);
  const check=(c,sql)=>JSON.parse(spawnSync('python3',['scripts/lib/verify-sql-regression.py'],{input:JSON.stringify({...c,answer:'```sql\n'+sql+';\n```'}),encoding:'utf8',timeout:5000}).stdout);
  assert.equal(check(cases[0],cases[0].expectedSql).passed,true);
  assert.equal(check(cases[0],'SELECT COUNT(DISTINCT buyer_id)*1.0/COUNT(DISTINCT buyer_id) FROM orders WHERE status IN (2,3,4)').passed,false);
  assert.equal(check(cases[0],'SELECT SUM(pay_amount) AS gmv, COUNT(DISTINCT buyer_id) AS buyers, SUM(pay_amount)*1.0/COUNT(DISTINCT buyer_id) AS avg_order_value FROM orders WHERE status IN (2,3,4)').passed,true);
  assert.equal(check(cases[1],cases[1].expectedSql).passed,true);
  assert.equal(check(cases[1],"SELECT SUM(o.pay_amount) FROM orders o JOIN signup s ON s.item_id=o.item_id WHERE s.activity='活动A' AND o.status IN (2,3,4)").passed,false);
});
test('personal strengths use candidate history without injecting JD skills or generic training cards',async t=>{
  const app=createInterviewRuntime(t,{settings:{answerDomain:'general',realtimeAnswerMode:'instant',...workspace().profile}});await app.ready;
  await app.ask('say','这些方向当中，你觉得你哪一个比较强，可以介绍一下？');
  const messages=JSON.stringify(app.calls.at(-1).messages);
  assert.match(messages,/个人项目开发/);assert.doesNotMatch(messages,/Schema Linking|NL2SQL|oct26.react-pe|targetRole/);
});
test('a fragment keyword follow-up protects the verified matching algorithm',()=>{
  const {ProjectFactPacks}=require('../src/project-fact-packs');const packs=new ProjectFactPacks({index:workspace().facts});
  const selected=packs.select('关键词。',{resolution:{canonicalProjectIds:['arclight'],retrieveFacts:true,metricContext:'MCP工具怎么快速查找？只用精准关键词还是模糊关键词？'},maxCards:4});
  const source=selected.evidence.find(c=>c.cardId==='oct26.code.toolsearch');assert.ok(source.protectedMechanism);assert.match(source.text,/空白拆词/);
});
