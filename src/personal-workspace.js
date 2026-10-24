'use strict';
// Explicit local import. Personal data never belongs to the public source bundle.
const fs = require('node:fs');
const path = require('node:path');
const { validateIndex } = require('./project-fact-packs');
const { hash } = require('./bundled-materials');

function validatePersonalWorkspace(value) {
  if (!value || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion','facts','profile','revision'].includes(key))) throw new Error('个人资料工作区格式无效');
  const facts = validateIndex(value.facts), profile = value.profile;
  if (!profile || Object.keys(profile).some(key => !['resumeText','jobDescription'].includes(key)) ||
      ['resumeText','jobDescription'].some(key => typeof profile[key] !== 'string' || Buffer.byteLength(profile[key], 'utf8') > 256 * 1024)) throw new Error('个人资料工作区仅接受简历和岗位正文');
  const body = {schemaVersion:1, facts, profile};
  const revision = hash(body);
  if (value.revision && value.revision !== revision) throw new Error('个人资料工作区摘要不匹配');
  return {...body, revision};
}

async function installPersonalWorkspace({directory, materialService, store}) {
  if (!directory) return {applied:false, reason:'not-requested'};
  const file = path.join(path.resolve(directory), 'workspace.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3 * 1024 * 1024) throw new Error('个人资料工作区文件无效或过大');
  const workspace = validatePersonalWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (store.getSettings().personalWorkspaceRevision === workspace.revision) return {applied:false, reason:'already-applied'};
  const preview = await materialService.prepareImport({index:workspace.facts, mode:'replace-projects'});
  if (preview.conflicts?.length || preview.packConflicts?.length) throw new Error('个人项目资料存在未解决的身份冲突');
  const state = await materialService.commitImport(preview);
  materialService.verifyPersisted();
  store.setSettings({...workspace.profile, personalWorkspaceRevision:workspace.revision});
  return {applied:true, generation:state.generation, counts:state.counts};
}
module.exports = {validatePersonalWorkspace, installPersonalWorkspace};
