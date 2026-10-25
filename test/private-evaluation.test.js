'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluatePrivate, validatePrivatePayload, importPrivateMaterials } = require('../scripts/evaluate-private-projects.cjs');

test('judge-only continuation preserves archived answers and never creates a production runtime',async t=>{
  const {validatePersonalWorkspace}=require('../src/personal-workspace');
  const {projectJudgeReference}=require('../scripts/lib/evaluation-workspace.cjs');
  const {projectCase,validateRecoveryPayload,evaluateRecovery,hash}=require('../scripts/lib/judge-recovery.cjs');
  const workspace=validatePersonalWorkspace({schemaVersion:1,facts:fixture(),profile:{resumeText:'Synthetic candidate',jobDescription:'Synthetic role'}});
  const reference=projectJudgeReference(workspace),trusted='b'.repeat(40);
  const original={id:'archived-one',sessionId:'session-one',repeat:1,question:'How does synthetic recovery work?',answer:'ARCHIVED_ANSWER_ONLY',
    attempted:true,status:'passed',transportStatus:'passed',dialogueEvents:[],scenarioEvaluation:{expected_route:'cae',must_convey:[],must_not_assert:[]}};
  const providers=[{id:'qwen',model:'synthetic-qwen',cases:[projectCase(original)]}];
  const input={schemaVersion:3,kind:'judge-recovery',workspace,judgeReference:reference,
    source:{repository:'example/cue',trustedSha:trusted,combinedReportSha256:'a'.repeat(64),payloadSha256:'c'.repeat(64),selectedCasesSha256:hash(providers),generationCallsObserved:1,
      partition:{index:0,count:1},authenticationBoundary:'synthetic authenticated-source test',artifacts:[{runId:'123',runAttempt:'1',commitSha:trusted,
        fingerprint:'d'.repeat(64),envelopeSha256:'e'.repeat(64),reportSha256:'f'.repeat(64),checkpointSha256:null}]},
    report:{application:{commit:'a'.repeat(40)},build:{commit:trusted},inputs:{factsSha256:hash(workspace.facts),profileSha256:hash(workspace.profile),judgeReferenceSha256:reference.sha256},providers},
    evaluation:{concurrency:1,shardCount:1,shardIndex:0}};
  assert.equal(validatePrivatePayload(input).kind,'judge-recovery');
  const changed=structuredClone(input);changed.report.providers[0].cases[0].answer='changed';assert.throws(()=>validateRecoveryPayload(changed),/digest/);
  const oversized=structuredClone(input);oversized.source.authenticationBoundary='x'.repeat(8*1024*1024);assert.throws(()=>validateRecoveryPayload(oversized),/oversized/);
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'cue-judge-only-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
  const transport=require('../scripts/e2e-live-llm.cjs'),create=transport.createProviderRuntime;
  transport.createProviderRuntime=()=>{throw Error('Judge-only continuation must not create a CUE runtime');};
  let judgeInvocations=0;
  try {
    const result=await evaluateRecovery({payload:input,outputDir:d,env:{},evaluateJudgesImpl:async({report})=>{judgeInvocations++;report.status='unverified';return report;}});
    assert.equal(judgeInvocations,1);assert.equal(result.budget.attemptedCalls,0);
    assert.equal(result.recovery.generationExecutedThisRun,0);
    assert.equal(result.providers[0].cases[0].answer,original.answer);
    assert.equal(result.providers[0].cases[0].attempted,false);
    assert.equal(result.providers[0].cases[0].archivedGeneration.attempted,true);
  }finally{transport.createProviderRuntime=create;}
});
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { fixture, sourceFixture } = require('./helpers/material-fixture');
const {migrateFactIndex}=require('../src/project-fact-packs');
const {validatePersonalWorkspace}=require('../src/personal-workspace');
const {projectJudgeReference}=require('../scripts/lib/evaluation-workspace.cjs');
const payload = () => ({ schemaVersion: 1, facts: fixture(), profile: { resumeText: '合成测试简历：我负责CAE Java后端。', jobDescription: '合成测试JD：Java与可靠性工程。' } });

test('private payload accepts bounded data only and never allows caller paths, settings, code or oracle regexes', () => {
  assert.equal(validatePrivatePayload(payload()).facts.cards.length, 8);
  for (const extra of [{ path: '/home/private' }, { suite: [] }, { code: 'throw new Error()' }]) assert.throws(() => validatePrivatePayload({ ...payload(), ...extra }));
  assert.throws(() => validatePrivatePayload({ ...payload(), profile: { ...payload().profile, apiKeys: { custom: 'secret' } } }));
  assert.throws(() => validatePrivatePayload({ ...payload(), caseIds: Array.from({ length: 13 }, (_, index) => 'case-' + index) }));
  assert.throws(() => validatePrivatePayload({ ...payload(), profile: { ...payload().profile, resumeText: 'a'.repeat(256 * 1024 + 1) } }));
});

test('multi-turn canonical reference validates data and combined size while preserving the real import revision and manifest',()=>{
  const workspace=validatePersonalWorkspace({schemaVersion:2,facts:migrateFactIndex(fixture(2)),profile:{resumeText:'Synthetic reference',jobDescription:'AI',
    candidateProfile:{subjectRole:'candidate',education:[],employment:[],projects:[],resumeProjectOrder:['cae','arclight'],doNotInfer:['No team size supplied'],availability:{}},
    jobProfiles:[{id:'ai_supply_chain',label:'AI',jobDescription:'AI',priorityTopics:[]},{id:'java_security',label:'Java',jobDescription:'Java',priorityTopics:[]}],activeJobProfileId:'ai_supply_chain'},
    sourceManifest:[{path:'inputs/resume.pdf',sha256:'a'.repeat(64),bytes:10}],mergeLog:[{action:'synthetic migration'}]});
  const scenarios={schema_version:'cue_multiturn_seed_v1',sessions:[{id:'anonymous',execution_profile:'instant',events:[{event_id:'q1',speaker:'interviewer',channel:'them',text:'Synthetic question',is_final:true,invoke_cue:true}]}]};
  const input={...workspace,scenarios,judgeReference:projectJudgeReference(workspace)};
  const validated=validatePrivatePayload(input);
  assert.equal(validated.revision,workspace.revision);assert.deepEqual(validated.sourceManifest,workspace.sourceManifest);assert.deepEqual(validated.mergeLog,workspace.mergeLog);
  assert.equal(validated.judgeReference.sha256,input.judgeReference.sha256);
  assert.throws(()=>validatePrivatePayload({...input,sourceManifest:[]}),/摘要不匹配/);
  assert.throws(()=>validatePrivatePayload({...input,judgeReference:{...input.judgeReference,code:'execute this'}}),/judge-only reference/);
  const changed=structuredClone(input.judgeReference);changed.profile.resumeText='Unbound changed source';
  assert.throws(()=>validatePrivatePayload({...input,judgeReference:changed}),/digest mismatch/);
  const badProfile=structuredClone(input.judgeReference);badProfile.profile.apiKeys={provider:'secret'};
  assert.throws(()=>validatePrivatePayload({...input,judgeReference:badProfile}),/字段无效/);
  const large=structuredClone(workspace);delete large.revision;large.facts.sourceDocuments={'synthetic/large-reference.txt':'x'.repeat(Math.ceil(4.1*1024*1024))};
  const largeWorkspace=validatePersonalWorkspace(large),largeReference=projectJudgeReference(largeWorkspace);
  assert.throws(()=>validatePrivatePayload({...largeWorkspace,scenarios,judgeReference:largeReference}),/Invalid multi-turn private payload/);
});

test('missing private live configuration fails with zero external calls and never writes private data to Actions Summary', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-private-evaluation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const summary = path.join(directory, 'public-summary.md');
  const report = await evaluatePrivate({ payload: payload(), outputDir: directory,
    env: { QWEN_API_KEY: 'secret-test-only-never-report', GITHUB_STEP_SUMMARY: summary } });
  assert.equal(report.kind, 'live'); assert.equal(report.status, 'failed'); assert.equal(report.budget.attemptedCalls, 0);
  assert.equal(report.providers.length, 2); assert.equal(report.privacy.publicAnswerArtifactsAllowed, false);
  assert.equal(fs.existsSync(summary), false);
  const saved = fs.readFileSync(path.join(directory, 'report.json'), 'utf8');
  assert.ok(!saved.includes('secret-test-only-never-report'));
  assert.ok(report.providers.every(provider => provider.error.code === 'configuration'));
});

test('private compiled facts/sources and resume/JD enter the actual production material service and text question path', async t => {
  const runtime = createInterviewRuntime(t, { chunks: [], inMemorySettings: true, realTime: true });
  const input = validatePrivatePayload(payload());
  const imported = await importPrivateMaterials(runtime, input, sourceFixture());
  assert.equal(imported.counts.facts, input.facts.cards.length);
  assert.equal(imported.counts.sourceProjects, 2); assert.equal(imported.resumeImported, true); assert.equal(imported.jobDescriptionImported, true);
  await runtime.ask('say', '你在 CAE 项目负责什么？');
  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.requests[0].plan.projectIds, ['cae']);
  const settings = runtime.exports('src/store.js').getSettings();
  assert.equal(settings.resumeText, input.profile.resumeText); assert.equal(settings.jobDescription, input.profile.jobDescription);
  assert.ok(!fs.readFileSync(path.join(runtime.temp, 'cue-data.json'), 'utf8').includes(input.profile.resumeText));
});
