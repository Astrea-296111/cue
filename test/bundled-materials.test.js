'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {ProjectMaterialService} = require('../src/project-material-service');
const {buildBundleFile} = require('../scripts/bundle-project-materials.cjs');
const {validatePersonalWorkspace,installPersonalWorkspace} = require('../src/personal-workspace');
const {makeBundle, hash, installBundledMaterials} = require('../src/bundled-materials');
const {fixture, sourceFixture, loadAdapter, writeFolder, sha} = require('./helpers/material-fixture');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-packaged-material-test-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const root = path.join(directory, 'materials'); fs.mkdirSync(root);
  const adapter = loadAdapter(directory);
  const config = {directory, bundled:fixture(), legacySource:sourceFixture(), sourceAdapter:adapter};
  const service = new ProjectMaterialService(config);
  const settingsPath = path.join(directory, 'test-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({resumeText:'', jobDescription:'仅保存在本地的 JD', provider:'custom', apiKeys:{custom:'local-placeholder'}}));
  const store = {
    getSettings:() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')),
    setSettings:patch => { const value = {...store.getSettings(), ...patch}; fs.writeFileSync(settingsPath, JSON.stringify(value)); return value; }
  };
  const bundlePath = path.join(root, 'bundle.json');
  return {directory, root, adapter, config, service, store, bundlePath};
}
function writeBundle(bundlePath, value) { fs.writeFileSync(bundlePath, JSON.stringify(value)); }
function baseManifest() { return {schemaVersion:1, approvedForDistribution:true, facts:[], sources:[], profile:null}; }
function writeManifest(root, value) { const file = path.join(root, 'manifest.json'); fs.writeFileSync(file, JSON.stringify(value)); return file; }

test('explicit personal workspace imports facts, resume and JD once while preserving later local edits', async t => {
  const {root, service, store}=setup(t);
  const workspace=validatePersonalWorkspace({schemaVersion:1,facts:fixture(2),profile:{resumeText:'Private synthetic resume',jobDescription:'Private synthetic role'}});
  fs.writeFileSync(path.join(root,'workspace.json'),JSON.stringify(workspace));
  const beforeSources=JSON.stringify(service.snapshot.sources);
  const result=await installPersonalWorkspace({directory:root,materialService:service,store});
  assert.equal(result.applied,true);assert.equal(service.snapshot.facts.cards.length,2);
  assert.equal(JSON.stringify(service.snapshot.sources),beforeSources);
  assert.equal(store.getSettings().jobDescription,workspace.profile.jobDescription);
  assert.equal(store.getSettings().resumeText,workspace.profile.resumeText);
  store.setSettings({jobDescription:'Locally edited role'});
  assert.equal((await installPersonalWorkspace({directory:root,materialService:service,store})).reason,'already-applied');
  assert.equal(store.getSettings().jobDescription,'Locally edited role');
  assert.throws(()=>validatePersonalWorkspace({...workspace,profile:{...workspace.profile,apiKeys:{custom:'forbidden'}}}));
});

test('empty packaged revision preserves local facts/sources/settings and never creates a new material generation', async t => {
  const {root, service, store, bundlePath} = setup(t), original = service.snapshot;
  const manifestPath = writeManifest(root, baseManifest());
  const a = await buildBundleFile({manifestPath, outputPath:bundlePath});
  const b = await buildBundleFile({manifestPath, outputPath:bundlePath});
  assert.equal(a.revision, b.revision);
  const result = await installBundledMaterials({bundlePath, materialService:service, store});
  assert.equal(result.applied, true); assert.equal(service.snapshot.generation, original.generation);
  assert.deepEqual(service.snapshot.sources, original.sources);
  assert.equal(store.getSettings().jobDescription, '仅保存在本地的 JD');
  assert.deepEqual((await installBundledMaterials({bundlePath, materialService:service, store})).reason, 'already-applied');
});

test('packaging uses only hash-approved original files and the real folder importer deterministically', async t => {
  const {root, bundlePath} = setup(t), facts = fixture(2);
  const text = '---\nschema_version: 1\nproject_id: cae\nproject_name: CAE\naliases: [cae-job-platform]\nsource_revision: fixture-v1\n---\nCAE project source snapshot.';
  const source = 'export function recover(){ return "confirmed source snapshot"; }';
  writeFolder(root, 'projects/cae', {'interview/project.md':text, 'src/recover.js':source, '.env':'DO_NOT_SHIP=private-value', 'unlisted.md':'Do not ship this unapproved document.'});
  writeFolder(root, 'facts', {'approved.json':JSON.stringify(facts)});
  writeFolder(root, 'profile', {'resume.md':'明确同意发布的测试简历'});
  const manifest = {...baseManifest(), facts:[{path:'facts/approved.json', sha256:sha(JSON.stringify(facts))}],
    profile:{path:'profile/resume.md', sha256:sha('明确同意发布的测试简历')},
    sources:[{root:'projects/cae', projectId:'cae', files:[{path:'interview/project.md', sha256:sha(text)}, {path:'src/recover.js', sha256:sha(source)}]}]};
  const manifestPath = writeManifest(root, manifest), options = {manifestPath, outputPath:bundlePath};
  const first = await buildBundleFile(options), second = await buildBundleFile(options);
  assert.equal(first.revision, second.revision); assert.equal(first.facts.cards.length, 2);
  assert.equal(first.sources.projects[0].id, 'cae');
  assert.ok(first.sources.chunks.some(chunk => chunk.path === 'src/recover.js' && chunk.text.includes('confirmed source snapshot')));
  assert.ok(!JSON.stringify(first).includes('DO_NOT_SHIP')); assert.ok(!JSON.stringify(first).includes('unapproved document'));
  assert.equal(first.profile.resumeText, '明确同意发布的测试简历');
  fs.appendFileSync(path.join(root, 'projects/cae/src/recover.js'), '\n// unapproved change');
  await assert.rejects(buildBundleFile(options), /摘要不匹配/);
  assert.equal(JSON.parse(fs.readFileSync(bundlePath)).revision, first.revision);
  manifest.approvedForDistribution = false; writeManifest(root, manifest);
  await assert.rejects(buildBundleFile(options), /明确 approvedForDistribution/);
});

test('packaging rejects traversal, symlinks, sensitive paths and invalid source identity before publication', async t => {
  const {root, bundlePath} = setup(t), manifestPath = writeManifest(root, baseManifest());
  const original = makeBundle(); writeBundle(bundlePath, original);
  const manifest = {...baseManifest(), profile:{path:'../outside.md', sha256:'a'.repeat(64)}};
  writeManifest(root, manifest); await assert.rejects(buildBundleFile({manifestPath, outputPath:bundlePath}), /安全相对路径/);
  fs.writeFileSync(path.join(root, 'resume.md'), 'resume'); fs.symlinkSync('resume.md', path.join(root, 'alias.md'));
  manifest.profile = {path:'alias.md', sha256:sha('resume')}; writeManifest(root, manifest);
  await assert.rejects(buildBundleFile({manifestPath, outputPath:bundlePath}), /符号链接/);
  manifest.profile = null; manifest.sources = [{root:'projects/cae', projectId:'cae', files:[{path:'interview/project.md', sha256:'a'.repeat(64)}, {path:'.env', sha256:'a'.repeat(64)}]}];
  const projectManifest = '---\nschema_version: 1\nproject_id: cae\nproject_name: CAE\n---\nPublic CAE source snapshot.';
  writeFolder(root, 'projects/cae', {'interview/project.md':projectManifest});
  manifest.sources[0].files[0].sha256 = sha(projectManifest); writeManifest(root, manifest);
  await assert.rejects(buildBundleFile({manifestPath, outputPath:bundlePath}), /敏感/);
  manifest.sources[0].files.pop();
  fs.writeFileSync(path.join(root, 'projects/cae/interview/project.md'), 'invalid project identity');
  manifest.sources[0].files[0].sha256 = sha('invalid project identity'); writeManifest(root, manifest);
  await assert.rejects(buildBundleFile({manifestPath, outputPath:bundlePath}), /项目身份/);
  assert.equal(JSON.parse(fs.readFileSync(bundlePath)).revision, original.revision);
});

test('facts and source snapshot install in one persisted generation; restarts and updates preserve local edits and unrelated sources', async t => {
  const {service, config, store, bundlePath} = setup(t), incoming = fixture(2);
  incoming.cards[0].text = '首个发布版本的已核验说明';
  const sources = {version:2, projects:[{id:'shipped-cae', name:'CAE', aliases:['cae-job-platform'], stats:{fileCount:1, chunkCount:1}}],
    chunks:[{id:'bundle-source', projectId:'shipped-cae', projectName:'CAE', path:'src/shipped.js', text:'function shipped(){ return 1; }', startLine:1, endLine:1}], stats:{fileCount:1, chunkCount:1}};
  const bundle = makeBundle({facts:incoming, sources, profile:{resumeText:'首次发布的简历'}}); writeBundle(bundlePath, bundle);
  const previousGeneration = service.snapshot.generation;
  const installed = await installBundledMaterials({bundlePath, materialService:service, store});
  assert.notEqual(installed.generation, previousGeneration);
  assert.equal(service.snapshot.facts.cards.find(card => card.cardId === incoming.cards[0].cardId).text, incoming.cards[0].text);
  assert.deepEqual(new Set(service.snapshot.sources.projects.map(project => project.id)), new Set(['legacy-cae','legacy-arc','shipped-cae']));
  const restarted = new ProjectMaterialService(config);
  assert.equal(restarted.snapshot.generation, installed.generation);
  assert.ok(restarted.snapshot.sources.chunks.some(chunk => chunk.id === 'bundle-source'));
  assert.equal(store.getSettings().resumeText, '首次发布的简历');
  const local = fixture(2); local.cards[0].text = '用户在本地修改过的事实';
  const preview = await restarted.prepareImport({index:local}); await restarted.commitImport(preview);
  await restarted.publishSource({...restarted.snapshot.sources, chunks:restarted.snapshot.sources.chunks.map(chunk => chunk.id === 'bundle-source' ? {...chunk, text:'function localEdit(){ return 2; }'} : chunk)});
  store.setSettings({resumeText:'用户本地修改的简历'});
  const localGeneration = restarted.snapshot.generation;
  assert.equal((await installBundledMaterials({bundlePath, materialService:restarted, store})).reason, 'already-applied');
  assert.equal(restarted.snapshot.generation, localGeneration);
  incoming.cards[0].text = '第二个发布版本'; sources.chunks[0].text = 'function shippedV2(){ return 3; }';
  writeBundle(bundlePath, makeBundle({facts:incoming, sources, profile:{resumeText:'第二版简历'}}));
  const updated = await installBundledMaterials({bundlePath, materialService:restarted, store});
  assert.ok(updated.preservedCards.includes(incoming.cards[0].cardId)); assert.deepEqual(updated.preservedSources, ['shipped-cae']);
  assert.equal(restarted.snapshot.facts.cards.find(card => card.cardId === incoming.cards[0].cardId).text, '用户在本地修改过的事实');
  assert.ok(restarted.snapshot.sources.chunks.some(chunk => chunk.text.includes('localEdit')));
  assert.ok(restarted.snapshot.sources.chunks.some(chunk => chunk.projectId === 'legacy-arc'));
  assert.equal(store.getSettings().resumeText, '用户本地修改的简历'); assert.equal(store.getSettings().jobDescription, '仅保存在本地的 JD');
  assert.equal(store.getSettings().apiKeys.custom, 'local-placeholder');
});

test('a new packaged revision updates an untouched distributed resume while preserving a preexisting local resume', async t => {
  const {service, store, bundlePath} = setup(t);
  const apply = async resumeText => { writeBundle(bundlePath, makeBundle({profile:{resumeText}})); return installBundledMaterials({bundlePath, materialService:service, store}); };
  assert.equal((await apply('首版简历')).resumeApplied, true);
  assert.equal((await apply('新版简历')).resumeApplied, true); assert.equal(store.getSettings().resumeText, '新版简历');
  store.setSettings({resumeText:'我的本地简历'});
  assert.equal((await apply('第三版简历')).resumePreserved, true); assert.equal(store.getSettings().resumeText, '我的本地简历');
  store.setSettings({bundledMaterials:{}, resumeText:'另一台机器原有简历'});
  assert.equal((await apply('第四版简历')).resumePreserved, true); assert.equal(store.getSettings().resumeText, '另一台机器原有简历');
});

test('updating an untouched packaged source replaces that project snapshot without retaining stale chunks', async t => {
  const {service, store, bundlePath} = setup(t);
  const source = text => ({version:2, projects:[{id:'shipped-cae', name:'CAE', stats:{fileCount:1, chunkCount:1}}],
    chunks:[{id:text === 'old' ? 'old-source-id' : 'new-source-id', projectId:'shipped-cae', projectName:'CAE', path:'src/recovery.js', text, startLine:1, endLine:1}], stats:{fileCount:1, chunkCount:1}});
  writeBundle(bundlePath, makeBundle({sources:source('old')}));
  await installBundledMaterials({bundlePath, materialService:service, store});
  writeBundle(bundlePath, makeBundle({sources:source('new')}));
  const result = await installBundledMaterials({bundlePath, materialService:service, store});
  assert.deepEqual(result.preservedSources, []);
  assert.ok(!service.snapshot.sources.chunks.some(chunk => chunk.id === 'old-source-id'));
  assert.equal(service.snapshot.sources.chunks.filter(chunk => chunk.projectId === 'shipped-cae').length, 1);
  assert.ok(service.snapshot.sources.chunks.some(chunk => chunk.id === 'new-source-id'));
  assert.ok(service.snapshot.sources.chunks.some(chunk => chunk.projectId === 'legacy-arc'));
});

test('missing bundle is a no-op and tampering or a bundled JD fails before changing any installed materials', async t => {
  const {service, store, bundlePath} = setup(t), generation = service.snapshot.generation;
  assert.equal((await installBundledMaterials({bundlePath, materialService:service, store})).reason, 'absent');
  const tampered = makeBundle(); tampered.profile.resumeText = 'tampered'; writeBundle(bundlePath, tampered);
  await assert.rejects(installBundledMaterials({bundlePath, materialService:service, store}), /摘要不匹配/);
  const body = {schemaVersion:1, approvedForDistribution:true, facts:{schemaVersion:1, projects:[], cards:[]}, sources:{version:2, projects:[], chunks:[], stats:{}}, profile:{jobDescription:'must not ship'}};
  writeBundle(bundlePath, {...body, revision:hash(body)});
  await assert.rejects(installBundledMaterials({bundlePath, materialService:service, store}), /JD/);
  assert.equal(service.snapshot.generation, generation); assert.equal(store.getSettings().jobDescription, '仅保存在本地的 JD');
});
