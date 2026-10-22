'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const {ProjectFactPacks,validateIndex,compileProjectPacks}=require('../src/project-fact-packs');
const {createFirstContentDeadline}=require('../src/first-content-deadline');
const {createLLM}=require('../src/llm');
const {resolveChatRequestOptions,resolveProviderCapabilities}=require('../src/openai-compatible');
const {normalizeUsage}=require('../src/provider-metrics');
const {resolveQwenAsrConfig}=require('../src/stt-providers/qwen');
const {buildInstantContext}=require('../src/instant-answer-context');
const {prepareFinalRequest}=require('../src/final-request-budget');

test('independent first-content deadline ignores whitespace/reasoning and cleans up on content/cancel',()=>{
 let callback,removed=0,timed=0;
 const make=()=>createFirstContentDeadline({ms:6000,onTimeout:()=>timed++,setTimer:(fn,ms)=>{assert.equal(ms,6000);callback=fn;return 3;},clearTimer:()=>removed++});
 const d=make();d.dispatch();d.dispatch();d.content('  ');callback();assert.equal(timed,1);assert.equal(d.content('迟到'),false);
 const second=make();second.dispatch();second.content('正文');callback();assert.equal(timed,1);assert.ok(removed>0);
 const third=make();third.dispatch();third.dispose();callback();assert.equal(timed,1);
});
test('official Qwen 3.8 and DeepSeek emit different top-level controls; spoof host remains unknown',()=>{
 assert.deepEqual(resolveChatRequestOptions({baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash',smart:false}),{enable_thinking:false});
 assert.deepEqual(resolveChatRequestOptions({baseURL:'https://api.deepseek.com',model:'deepseek-flash',smart:false,explicit:{reasoning_effort:'high',enable_thinking:true}}),{thinking:{type:'disabled'}});
 assert.equal(resolveProviderCapabilities({baseURL:'https://dashscope.aliyuncs.com.attacker.test/compatible-mode/v1',model:'qwen3.8-flash'}).thinkingCapability,'unknown');
 assert.equal(resolveProviderCapabilities({baseURL:'https://api.deepseek.com',model:'deepseek-flash'}).imageCapability,'supported');
 assert.deepEqual(resolveChatRequestOptions({baseURL:'https://private-gateway.invalid/v1',model:'qwen3.8-flash',smart:false,protocolPreset:'dashscope'}),{enable_thinking:false});
});
test('provider migration round trips both keys/models through restart and leaves Qwen ASR binding unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cue-settings-'));
 const file=path.join(dir,'cue-data.json');fs.writeFileSync(file,JSON.stringify({provider:'custom',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKeys:{custom:'qwen-test'},models:{custom:{fast:'qwen3.8-flash',smart:'qwen3.8-flash'}}}));
 function store(){const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/store.js'),'utf8'),{module:mod,require:id=>id==='electron'?{app:{getPath:()=>dir}}:require(id.startsWith('.')?path.join(__dirname,'../src',id):id)});return mod.exports;}
 try{
 const st=store();assert.equal(st.getSettings().models.deepseek.fast,'deepseek-flash');
 st.setSettings({provider:'deepseek',apiKeys:{deepseek:'deep-test'},models:{deepseek:{fast:'edited-model',smart:'deepseek-flash'}}});
 const next=store().getSettings();assert.equal(next.apiKeys.custom,'qwen-test');assert.equal(next.apiKeys.deepseek,'deep-test');assert.equal(next.models.custom.fast,'qwen3.8-flash');assert.equal(next.models.deepseek.fast,'edited-model');
 const asr=resolveQwenAsrConfig(next);assert.equal(asr.apiKey,'qwen-test');assert.equal(asr.websocketUrl,'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
 assert.equal(createLLM({...next,models:{...next.models,deepseek:{fast:'deepseek-flash'}}},{executionProfile:'instant'}).apiKey,'deep-test');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('pack validation rejects identity, references, versions, traversal and conflicting facts; replacement atomic',()=>{
 const packs=new ProjectFactPacks(),base=packs.getIndex();assert.ok(compileProjectPacks().cards.length>=20);
 for(const edit of [x=>x.schemaVersion=9,x=>x.cards[1].cardId=x.cards[0].cardId,x=>x.cards[0].path='../secret',x=>x.cards[0].related=['missing'],x=>x.projects[1].aliases.push('Arclight'),x=>x.cards[0].status='invented']){
  const invalid=JSON.parse(JSON.stringify(base));edit(invalid);assert.throws(()=>packs.replace(invalid));assert.equal(packs.getIndex().revision,base.revision);
 }
 const conflict=JSON.parse(JSON.stringify(base));conflict.cards.push({...conflict.cards[0],cardId:'arclight.conflict',facts:conflict.cards[0].facts.map(f=>({...f,value:'conflict'}))});assert.throws(()=>validateIndex(conflict),/冲突/);
});
test('selection covers ownership/collaboration, switch and generic bypass without turning code into personal ownership',()=>{
 const p=new ProjectFactPacks();
 let r=p.select('Arclight 你负责什么，团队如何分工？');assert.ok(r.evidence.some(c=>c.cardId==='arclight.ownership'));assert.ok(r.evidence.some(c=>c.cardId==='arclight.collaboration'));assert.ok(r.evidence.filter(c=>['ownership','collaboration'].includes(c.docType)).every(c=>c.status==='missing'));
 r=p.select('CAE 这个困难怎么解决？',{anchor:r.anchor});assert.deepEqual(r.projectIds,['cae']);assert.ok(r.evidence.every(c=>c.projectId==='cae'));
 assert.equal(p.select('Redis 的过期策略是什么？',{projectId:'cae',anchor:r.anchor}).evidence.length,0);
 const compare=p.select('比较 Arclight 与 CAE 的实现');assert.deepEqual(new Set(compare.projectIds),new Set(['arclight','cae']));assert.ok(compare.evidence.some(c=>c.projectId==='cae'));assert.ok(compare.evidence.some(c=>c.projectId==='arclight'));
 const first=p.select('CAE 你负责什么？'),neg=p.select('CAE 你不负责什么？');assert.notEqual(first.stats.cacheKey,neg.stats.cacheKey);
 const local=p.select('CAE 性能压测数字');assert.ok(local.evidence.find(c=>c.provenance==='LOCAL-BENCH'));assert.ok(local.localFacts.every(c=>!c.text.includes('[LOCAL-BENCH')));
});
test('selected fact cards survive typed context and final visibility with full frozen question',()=>{
 const p=new ProjectFactPacks(),question='CAE 资源预占怎么避免超卖？不能把 UNKNOWN 当完成。';const ready={evidence:p.select(question).evidence};
 const ctx=buildInstantContext({question,request:{plan:{retrieve:true,projectLabel:'CAE'},turns:[]},readyEvidence:ready});
 const final=prepareFinalRequest({system:ctx.system,currentSections:ctx.currentSections,evidence:ctx.evidence,maxTokens:400,contextWindow:16384});
 assert.ok(final.fits);assert.ok(final.evidence.length>0);assert.ok(final.turns.some(t=>t.text.includes(question)));assert.ok(final.evidence.every(c=>final.system.includes(c.text)));
});
test('DeepSeek cache usage remains actual and missing metrics are not invented',()=>{
 assert.deepEqual(normalizeUsage('openai-compatible',{prompt_cache_hit_tokens:15}),{cachedInputTokens:15});
});

test('actual Node SDK HTTP serialization puts thinking at top level and preserves screenshot payload',async()=>{
 const {createRequire}=require('module'),file=path.join(__dirname,'../src/llm.js'),native=createRequire(file),Actual=require('openai');
 const bodies=[],clients=[];
 class OpenAI extends Actual {constructor(options){clients.push(options);super({...options,fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'hidden'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'结论。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});}}
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,require:id=>id==='openai'?OpenAI:native(id),Buffer,URL,Headers,TextDecoder});
 for(const provider of ['custom','deepseek']){
 const settings={provider,smart:true,baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',deepseekBaseUrl:'https://api.deepseek.com',apiKeys:{custom:'qwen-test',deepseek:'deep-test'},models:{custom:{fast:'qwen3.8-flash'},deepseek:{fast:'deepseek-flash'}},providerOptions:{[provider]:{reasoning_effort:'high',enable_thinking:true}}};
 const tokens=[],events=[],llm=mod.exports.createLLM(settings,{executionProfile:'instant'});
 await llm.stream({system:'当前测试',turns:[{role:'user',text:'回答'}],imageDataUrl:'data:image/png;base64,AA==',onToken:x=>tokens.push(x),onActivity:e=>events.push(e),mode:'ask'});
 assert.deepEqual(tokens,['结论。']);assert.ok(events.some(e=>e.phase==='reasoning'));
 const body=bodies.at(-1);assert.equal(body.extra_body,undefined);assert.equal(body.reasoning_effort,undefined);assert.ok(body.messages.at(-1).content.some(p=>p.type==='image_url'));
 if(provider==='custom'){assert.equal(body.enable_thinking,false);assert.equal(clients.at(-1).apiKey,'qwen-test');}else{assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.enable_thinking,undefined);assert.equal(clients.at(-1).apiKey,'deep-test');}
 }
});

test('real answer entry aborts reasoning-only stream at first-content deadline and rejects late content',async t=>{
 const {createInterviewRuntime}=require('./helpers/interview-agent-runtime');
 const r=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'instant',firstContentDeadlineMs:100}});
 let signal;
 r.behavior(async(_body,options)=>{signal=options.signal;return (async function*(){for(let i=0;i<12;i++){await new Promise(resolve=>setTimeout(resolve,20));yield {choices:[{delta:{reasoning_content:'仍在思考'}}]};}yield {choices:[{delta:{content:'迟到的答案'},finish_reason:'stop'}]};})();});
 await r.ask('say','CAE 资源预占是什么？');
 assert.equal(signal.aborted,true);assert.ok(r.events.some(e=>e.channel==='llm:error'&&e.timeout));
 assert.equal(r.commits.length,0);assert.ok(r.events.some(e=>e.channel==='llm:local-facts'));
 await new Promise(resolve=>setTimeout(resolve,160));
 assert.ok(!r.events.some(e=>e.channel==='llm:token'&&e.text.includes('迟到')));
 const metric=r.events.filter(e=>e.channel==='llm:metrics').at(-1);assert.equal(metric.firstContentMs,null);
});
