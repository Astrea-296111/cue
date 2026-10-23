'use strict';

// Packaged material is data, never executable code. One revision is applied once;
// local edits survive both restarts and later packaged revisions.
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {validateIndex} = require('./project-fact-packs');
const {validateSources} = require('./project-material-service');

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_RESUME_BYTES = 256 * 1024;
const emptyFacts = () => ({schemaVersion:1, projects:[], cards:[]});
const emptySources = () => ({version:2, projects:[], chunks:[], stats:{fileCount:0, chunkCount:0}});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
function withoutBuildTimes(value) {
  if (Array.isArray(value)) return value.map(withoutBuildTimes);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt').map(([key, item]) => [key, withoutBuildTimes(item)]));
  return value;
}
function sourceHash(sources, id) {
  return hash(withoutBuildTimes({project:sources.projects.find(project => project.id === id), chunks:sources.chunks.filter(chunk => chunk.projectId === id)}));
}
function makeBundle({facts=emptyFacts(), sources=emptySources(), profile={}}={}) {
  const body = {schemaVersion:1, approvedForDistribution:true, facts:validateIndex(facts), sources:withoutBuildTimes(validateSources(sources)), profile};
  return validateBundle({...body, revision:hash(body)});
}
function validateBundle(value) {
  if (!value || value.schemaVersion !== 1 || value.approvedForDistribution !== true || !/^[a-f0-9]{64}$/.test(value.revision || '')) throw new Error('随应用发布的材料缺少有效版本或分发确认');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BUNDLE_BYTES) throw new Error('随应用发布的材料超过 32MiB');
  const {revision, ...body} = value;
  if (hash(body) !== revision) throw new Error('随应用发布的材料摘要不匹配，请重新编译材料');
  validateIndex(value.facts);
  validateSources(value.sources);
  const ids = new Set(value.sources.projects.map(project => project.id));
  if (value.sources.chunks.some(chunk => !ids.has(chunk.projectId))) throw new Error('随应用发布的源码缺少明确项目归属');
  if (!value.profile || typeof value.profile !== 'object' || Array.isArray(value.profile) || Object.keys(value.profile).some(key => key !== 'resumeText')) throw new Error('随应用发布的个人资料仅接受 resumeText；JD 必须保留在本地');
  if (value.profile.resumeText != null && (typeof value.profile.resumeText !== 'string' || Buffer.byteLength(value.profile.resumeText, 'utf8') > MAX_RESUME_BYTES)) throw new Error('随应用发布的简历无效或超过 256KiB');
  return JSON.parse(JSON.stringify(value));
}
async function installBundledMaterials({bundlePath, materialService, store}) {
  let stat;
  try { stat = fs.lstatSync(bundlePath); } catch (error) { if (error.code === 'ENOENT') return {applied:false, reason:'absent'}; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BUNDLE_BYTES) throw new Error('随应用发布的材料文件无效或过大');
  const bundle = validateBundle(JSON.parse(fs.readFileSync(bundlePath, 'utf8')));
  const settings = store.getSettings(), previous = settings.bundledMaterials || {};
  if (previous.revision === bundle.revision) return {applied:false, reason:'already-applied', revision:bundle.revision};
  const local = materialService.snapshot;
  const resolutions = {}, preservedCards = [], preservedSources = [];
  for (const card of bundle.facts.cards) {
    const current = local.facts.cards.find(item => item.cardId === card.cardId);
    if (!current || hash(current) === hash(card)) continue;
    const expected = previous.cardHashes?.[card.cardId] || (materialService.bundled?.cards.find(item => item.cardId === card.cardId) ? hash(materialService.bundled.cards.find(item => item.cardId === card.cardId)) : null);
    if (!expected || hash(current) !== expected) { resolutions[card.cardId] = 'keep'; preservedCards.push(card.cardId); }
  }
  let sources = local.sources;
  const replacements = new Set();
  for (const project of bundle.sources.projects) {
    const existing = local.sources.projects.find(item => item.id === project.id);
    if (existing && sourceHash(local.sources, project.id) !== sourceHash(bundle.sources, project.id) && sourceHash(local.sources, project.id) !== previous.sourceHashes?.[project.id]) preservedSources.push(project.id);
    else replacements.add(project.id);
  }
  if (replacements.size) {
    sources = {...local.sources,
      projects:[...local.sources.projects.filter(project => !replacements.has(project.id)), ...bundle.sources.projects.filter(project => replacements.has(project.id))],
      chunks:[...local.sources.chunks.filter(chunk => !replacements.has(chunk.projectId)), ...bundle.sources.chunks.filter(chunk => replacements.has(chunk.projectId))]};
    sources.stats = sources.projects.reduce((total, project) => { for (const [key, count] of Object.entries(project.stats || {})) if (typeof count === 'number') total[key] = (total[key] || 0) + count; return total; }, {});
  }
  let state = materialService.state();
  if (bundle.facts.projects.length || replacements.size) {
    const preview = await materialService.prepareImport({index:bundle.facts, sourceSnapshot:sources, mode:'merge'});
    if (preview.conflicts.length || preview.packConflicts.length) throw new Error('随应用发布的项目身份有歧义，原材料已保留');
    state = await materialService.commitImport({...preview, resolutions});
    materialService.verifyPersisted();
  }
  const patch = {bundledMaterials:{revision:bundle.revision,
    cardHashes:Object.fromEntries(bundle.facts.cards.map(card => [card.cardId, hash(card)])),
    sourceHashes:Object.fromEntries(bundle.sources.projects.map(project => [project.id, sourceHash(bundle.sources, project.id)])),
    resumeHash:bundle.profile.resumeText == null ? previous.resumeHash || null : hash(bundle.profile.resumeText)}};
  const currentResume = store.getSettings().resumeText || '';
  const hasResume = bundle.profile.resumeText != null;
  const resumeApplied = hasResume && (!currentResume.trim() || hash(currentResume) === previous.resumeHash);
  if (resumeApplied) patch.resumeText = bundle.profile.resumeText;
  store.setSettings(patch);
  return {applied:true, revision:bundle.revision, generation:state.generation, counts:state.counts,
    resumeApplied, resumePreserved:hasResume && !resumeApplied, preservedCards, preservedSources};
}

module.exports = {MAX_BUNDLE_BYTES, MAX_RESUME_BYTES, canonical, hash, withoutBuildTimes, emptyFacts, emptySources, makeBundle, validateBundle, installBundledMaterials};
