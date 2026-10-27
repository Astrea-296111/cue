#!/usr/bin/env node
'use strict';
// Real PCM IPC -> production VAD/ASR WebSocket -> production speech ledger.
// Fixtures are public synthetic speech. No microphone or desktop is simulated
// as physical hardware, and the transport is never replaced in this runner.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');
const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');
const {sanitizeReport}=require('./lib/live-evaluation-report.cjs');
const ROOT=path.resolve(__dirname,'..');
function wavPCM(file) {
  const data=fs.readFileSync(file);
  if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw new Error('Expected a PCM WAV fixture');
  let format,pcm;
  for(let at=12;at+8<=data.length;) {
    const size=data.readUInt32LE(at+4),end=at+8+size;
    if(end>data.length)throw new Error('Invalid WAV chunk');
    const kind=data.toString('ascii',at,at+4);
    if(kind==='fmt ') {
      if(size<16)throw new Error('Invalid WAV format chunk');
      format={encoding:data.readUInt16LE(at+8),channels:data.readUInt16LE(at+10),sampleRate:data.readUInt32LE(at+12),bits:data.readUInt16LE(at+22)};
    }
    if(kind==='data')pcm=data.subarray(at+8,end);
    at=end+(size%2);
  }
  if(!pcm?.length||pcm.length%2||!format||format.encoding!==1||format.channels!==1||format.sampleRate!==16000||format.bits!==16)throw new Error('Fixture must be nonempty mono 16kHz PCM16');
  return {pcm,sha256:crypto.createHash('sha256').update(data).digest('hex'),durationMs:pcm.length/32};
}
async function startAudioCapture(runtime) {
  await runtime.ready;await runtime.invoke('capture:toggle');
  const deadline=Date.now()+20000;
  while(!['you','them'].every(channel=>runtime.events.some(e=>e.channel===channel&&e.status==='connected'))) {
    const error=runtime.events.find(e=>e.channel==='status'&&/异常|已停止/.test(e.message||''));
    if(error)throw new Error(error.message);
    if(Date.now()>deadline)throw new Error('Real ASR connections did not become ready');
    await pause(100);
  }
}
async function feedWavFixture(runtime,{channel,file,expectedText}) {
  if(!['you','them'].includes(channel))throw new Error('Invalid fixture channel');
      const fixture=wavPCM(file);
      const eventStart=runtime.events.length;
      const before=(await runtime.invoke('dialogue:snapshot')).events.length;
      const started=performance.now();
      for(let offset=0;offset<fixture.pcm.length;offset+=3200) {runtime.audio(channel,fixture.pcm.subarray(offset,offset+3200));await pause(100);}
      const audioEnd=performance.now(),audioEndEpochMs=Date.now();
      for(let i=0;i<15;i++) {runtime.audio(channel,Buffer.alloc(3200));await pause(100);}
      let events=[],lastSignature='',lastChange=Date.now();const until=Date.now()+15000;
      while(Date.now()<until) {
        events=(await runtime.invoke('dialogue:snapshot')).events.slice(before).filter(e=>e.channel===channel&&e.isFinal);
        const signature=JSON.stringify(events.map(e=>[e.eventId,e.revision,e.text]));
        if(signature!==lastSignature) {lastSignature=signature;lastChange=Date.now();}
        // One WAV can produce multiple final utterances (the candidate fixture
        // contains a correction). Retain the stable final set, not just its
        // first sentence, without claiming exact-word accuracy.
        if(events.length&&Date.now()-lastChange>=800)break;
        await pause(100);
      }
      const vadEvents=runtime.events.slice(eventStart).filter(e=>e.channel===channel&&typeof e.speaking==='boolean');
      const receivedTimes=events.map(e=>e.receivedAt).filter(Number.isFinite);
      const lastFinalReceivedAt=receivedTimes.length?Math.max(...receivedTimes):null;
      const speechEndedAt=vadEvents.findLast(e=>!e.speaking)?.speechEndedAt??null;
      return {channel,fixture:path.basename(file),fixtureSha256:fixture.sha256,fixtureDurationMs:fixture.durationMs,expectedText,events,
        vadEvents,
        finishedObservationMs:Math.round(performance.now()-started),audioEndToObservationMs:events.length?Math.round(performance.now()-audioEnd):null,
        pcmFeedEndEpochMs:audioEndEpochMs,lastFinalReceivedAt,
        pcmFeedEndToLastFinalMs:lastFinalReceivedAt==null?null:lastFinalReceivedAt-audioEndEpochMs,
        vadSpeechEndToLastFinalMs:lastFinalReceivedAt==null||speechEndedAt==null?null:lastFinalReceivedAt-speechEndedAt,
        timingBoundary:'Final latency uses the production ledger callback receivedAt, independently of polling. Observation latency includes 1500ms injected trailing silence, at least 800ms final-set stability and up to 100ms polling. PCM feed end and the production VAD offset are software timestamps, not a physical acoustic endpoint; negative final deltas are retained.',
        passed:events.length>0&&events.every(e=>e.speaker===(channel==='you'?'candidate':'interviewer'))&&vadEvents.some(e=>e.speaking)&&vadEvents.some(e=>!e.speaking)};
}
async function evaluateAudio({outputDir=path.join(ROOT,'artifacts/audio-fixture'),env=process.env}={}) {
  const cleanups=[],key=env.QWEN_ASR_API_KEY||env.QWEN_API_KEY,realAnswer=env.CUE_AUDIO_REAL_LLM==='true',answerKey=env.QWEN_LLM_API_KEY||env.QWEN_API_KEY;
  const report={schemaVersion:1,kind:'live-asr',startedAt:new Date().toISOString(),status:'running',channels:[],usage:null,
    boundaries:{physicalMicrophone:false,physicalLoopback:false,realASR:true,realProductionPCMIPC:true,realProductionDialogueLedger:true,wordAccuracy:'Full synthetic text and recognized text retained for review; role/event assertions do not prove all word accuracy.'}};
  const save=()=>{fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(sanitizeReport(report,{secrets:[key,answerKey].filter(Boolean),workspaceRoot:ROOT}),null,2)+'\n');};
  let runtime;
  try {
    if(!key)throw new Error('QWEN_API_KEY is not configured for real ASR');
    if(realAnswer&&(!env.QWEN_MODEL||!answerKey))throw new Error('QWEN_MODEL and a real answer key are required');
    report.boundaries.realLLM=realAnswer;
    const {DEFAULT_QWEN_ASR_MODEL,resolveQwenAsrConfig}=require('../src/stt-providers/qwen');
    const model=env.QWEN_ASR_MODEL||DEFAULT_QWEN_ASR_MODEL;
    const qwenAsr={apiKey:key,model,language:'en',useResume:false,useProjectKnowledge:false,useJobDescription:false,
      ...(env.QWEN_ASR_WEBSOCKET_URL?{websocketUrl:env.QWEN_ASR_WEBSOCKET_URL}:{})};
    const baseUrl=env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const resolved=resolveQwenAsrConfig({baseUrl,qwenAsr});
    report.model=model;report.servedModel=null;report.configuredChannels=2;
    report.endpoint={host:new URL(resolved.websocketUrl).host,protocol:new URL(resolved.websocketUrl).protocol};
    runtime=createInterviewRuntime({after:f=>cleanups.push(f)},{liveSpeech:true,inMemorySettings:true,realTime:true,
      settings:{provider:'custom',baseUrl,apiKeys:{custom:answerKey||key},sttProvider:'qwen',qwenAsr,...(realAnswer?{models:{custom:{fast:env.QWEN_MODEL,smart:env.QWEN_MODEL}},realtimeAnswerMode:'instant',providerProtocolPresets:{custom:'dashscope'},instantProviderOptions:{custom:{enable_thinking:false}}}:{})},
      ...(realAnswer?{liveTransport:{maxOutputTokens:1000,totalTimeoutMs:45000,firstContentTimeoutMs:6000,onAttempt:()=>{report.modelAttempts=(report.modelAttempts||0)+1;if(report.modelAttempts>1)throw new Error('Real ASR answer call cap exceeded');}}}:{})});
    report.build=runtime.snapshot('redactedDiagnostics().build');
    report.appCodeSha256=require('./eval-public.cjs').sourceIdentity(ROOT);
    await startAudioCapture(runtime);
    // Remember the key before any text; final CI enables real LLM transport.
    await runtime.ask('say');
    for(const [channel,file,expectedText] of [['them','interviewer.wav','How do you prevent duplicate task execution?'],['you','candidate.wav','I said Kafka. I meant Rabbit M Q.']]) {
      report.channels.push(await feedWavFixture(runtime,{channel,file:path.join(ROOT,'test/fixtures/dual-audio',file),expectedText}));save();
    }
    if(realAnswer){const deadline=Date.now()+45000;while(runtime.snapshot('state.busy')&&Date.now()<deadline)await pause(100);}
    report.answer=runtime.events.filter(e=>e.channel==='llm:token').map(e=>e.text).join('');
    report.answerRequest=runtime.calls[0]||null;report.actualAnswer=runtime.snapshot('redactedDiagnostics().lastActualRequest');
    report.servedAnswerModels=[...new Set(runtime.providerChunks.map(p=>p.model).filter(Boolean))];
    const answerAt=runtime.events.findIndex(e=>e.channel==='llm:start');
    const speechFinal=runtime.events.findIndex(e=>e.eventType==='transcript'&&e.channel==='them');
    const target=runtime.snapshot('lastFrozenSnapshot');
    report.earlySubmit={realASR:true,modelTransport:realAnswer?'real':'mock',rememberedBeforeText:true,modelCalls:runtime.calls.length,
      beforeInterviewerFinal:answerAt>=0&&speechFinal>=0&&answerAt<speechFinal,asrFinalAtDispatch:target?.asrFinal??null,
      question:target?.text||null,questionId:target?.questionId||null,questionRevision:target?.revision??null,
      semanticStatus:target?.semanticStatus||null,observedAt:target?.observedAt||null,
      note:'Ordering is production provider callback / IPC delivery, not microphone acoustic timing. Synthetic WAV is fed in real time.'};
    report.earlySubmit.passed=report.earlySubmit.beforeInterviewerFinal&&report.earlySubmit.asrFinalAtDispatch===false&&runtime.calls.length===1&&(!realAnswer||report.actualAnswer?.status==='completed');
    report.status=report.channels.length===2&&report.channels.every(c=>c.passed)&&report.earlySubmit.passed?'passed':'failed';
  }catch(error){report.status='failed';report.error=String(error.message);}
  finally {
    if(runtime) {
      if(runtime.snapshot('state.capturing')) {
        await runtime.invoke('capture:toggle').catch(()=>{});
        // Production disconnect finishes its task and closes after at most
        // 800 ms. The harness disposal clears owned timers, so allow this timer
        // to run before disposing instead of stranding a live socket.
        await pause(900);
      }
      // The observation helper flattens the IPC envelope: speech status carries
      // its source channel ('you'/'them'), not the original 'stt:status' key.
      report.providerStatuses=runtime.events.filter(e=>['you','them'].includes(e.channel)&&typeof e.status==='string');
      report.connectionAttempts=report.providerStatuses.filter(e=>e.status==='connecting').length;
      report.readyConnections=report.providerStatuses.filter(e=>e.status==='connected').length;
    }
    for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.message);}
    report.finishedAt=new Date().toISOString();save();
  }
  return report;
}
module.exports={evaluateAudio,wavPCM,startAudioCapture,feedWavFixture};
if(require.main===module)evaluateAudio({outputDir:path.resolve(process.argv[2]||'artifacts/audio-fixture')}).then(report=>{console.log(JSON.stringify({status:report.status,model:report.model,channels:report.channels.length,physicalHardwareVerified:false}));process.exitCode=report.status==='passed'?0:1;}).catch(()=>{process.stderr.write('Real ASR evaluation setup failed.\n');process.exitCode=1;});
