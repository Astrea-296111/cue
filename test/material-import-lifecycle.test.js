'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {ProjectMaterialService}=require('../src/project-material-service');
const {fixture,loadAdapter,writeFolder,zip,sourceFixture}=require('./helpers/material-fixture');
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cue-import-lifecycle-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const config={directory,bundled:fixture(),sourceAdapter:loadAdapter(directory)};return {directory,config,service:new ProjectMaterialService(config)};}
test('folder scan progress, preview isolation, persisted counts and restart restoration',async t=>{
  const {directory,service,config}=setup(t),before=service.state();
  const folder=writeFolder(directory,'source-import',Object.fromEntries(Array.from({length:30},(_,i)=>['src/file'+i+'.js','export function source'+i+'() { return "synthetic bounded scanner fixture"; }'])));
  const progress=[],preview=await service.prepareImport({kind:'folder',path:folder,onProgress:p=>progress.push(p)});
  assert.equal(service.state().generation,before.generation);assert.ok(preview.summary.sourceChunks>0);
  assert.ok(progress.some(p=>p.phase==='discover'));assert.ok(progress.some(p=>p.phase==='scan'&&p.indexedFiles>=25));assert.equal(progress.at(-1).phase,'ready');
  assert.ok(!JSON.stringify(progress).includes(directory));
  const state=await service.commitImport(preview);assert.equal(service.verifyPersisted(),true);
  assert.equal(state.counts.sourceChunks,preview.summary.sourceChunks);
  const restarted=new ProjectMaterialService(config);assert.equal(restarted.state().generation,state.generation);assert.deepEqual(restarted.state().counts,state.counts);
  assert.deepEqual(restarted.snapshot.sources.chunks,service.snapshot.sources.chunks);
  const restartCode='const {ProjectMaterialService}=require('+JSON.stringify(require.resolve('../src/project-material-service'))+');process.stdout.write(JSON.stringify(new ProjectMaterialService('+JSON.stringify({directory,bundled:fixture()})+').state()));';
  const processRestart=spawnSync(process.execPath,['-e',restartCode],{encoding:'utf8',timeout:10000});
  assert.equal(processRestart.status,0,processRestart.stderr);
  const restored=JSON.parse(processRestart.stdout);assert.equal(restored.generation,state.generation);assert.deepEqual(restored.counts,state.counts);
  await assert.rejects(service.commitImport(preview),{code:'preview-expired'});
  const pointer=JSON.parse(fs.readFileSync(path.join(directory,'cue-materials/current.json'),'utf8'));
  fs.writeFileSync(path.join(directory,'cue-materials',pointer.files.sources.path),'corrupt');
  assert.throws(()=>service.verifyPersisted(),/摘要/);assert.equal(service.state().generation,state.generation);
});
test('empty directory and ZIP produce explicit error without a preview or publication',async t=>{
  const {directory,service}=setup(t),before=service.state(),folder=writeFolder(directory,'empty',{});
  const file=path.join(directory,'empty.zip');fs.writeFileSync(file,zip({'source/unsupported.bin':'binary'}));
  for(const [kind,input] of [['folder',folder],['zip',file]])await assert.rejects(service.prepareImport({kind,path:input}),{code:'empty-materials'});
  assert.equal(service.state().generation,before.generation);assert.equal(service.previews.size,0);
});
test('facts-only folder is valid and malformed known fact files cannot publish',async t=>{
  const {directory,service}=setup(t),old=service.state().generation;
  const invalid=writeFolder(directory,'invalid',{'interview/facts.json':'{"schemaVersion":99}'});
  await assert.rejects(service.prepareImport({kind:'folder',path:invalid}),/facts.json/);assert.equal(service.state().generation,old);
  const folder=writeFolder(directory,'facts-only',{'interview/facts.json':JSON.stringify(fixture(10))});
  const preview=await service.prepareImport({kind:'folder',path:folder});assert.equal(preview.summary.sourceChunks,0);
  assert.equal((await service.commitImport(preview)).counts.facts,10);
});
test('internal bundled source snapshot is validated, copied and requires fact index',async t=>{
  const {service}=setup(t),sources=sourceFixture();
  await assert.rejects(service.prepareImport({sourceSnapshot:sources}),{code:'invalid-source-input'});
  await assert.rejects(service.prepareImport({kind:'folder',index:fixture(),sourceSnapshot:sources}),{code:'invalid-source-input'});
  const preview=await service.prepareImport({index:fixture(),sourceSnapshot:sources});sources.chunks[0].text='modified after prepare';
  await service.commitImport(preview);assert.notEqual(service.snapshot.sources.chunks[0].text,sources.chunks[0].text);
  const invalid=sourceFixture();invalid.chunks[0].path='../secret';
  await assert.rejects(service.prepareImport({index:fixture(),sourceSnapshot:invalid}),/路径/);
});
