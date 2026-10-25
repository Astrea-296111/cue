'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createInterviewRuntime}=require('./helpers/interview-agent-runtime');
const {fixture}=require('./helpers/material-fixture');
const {migrateFactIndex}=require('../src/project-fact-packs');

for(const mode of ['instant','standard'])test(`${mode}: imported candidate and selected role reach personal answers without requiring a project route`,async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:mode}});
  const workspace={schemaVersion:2,facts:migrateFactIndex(fixture(2)),profile:{resumeText:'Synthetic candidate; school excerpt; sample@example.test',jobDescription:'SYNTHETIC_AI_REQUIREMENTS',
    candidateProfile:{name:'SYNTHETIC_CANDIDATE',subjectRole:'candidate',education:[{school:'SYNTHETIC_UNIVERSITY',degree:'硕士',period:'2025–2028'}],availability:{days_per_week:5,duration_months:6},employment:[],projects:[],resumeProjectOrder:['cae','arclight'],doNotInfer:['没有生产KMS经历']},
    jobProfiles:[{id:'ai_supply_chain',label:'Synthetic AI',priorityTopics:['Agent'],jobDescription:'SYNTHETIC_AI_REQUIREMENTS',selfIntroductions:{seconds30:'合成AI自介',seconds60:'合成AI较长自介'}},{id:'java_security',label:'Synthetic Java',priorityTopics:['Java'],jobDescription:'SYNTHETIC_JAVA_REQUIREMENTS',selfIntroductions:{seconds30:'合成Java自介',seconds60:'合成Java较长自介'}}],activeJobProfileId:'ai_supply_chain'}};
  const p=await app.invoke('materials:personal:prepare',{workspace});await app.invoke('materials:personal:commit',{token:p.token,baseGeneration:p.baseGeneration});
  await app.ask('say','用30秒介绍一下自己，说明学历和到岗时间。');
  const first=JSON.stringify(app.calls.at(-1).messages);
  for(const text of ['SYNTHETIC_CANDIDATE','SYNTHETIC_UNIVERSITY','ai_supply_chain','SYNTHETIC_AI_REQUIREMENTS','合成AI自介'])assert.ok(first.includes(text),text);
  assert.ok(!first.includes('sample@example.test'));
  assert.equal(app.requests.at(-1).plan.retrieve,false);
  const facts=app.snapshot('materialService.snapshot.factRevision');
  await app.invoke('materials:personal:job',{jobProfileId:'java_security'});
  await app.ask('say','请用60秒自我介绍。');
  const second=JSON.stringify(app.calls.at(-1).messages);
  for(const text of ['SYNTHETIC_CANDIDATE','java_security','SYNTHETIC_JAVA_REQUIREMENTS','合成Java较长自介'])assert.ok(second.includes(text),text);
  assert.ok(!second.includes('SYNTHETIC_AI_REQUIREMENTS'));
  assert.equal(app.snapshot('materialService.snapshot.factRevision'),facts);
});

test('evaluation imports candidate data through the personal preview/commit path and preserves its revision',async t=>{
  const app=createInterviewRuntime(t,{inMemorySettings:true,persistProfile:true,settings:{realtimeAnswerMode:'instant',apiKeys:{custom:'EVALUATION_MEMORY_ONLY_KEY'}}});
  const {validatePersonalWorkspace}=require('../src/personal-workspace');
  const {importMaterials}=require('../scripts/evaluate-multiturn-projects.cjs');
  const {loadTrustedSources}=require('../scripts/evaluate-private-projects.cjs');
  const workspace=validatePersonalWorkspace({schemaVersion:2,facts:migrateFactIndex(fixture(2)),profile:{
    resumeText:'SYNTHETIC_RESUME',jobDescription:'AI_REFERENCE',
    candidateProfile:{name:'ENTRY_CANDIDATE',subjectRole:'candidate',education:[],availability:{},employment:[],projects:[],resumeProjectOrder:['cae','arclight'],doNotInfer:[]},
    jobProfiles:[{id:'ai_supply_chain',label:'AI',priorityTopics:[],jobDescription:'AI_REFERENCE'},{id:'java_security',label:'Java',priorityTopics:[],jobDescription:'JAVA_REFERENCE'}],activeJobProfileId:'ai_supply_chain'},
    sourceManifest:[{path:'synthetic-source.txt',bytes:1,sha256:'a'.repeat(64)}],mergeLog:[]});
  const result=await importMaterials(app,{...workspace,judgeReference:{privateOracle:'JUDGE_ONLY_SENTINEL'}},loadTrustedSources());
  assert.equal(result.importMethod,'production-personal-preview-commit');
  const settings=app.exports('src/store.js').getSettings();
  assert.equal(settings.personalWorkspaceRevision,workspace.revision);
  assert.equal(settings.personalWorkspace.sourceCount,1);
  assert.equal(settings.candidateProfile.name,'ENTRY_CANDIDATE');
  const fs=require('node:fs'),path=require('node:path');
  const persisted=fs.readFileSync(path.join(app.temp,'cue-data.json'),'utf8');
  assert.equal(JSON.parse(persisted).personalWorkspaceRevision,workspace.revision);
  assert.ok(!persisted.includes('EVALUATION_MEMORY_ONLY_KEY'));
  assert.equal(settings.apiKeys.custom,'EVALUATION_MEMORY_ONLY_KEY');
  await app.ask('say','请介绍一下自己。');
  assert.match(JSON.stringify(app.calls.at(-1).messages),/ENTRY_CANDIDATE/);
  assert.doesNotMatch(JSON.stringify(settings)+JSON.stringify(app.calls),/JUDGE_ONLY_SENTINEL/);
});
