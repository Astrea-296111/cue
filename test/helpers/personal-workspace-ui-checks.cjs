'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./material-fixture');
const {validatePersonalWorkspace} = require('../../src/personal-workspace');
const {ProjectMaterialService} = require('../../src/project-material-service');
const {migrateFactIndex} = require('../../src/project-fact-packs');

// Synthetic identities and statements only; real renderer/preload/IPC/storage.
module.exports = async function({js,until,data,selectMaterial,verifyProtected}) {
  const facts = migrateFactIndex(fixture(4));
  facts.cards = facts.cards.map(card => ({...card,cardId:card.cardId.replace('.synthetic-', '.personal-ui-')}));
  const workspace = validatePersonalWorkspace({schemaVersion:2,facts,profile:{
    resumeText:'PROFILE_RETAINED',jobDescription:'JD_RETAINED',
    candidateProfile:{name:'合成候选人',subjectRole:'candidate',education:[],employment:[],projects:[],resumeProjectOrder:['cae','arclight'],availability:{},doNotInfer:[]},
    jobProfiles:[{id:'ai_supply_chain',label:'合成 AI 岗位',jobDescription:'SYNTHETIC_AI_JD',priorityTopics:['Agent']},{id:'java_security',label:'合成 Java 岗位',jobDescription:'JD_RETAINED',priorityTopics:['Java']}],activeJobProfileId:'java_security'
  }});
  const file = path.join(data,'personal-workspace-fixture.json'); fs.writeFileSync(file,JSON.stringify(workspace));
  await js("document.querySelector('.s-tab[data-tab=personal]').click()");
  selectMaterial(file); await js("document.getElementById('personal-import').click()");
  await until(()=>js("!document.getElementById('personal-preview').hidden"),'single-file personal preview');
  await verifyProtected('#personal-preview');
  assert.match(await js("document.getElementById('personal-preview-summary').textContent"),/4 张卡；2 个岗位/);
  await js("document.getElementById('personal-confirm').click()");
  await until(()=>js("document.getElementById('personal-preview').hidden"),'personal committed');
  const imported = await js('cue.personalState()');
  assert.equal(imported.revision,workspace.revision); assert.equal(imported.activeJobProfileId,'java_security');
  await js("document.getElementById('personal-job').value='ai_supply_chain';document.getElementById('personal-job').dispatchEvent(new Event('change'))");
  await until(()=>js("document.getElementById('job-description').value==='SYNTHETIC_AI_JD'"),'job changes real settings');
  assert.equal((await js('cue.personalState()')).factRevision,imported.factRevision);
  await js("document.getElementById('personal-job').value='java_security';document.getElementById('personal-job').dispatchEvent(new Event('change'))");
  await until(()=>js("document.getElementById('job-description').value==='JD_RETAINED'"),'second role retained separately');
  await js("cue.settingsSet({resumeText:'PROFILE_LOCAL_EDIT'})");
  selectMaterial(file); await js("document.getElementById('personal-import').click()");
  await until(()=>js("!document.getElementById('personal-preview').hidden"),'duplicate personal preview');
  await js("document.getElementById('personal-confirm').click()");
  await until(()=>js("document.getElementById('personal-preview').hidden"),'duplicate personal applied');
  assert.equal((await js('cue.settingsGet()')).resumeText,'PROFILE_LOCAL_EDIT');
  const stored = await js('cue.getProjectFactPackStatus()');
  const restarted = new ProjectMaterialService({directory:data,bundled:stored.index});
  assert.equal(restarted.verifyPersisted(),true);
  assert.ok(restarted.snapshot.facts.cards.some(card=>card.cardId===facts.cards[0].cardId));
  await js("cue.dialogueEvent({eventId:'ui-spoken-1',speaker:'unknown',channel:'you',text:'合成材料，角色尚未确认',isFinal:true,revision:1,source:'manual'})");
  await js("document.getElementById('spoken-review').open=true");
  await until(()=>js("document.querySelector('#spoken-events .spoken-event')!==null"),'actual dialogue editable');
  await js("document.querySelector('#spoken-events select').value='candidate';document.querySelector('#spoken-events textarea').value='合成资料使用 RabbitMQ';document.querySelector('#spoken-events .spoken-save').click()");
  await until(async()=>{const d=await js('cue.dialogueSnapshot()');return d.events.some(e=>e.eventId==='ui-spoken-1'&&e.speaker==='candidate'&&e.text==='合成资料使用 RabbitMQ');},'speaker and speech correction published');
  await js("document.getElementById('spoken-review').open=false;document.getElementById('spoken-review').open=true");
  await until(()=>js("document.querySelector('#spoken-events textarea')?.value==='合成资料使用 RabbitMQ'"),'reopening edits the current revision');
  await js("document.querySelector('#spoken-events select').value='interviewer';document.querySelector('#spoken-events .spoken-save').click()");
  await until(async()=>{const d=await js('cue.dialogueSnapshot()');return d.events.some(e=>e.eventId==='ui-spoken-1'&&e.speaker==='interviewer'&&e.text==='合成资料使用 RabbitMQ');},'role-only edit retains corrected text');
  await js("cue.clearTranscript()");
  assert.equal((await js('cue.dialogueSnapshot()')).events.length,0);
  return {singleFileImport:true,separateJobs:true,duplicatePreservesEdits:true,restartPersistence:true,speakerCorrection:true,newSessionClearsSpeech:true};
};
