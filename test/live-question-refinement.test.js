'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createInterviewRuntime}=require('./helpers/interview-agent-runtime');
const {focusSnapshot}=require('../src/question-focus');
const {lookup,queryFor,prime}=require('../src/online-knowledge');

test('clear during ongoing interim accepts later revisions of the same utterance',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.interim('历史问题是怎么缓存的？接下来',{utteranceKey:'stream',utteranceOrder:1,revision:1});
 await app.invoke('question:clear');
 app.interim('历史问题是怎么缓存的？接下来如果 SQL 有重复数据',{utteranceKey:'stream',utteranceOrder:1,revision:2});
 let target=(await app.invoke('question:get-target')).snapshot;
 assert.doesNotMatch(target.text+' '+target.pendingText,/历史问题/);assert.match(target.text+' '+target.pendingText,/SQL/);
 app.final('历史问题是怎么缓存的？接下来如果 SQL 有重复数据，你会怎么查询？',{utteranceKey:'stream',utteranceOrder:1,revision:3});
 target=(await app.invoke('question:get-target')).snapshot;assert.match(target.text,/SQL/);assert.doesNotMatch(target.text,/历史问题/);
 app.answer('先去重，再查询。');await app.ask('say');assert.doesNotMatch(JSON.stringify(app.calls.at(-1).messages),/历史问题/);
});

test('clear aligns punctuation changes and exposes rewritten boundaries without dropping words',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.interim('旧问题，先说缓存',{utteranceKey:'u',utteranceOrder:1,revision:1});await app.invoke('question:clear');
 app.interim('旧问题先说缓存，接下来 SQL 怎么查？',{utteranceKey:'u',utteranceOrder:1,revision:2});
 let s=(await app.invoke('question:get-target')).snapshot;assert.match(s.text,/SQL/);assert.doesNotMatch(s.text,/旧问题/);assert.equal(s.clearBoundaryUncertain,false);
 await app.invoke('question:clear');
 app.interim('此前聊了缓存，现在 SQL 如何查重复？',{utteranceKey:'u',utteranceOrder:1,revision:3});
 s=(await app.invoke('question:get-target')).snapshot;assert.match(s.text,/此前聊了缓存/);assert.match(s.text,/SQL/);assert.equal(s.clearBoundaryUncertain,true);
});

test('elliptical technical follow-ups retain recent interviewer context only',()=>{
 const {LiveQuestionWindow,needsReference}=require('../src/live-context-policy');
 for(const q of ['可以详细说一下吗？','它里面的 put 怎么做？','这个下标怎么计算？','还有其他的吗？']) assert.equal(needsReference(q),true,q);
 const w=new LiveQuestionWindow();w.observe({questionId:'1',text:'HashMap 的 put 怎么做？'});w.observe({questionId:'2',text:'这个下标怎么计算？'});
 assert.match(w.select({questionId:'2',text:'这个下标怎么计算？'}).referenceContext,/HashMap/);
 assert.equal(needsReference('换个话题，SQL 如何查询？'),false);
});

for(const profile of ['instant','standard']) test(`${profile}: latest abbreviated question and previous interviewer topic reach model separately`,async t=>{
 const app=createInterviewRuntime(t,{settings:{answerDomain:'general',realtimeAnswerMode:profile}});await app.ready;
 app.final('HashMap 的 put 方法怎么定位数组下标？',{utteranceKey:'one',utteranceOrder:1});app.answer('先算哈希。');await app.ask('say');
 app.final('这个下标能详细说一下吗？',{utteranceKey:'two',utteranceOrder:2});app.answer('按位定位。');await app.ask('say');
 const body=JSON.stringify(app.calls.at(-1).messages);assert.match(body,/这个下标能详细说一下吗/);assert.match(body,/HashMap/);assert.match(body,/仅.*指代|REFERENCE_ONLY/);
});

test('ASR vocabulary corrections retain original and report contextual uncertainty',()=>{
 const {normalize}=require('../src/contextual-asr');
 const j=normalize('GM 用什么收集器？','JVM 的 CMS');assert.equal(j.rawText,'GM 用什么收集器？');assert.match(j.normalizedText,/JVM/);assert.equal(j.rules[0].basis,'current-or-recent-topic');
 const m=normalize('NVCC 是什么？','MySQL 事务');assert.equal(m.rawText,'NVCC 是什么？');assert.match(m.normalizedText,/MVCC/);
 assert.equal(normalize('NVCC 如何编译 CUDA？','MySQL').rules.length,0);
});

test('clear ignores unchanged speech, while a later independent utterance survives',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.interim('之前的条件',{utteranceKey:'same',utteranceOrder:1,revision:1});await app.invoke('question:clear');
 app.final('之前的条件',{utteranceKey:'same',utteranceOrder:1,revision:2});assert.equal((await app.invoke('question:get-target')).snapshot.text,'');
 app.final('Redis 缓存失效怎么办？',{utteranceKey:'next',utteranceOrder:2,revision:1});assert.match((await app.invoke('question:get-target')).snapshot.text,/Redis/);
});

test('repeated clear during the same utterance drops the entire old prefix',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.interim('旧的缓存问题',{utteranceKey:'same',utteranceOrder:1,revision:1});await app.invoke('question:clear');
 app.interim('旧的缓存问题接下来讨论数据库',{utteranceKey:'same',utteranceOrder:1,revision:2});await app.invoke('question:clear');
 app.final('旧的缓存问题接下来讨论数据库如何优化 SQL 查询？',{utteranceKey:'same',utteranceOrder:1,revision:3});
 const target=(await app.invoke('question:get-target')).snapshot;assert.match(target.text,/SQL/);assert.doesNotMatch(target.text,/旧的缓存|接下来讨论数据库/);
});

test('late revisions of a cleared utterance cannot replace the next utterance',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.interim('之前的问题',{utteranceKey:'old',utteranceOrder:1,revision:1});await app.invoke('question:clear');
 app.final('Redis 怎么处理缓存失效？',{utteranceKey:'new',utteranceOrder:2,revision:1});
 app.final('之前的问题后来还说了什么？',{utteranceKey:'old',utteranceOrder:1,revision:2});
 assert.match((await app.invoke('question:get-target')).snapshot.text,/Redis/);
});

test('a final-but-incomplete segment can continue after clear while the speaker is active',()=>{
 const {QuestionResolver}=require('../src/question-resolver');const r=new QuestionResolver();
 r.speechState({channel:'them',speaking:true});
 r.observe({channel:'them',text:'如果数据库',sourceId:'asr',utteranceKey:'u',utteranceOrder:1,revision:1},true);
 r.retireActive('manual-clear');
 r.observe({channel:'them',text:'如果数据库怎么设计 SQL 查询？',sourceId:'asr',utteranceKey:'u',utteranceOrder:1,revision:2},true);
 const target=r.resolveForSubmit();assert.match(target.text,/SQL/);assert.doesNotMatch(target.text,/如果数据库/);
});

test('focus drops only clearly unrelated prior questions and preserves same-topic constraints',()=>{
 const snapshot={segments:[{id:'a',text:'Redis 缓存怎么淘汰？',partIds:['a']},{id:'b',text:'假设数据库有重复行，',partIds:['b']},{id:'c',text:'SQL 怎么求每个用户最新记录？',partIds:['c']}],sourceKeys:['a','b','c']};
 const focused=focusSnapshot(snapshot);assert.doesNotMatch(focused.text,/Redis/);assert.match(focused.text,/重复行/);assert.match(focused.text,/SQL/);
 const same={segments:[{id:'x',text:'数据库有重复行，如何去重？'},{id:'y',text:'另外 SQL 怎么求总额？'}],sourceKeys:[]};assert.equal(focusSnapshot(same),same);
 const constrained={segments:[{id:'x',text:'假设 Redis 故障，缓存不能访问。'},{id:'y',text:'SQL 回源查询该怎么设计？'}],sourceKeys:[]};assert.equal(focusSnapshot(constrained),constrained);
});

test('the actual SDK request excludes an unrelated old buffered question',async t=>{
 const app=createInterviewRuntime(t);await app.ready;
 app.final('Redis 缓存为什么会失效？',{utteranceKey:'old',utteranceOrder:1});
 app.final('另外 SQL 查询怎样找出重复数据？',{utteranceKey:'new',utteranceOrder:2});
 app.answer('先分组再筛选。');await app.ask('say');const body=JSON.stringify(app.calls.at(-1).messages);
 assert.match(body,/SQL/);assert.doesNotMatch(body,/Redis 缓存为什么会失效/);
});

for(const profile of ['instant','standard']) test(`general mode never injects personal project material even when named (${profile})`,async t=>{
 const app=createInterviewRuntime(t,{settings:{answerDomain:'general',currentProjectId:'',realtimeAnswerMode:profile,liveContextPolicy:{includeCandidateSpeech:true},resumeText:'PRIVATE_RESUME_PROJECT_MARKER',projectKnowledge:'PRIVATE_PROJECT_KNOWLEDGE_MARKER',starStories:'PRIVATE_STORY_MARKER'}});await app.ready;
 app.candidate('我做过 PRIVATE_SPOKEN_PROJECT_MARKER 项目。');app.answer('解释这个概念。');
 await app.ask('say','RepoPilot 项目中 Redis 为什么快？');const body=JSON.stringify(app.calls.at(-1).messages);
 for(const marker of ['REPO_ONLY','REPO_RETRIEVAL','PRIVATE_RESUME_PROJECT_MARKER','PRIVATE_PROJECT_KNOWLEDGE_MARKER','PRIVATE_STORY_MARKER','PRIVATE_SPOKEN_PROJECT_MARKER']) assert.doesNotMatch(body,new RegExp(marker));
 assert.equal(app.requests.at(-1).plan.retrieve,false);
});

test('domain buttons are strict even when the question names another project',()=>{
 const {constrain}=require('../src/answer-domain');const catalog=[{id:'arclight',name:'Arclight',sourceScopes:['arc']},{id:'cae',name:'CAE',sourceScopes:['cae']}];
 const plan={canonicalProjectIds:['arclight'],projectIds:['arclight'],subQuestionScopes:[]};
 assert.deepEqual(constrain(plan,'general','Arclight 怎么实现？',catalog).canonicalProjectIds,[]);
 assert.deepEqual(constrain(plan,'cae','Arclight 怎么实现？',catalog).canonicalProjectIds,['cae']);
});

test('selected project personal context excludes the other project',()=>{
 const {buildCandidateRoleContext}=require('../src/candidate-role-context');
 const settings={candidateProfile:{subjectRole:'candidate',projects:[{id:'arclight',scope:'ARC_PRIVATE_MARKER'},{id:'cae',scope:'CAE_PRIVATE_MARKER'}],resumeProjectOrder:['arclight','cae']}};
 const text=buildCandidateRoleContext(settings,'介绍一下自己',{project:true,projectId:'cae'}).text;
 assert.match(text,/CAE_PRIVATE_MARKER/);assert.doesNotMatch(text,/ARC_PRIVATE_MARKER/);
});

test('online lookup sends only generic allowlisted keywords and treats snippets as data',async()=>{
 let seen='';const r=await lookup('私人公司 SECRET_PERSON 的 SQL 索引怎么设计？',{fetchImpl:async url=>{seen=url;return {ok:true,text:async()=>JSON.stringify({query:{search:[{title:'SQL',snippet:'<span>结构化查询</span> &amp; 数据'}]}})}}});
 assert.equal(r.status,'ok');assert.equal(r.sources[0].snippet,'结构化查询 & 数据');assert.doesNotMatch(decodeURIComponent(seen),/SECRET_PERSON|私人公司/);assert.equal(queryFor('没有技术词的私人问题'),'');
});

test('online snippets reach the actual SDK as reference, with no full question sent to the search service',async t=>{
 let seen='';const app=createInterviewRuntime(t,{settings:{answerDomain:'general'},net:{fetch:async url=>{seen=url;return {ok:true,text:async()=>JSON.stringify({query:{search:[{title:'消息队列',snippet:'ONLINE_REFERENCE_MARKER'}]}})}}}});await app.ready;
 app.answer('先排队，再处理。');await app.ask('say','私人公司 SECRET_ORGANIZATION 的消息队列如何使用？');
 assert.match(JSON.stringify(app.calls.at(-1).messages),/ONLINE_REFERENCE_MARKER/);assert.doesNotMatch(decodeURIComponent(seen),/SECRET_ORGANIZATION|私人公司/);
});

test('online lookup times out and leaves the answer path available',async()=>{
 const start=Date.now();const result=await lookup('Python 基础问题',{fetchImpl:()=>new Promise(()=>{}),timeoutMs:20});
 assert.equal(result.status,'unavailable');assert.ok(Date.now()-start<1000);
});

test('speech prefetch and answer reuse the same online request',async()=>{
 let calls=0,resolve;const gate=new Promise(r=>{resolve=r});
 const fetchImpl=async()=>{calls++;await gate;return {ok:true,text:async()=>JSON.stringify({query:{search:[{title:'TCP',snippet:'在线知识'}]}})}};
 prime('TCP 连接如何建立？',fetchImpl);const result=lookup('TCP 连接如何建立？',{fetchImpl});resolve();
 assert.equal((await result).status,'ok');assert.equal(calls,1);
});

test('oral policy asks for natural spoken SQL alongside complete code',()=>{
 const p=require('../src/oral-answer-policy');const plan=p.plan('SQL 怎么设计查询每个人的最新订单？');assert.equal(plan.code,true);
 const instruction=p.instruction(plan);assert.match(instruction,/自然.*中文/);assert.match(instruction,/完整代码或 SQL/);assert.match(instruction,/不要在口述段说 GROUP BY 或 HAVING/);assert.match(instruction,/一种完整正确/);assert.doesNotMatch(instruction,/1\. 提示词/);
});
