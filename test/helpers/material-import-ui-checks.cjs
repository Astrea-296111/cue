'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ProjectMaterialService}=require('../../src/project-material-service');
const {writeFolder}=require('./material-fixture');
// The picker uses synthetic disk fixtures. Renderer, preload, material IPC,
// scanner, atomic publication, and restart reconstruction all run normally.
module.exports=async function({js,until,data,selectMaterial}){
  await js("document.querySelector('.s-tab[data-tab=profile]').click()");
  await until(()=>js("!document.querySelector('.s-tab-pane[data-pane=profile]').classList.contains('hidden')"),'material page opens');
  assert.equal(await js("document.querySelector('.s-tab-pane[data-pane=keys]').contains(document.getElementById('materials-preview'))"),false);
  const before=await js('cue.materialState()'),facts=await js('cue.getProjectFactPackStatus()');
  const empty=writeFolder(data,'ui-empty',{});
  selectMaterial(empty);await js("document.getElementById('project-import-folder').click()");
  await until(()=>js("!document.getElementById('materials-error').hidden"),'empty folder error visible on current page');
  assert.match(await js("document.getElementById('materials-error').textContent"),/没有可导入/);
  assert.equal((await js('cue.materialState()')).generation,before.generation);
  assert.equal(await js("document.getElementById('materials-preview').hidden"),true);
  const invalid=writeFolder(data,'ui-invalid',{'interview/facts.json':'{"schemaVersion":99}'});
  selectMaterial(invalid);await js("document.getElementById('project-import-folder').click()");
  await until(()=>js("document.getElementById('materials-error').textContent.includes('facts.json')"),'invalid material error visible');
  assert.equal((await js('cue.materialState()')).generation,before.generation);
  const folder=writeFolder(data,'ui-import-project',{
    'interview/project.md':'---\nschema_version: 1\nproject_id: ui-import\nproject_name: UI导入合成项目\n---\n# UI imported fixture\nSynthetic project source for import lifecycle only.',
    'src/import.js':'export function importedMarker() { return "UI_IMPORT_PERSISTENCE"; }'
  });
  await js("window.materialProgress=[];cue.on('materials:progress',p=>window.materialProgress.push(p))");
  selectMaterial(folder);await js("document.getElementById('project-import-folder').focus();document.getElementById('project-import-folder').click();document.getElementById('project-import-folder').click()");
  await until(()=>js("!document.getElementById('materials-preview').hidden"),'folder preview visible from material page');
  const modal=await js("(()=>{const p=document.getElementById('materials-dialog'),r=p.getBoundingClientRect();return {role:p.getAttribute('role'),modal:p.getAttribute('aria-modal'),width:r.width,height:r.height,top:r.top,bottom:r.bottom,viewport:innerHeight,focus:p.contains(document.activeElement),pageHidden:document.querySelector('.s-tab-pane[data-pane=profile]').classList.contains('hidden')};})()");
  assert.equal(modal.role,'dialog');assert.equal(modal.modal,'true');assert.ok(modal.width>0&&modal.height>0&&modal.top>=0&&modal.bottom<=modal.viewport+1);assert.equal(modal.focus,true);assert.equal(modal.pageHidden,false);
  assert.equal((await js('cue.materialState()')).generation,before.generation,'folder preview does not publish');
  assert.equal(await js("document.getElementById('project-import-folder').disabled"),true);
  await js("document.getElementById('materials-commit').click();document.getElementById('materials-commit').click();window.materialBusyAtClick={commit:document.getElementById('materials-commit').disabled,cancel:document.getElementById('materials-cancel').disabled}");
  assert.deepEqual(await js('window.materialBusyAtClick'),{commit:true,cancel:true});
  await until(()=>js("document.getElementById('materials-preview').hidden"),'folder commit and persistence verification');
  const imported=await js('cue.materialState()');
  const choices=await js("[...document.querySelectorAll('#current-project option')].map(option=>option.value)");
  assert.ok(facts.projects.filter(p=>p.factProjectId).every(p=>choices.includes(p.id)),'source refresh preserves canonical facts-only projects');
  assert.ok(imported.counts.sourceChunks>before.counts.sourceChunks);assert.ok(imported.projects.some(p=>p.id==='ui-import'&&p.sourceFiles>0&&p.sourceChunks>0));
  assert.match(await js("document.getElementById('materials-operation-status').textContent"),/已应用并校验/);
  assert.ok(await js("document.getElementById('project-index-status').textContent.includes('个片段')"));
  const restarted=new ProjectMaterialService({directory:data,bundled:facts.index});
  assert.equal(restarted.state().generation,imported.generation);assert.deepEqual(restarted.state().counts,imported.counts);assert.equal(restarted.verifyPersisted(),true);
  const disk=JSON.parse(fs.readFileSync(path.join(data,'cue-materials/current.json'),'utf8'));
  assert.equal(disk.generation,imported.generation);
  const progress=await js('window.materialProgress');assert.ok(progress.some(p=>p.phase==='scan'&&p.indexedFiles>0));assert.ok(progress.some(p=>p.phase==='ready'));
  assert.ok(!JSON.stringify(progress).includes(data),'progress exposes counters without local paths');
  await js("document.getElementById('materials-rollback').click()");
  await until(async()=>(await js('cue.materialState()')).counts.sourceChunks===before.counts.sourceChunks,'restore source fixture after lifecycle test');
  const edited=JSON.parse(JSON.stringify(facts.index));edited.cards[0].text+=' UI_PREVIEW_CANCEL_ONLY';
  const cancelBase=await js('cue.materialState()');
  await js(`document.getElementById('fact-editor').value=${JSON.stringify(JSON.stringify(edited))};document.getElementById('fact-save').closest('details').open=true;document.getElementById('fact-save').focus();document.getElementById('fact-save').click()`);
  await until(()=>js("!document.getElementById('materials-preview').hidden"),'editable conflict preview');
  await js("document.querySelector('#materials-preview-changes details').open=true;document.querySelector('#materials-preview-changes .capture-safe-trigger').click()");
  assert.equal(await js("document.querySelector('#materials-dialog > .capture-safe-options').hidden"),false);
  assert.equal(await js("document.querySelector('#materials-preview-changes select').dataset.captureSafe"),'true');
  await js("document.querySelector('#materials-preview-changes .capture-safe-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
  assert.equal(await js("document.getElementById('materials-preview').hidden"),false,'first Escape closes protected option list');
  await js("document.getElementById('materials-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
  assert.equal(await js("document.getElementById('materials-preview').hidden"),true);
  assert.equal(await js("document.activeElement.id"),'fact-save');
  assert.equal((await js('cue.materialState()')).generation,cancelBase.generation);
  return {sourceFolderGlobalDialog:true,emptyAndInvalidMaterialErrors:true,sourceIndexRestartRecovery:true,scanProgress:true,commitDeduplication:true,canonicalFactProjectsPreserved:true,protectedPreviewChoices:true,previewCancelFocusRestored:true};
};
