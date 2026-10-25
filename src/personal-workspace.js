'use strict';
// Explicit local imports. Workspace contents are never distributed with the public bundle.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateIndex, MAX_FACT_BYTES, mergeFactIndexes } = require('./project-fact-packs');
const { combinePacks, digest } = require('./project-material-service');
const { hash } = require('./bundled-materials');
const MAX_WORKSPACE_BYTES = MAX_FACT_BYTES + 2 * 1024 * 1024;
const JOB_PROFILE_IDS = ['ai_supply_chain', 'java_security'];
const previews = new Map();
const activeTransactions = new WeakSet();
const recoveryResults = new WeakMap();
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const MANAGED_FIELDS = ['resumeText','jobDescription','candidateProfile','jobProfiles','activeJobProfileId','personalWorkspace','personalWorkspaceRevision'];

function journalPath(materialService) {
  return materialService.userDirectory ? path.join(materialService.userDirectory,'personal-workspace-transaction.json') : null;
}
function writeJournal(file, transaction) {
  if (!file) return;
  const temporary=file+'.tmp-'+randomUUID(),fd=fs.openSync(temporary,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(transaction));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  try {fs.renameSync(temporary,file);} catch(error) {try{fs.unlinkSync(temporary);}catch{}throw error;}
}
function clearJournal(file) {if(file)try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
function sameValue(left,right) {return hash(left === undefined ? {missing:true} : {value:left})===hash(right === undefined ? {missing:true} : {value:right});}
function snapshotMatches(materialService,transaction) {
  const snapshot=materialService.snapshot;
  return snapshot.factRevision===transaction.expectedFactSha256 && snapshot.sourceRevision===transaction.expectedSourceSha256;
}
function ownsPublishedGeneration(materialService,transaction) {
  if (!snapshotMatches(materialService,transaction)) return false;
  const generation=materialService.snapshot.generation;
  if(transaction.publishedGeneration)return generation===transaction.publishedGeneration;
  // A crash may happen after publishing the pointer and before recording its ID.
  // Only the immediate successor with the exact staged payload can be recovered.
  return Number(generation.split('-')[0])===Number(transaction.baseGeneration.split('-')[0])+1 && materialService.previousGeneration()===transaction.baseGeneration;
}
function restoreSettingsFields(store,transaction) {
  const current=store.getSettings(),patch={},replaceFields=[],deleteFields=[];
  for(const [key,value] of Object.entries(transaction.patch)) {
    if(!sameValue(current[key],value))continue;
    const before=transaction.beforeFields[key];
    if(sameValue(current[key],before.present?before.value:undefined))continue;
    patch[key]=before.present?clone(before.value):undefined;replaceFields.push(key);if(!before.present)deleteFields.push(key);
  }
  if(replaceFields.length) {
    store.setSettings(patch,{replaceFields,deleteFields});
    for(const key of replaceFields)if(!sameValue(store.getSettings()[key],patch[key]))throw new Error('个人资料设置恢复校验失败');
    store.verifyPersisted?.();
  }
  return replaceFields;
}
function restoreMaterialPointer(materialService,transaction) {
  const disk=JSON.parse(fs.readFileSync(path.join(materialService.directory,'current.json'),'utf8'));
  if(disk.generation!==materialService.snapshot.generation)return {restored:false,reason:'newer-generation-retained'};
  const restorePrevious=()=>{
    if(transaction.previousPointer)materialService.atomicPointer('previous.json',transaction.previousPointer);
    else try{fs.unlinkSync(path.join(materialService.directory,'previous.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  };
  // Recovery is idempotent even if the process stopped after restoring current
  // but before restoring the previous-generation history pointer.
  if(materialService.snapshot.generation===transaction.baseGeneration){restorePrevious();return {restored:false,reason:'base-generation'};}
  if(!ownsPublishedGeneration(materialService,transaction))return {restored:false,reason:'newer-generation-retained'};
  const snapshot=materialService.readPointer(transaction.basePointer);
  materialService.atomicPointer('current.json',transaction.basePointer);
  materialService.pointer=clone(transaction.basePointer);materialService.snapshot=snapshot;
  restorePrevious();
  materialService.emit('changed',materialService.state());
  return {restored:true,reason:'rolled-back'};
}
function compensateImport({materialService,store,transaction}) {
  let restoredFields=[],settingsError,material;
  try{restoredFields=restoreSettingsFields(store,transaction);}catch(error){settingsError=error;}
  try{material=restoreMaterialPointer(materialService,transaction);}catch(error){if(settingsError)throw new AggregateError([settingsError,error],'个人资料与材料恢复失败');throw error;}
  if(settingsError)throw settingsError;
  return {...material,restoredFields};
}
function recoverPersonalWorkspaceImport({materialService,store}) {
  if(!materialService||!store||activeTransactions.has(materialService))return {recovered:false,reason:'not-required'};
  const file=journalPath(materialService);if(!file||!fs.existsSync(file))return {recovered:false,reason:'not-required'};
  const transaction=JSON.parse(fs.readFileSync(file,'utf8'));
  if(transaction.schemaVersion!==1||!transaction.basePointer||!transaction.beforeFields||!transaction.patch||!transaction.baseGeneration)throw new Error('个人资料事务日志无效，请保留备份并恢复资料');
  const settings=store.getSettings();
  // This phase is written only after both material and settings persistence were
  // verified. A later source import or user edit does not make that commit fail.
  // In particular, startup bundle publication must never roll its profile back.
  const persistedPatch=Object.entries(transaction.patch).every(([key,value])=>sameValue(settings[key],value));
  if(transaction.phase==='committed'||ownsPublishedGeneration(materialService,transaction)&&transaction.phase==='settings-pending'&&persistedPatch) {
    if(transaction.phase!=='committed')store.verifyPersisted?.();
    clearJournal(file);const result={recovered:true,reason:'committed-transaction-finalized'};recoveryResults.set(materialService,result);return result;
  }
  const result={recovered:true,...compensateImport({materialService,store,transaction})};
  clearJournal(file);recoveryResults.set(materialService,result);return result;
}

function sanitizeResumeForPrompt(value) {
  return String(value || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[联系方式已省略]')
    .replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d){8}(?!\d)/g, '[联系方式已省略]')
    .replace(/(?:联系电话|手机|电话|邮箱|电子邮件|email)\s*[:：]\s*[^\n]+/gi, '[联系方式已省略]');
}
function text(value, name, max = 256 * 1024) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > max) throw new Error(name + '正文格式无效或过大');
  return value;
}
function validateCandidateProfile(candidate) {
  if (!candidate || candidate.subjectRole !== 'candidate' || Object.keys(candidate).some(k => !['name','subjectRole','status','source','education','availability','employment','resumeProjectOrder','projects','doNotInfer','contactPolicy'].includes(k))) throw new Error('个人资料主体必须是 candidate，且不得包含联系方式或面试官履历');
  if (Buffer.byteLength(JSON.stringify(candidate)) > 64 * 1024) throw new Error('候选人结构化资料过大');
  for (const k of ['education','employment','resumeProjectOrder','projects','doNotInfer']) if (!Array.isArray(candidate[k])) throw new Error('候选人资料字段无效：' + k);
  if (candidate.resumeProjectOrder.some(id => typeof id !== 'string') || !candidate.availability || typeof candidate.availability !== 'object') throw new Error('候选人顺序或到岗资料无效');
  return clone(candidate);
}
function validatePersonalWorkspace(value) {
  const v2 = value?.schemaVersion === 2;
  if (!value || ![1,2].includes(value.schemaVersion) || Object.keys(value).some(key => !(v2 ? ['schemaVersion','facts','profile','revision','sourceManifest','mergeLog'] : ['schemaVersion','facts','profile','revision']).includes(key))) throw new Error('个人资料工作区格式无效');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_WORKSPACE_BYTES) throw new Error('个人资料工作区超过允许大小');
  const facts = validateIndex(value.facts), profile = value.profile;
  if (!profile || Object.keys(profile).some(key => !(v2 ? ['resumeText','jobDescription','candidateProfile','jobProfiles','activeJobProfileId'] : ['resumeText','jobDescription']).includes(key))) throw new Error('个人资料工作区字段无效');
  text(profile.resumeText, '简历'); text(profile.jobDescription, '岗位');
  if (v2) {
    if (facts.schemaVersion !== 2) throw new Error('v2 个人工作区需要 v2 事实索引');
    validateCandidateProfile(profile.candidateProfile);
    if (!Array.isArray(profile.jobProfiles) || profile.jobProfiles.length !== 2 || new Set(profile.jobProfiles.map(p => p.id)).size !== 2 || !JOB_PROFILE_IDS.includes(profile.activeJobProfileId)) throw new Error('个人工作区须包含两个独立岗位画像');
    for (const job of profile.jobProfiles) {
      if (!JOB_PROFILE_IDS.includes(job.id) || Object.keys(job).some(k => !['id','label','jobDescription','priorityTopics','source','selfIntroductions'].includes(k)) || typeof job.label !== 'string' || !Array.isArray(job.priorityTopics) || job.priorityTopics.some(t => typeof t !== 'string')) throw new Error('岗位画像字段无效');
      text(job.jobDescription, '岗位');
      if (job.selfIntroductions) for (const k of ['seconds30','seconds60']) text(job.selfIntroductions[k], '自我介绍', 4000);
    }
    if (value.sourceManifest != null && (!Array.isArray(value.sourceManifest) || value.sourceManifest.some(s => !s || typeof s.path !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256) || !Number.isSafeInteger(s.bytes) || s.bytes < 0))) throw new Error('原始资料清单无效');
    if (value.mergeLog != null && !Array.isArray(value.mergeLog)) throw new Error('合并日志无效');
  }
  const body = {schemaVersion:value.schemaVersion, facts, profile:clone(profile)};
  if (v2 && value.sourceManifest) body.sourceManifest = clone(value.sourceManifest);
  if (v2 && value.mergeLog) body.mergeLog = clone(value.mergeLog);
  const revision = hash(body);
  if (value.revision && value.revision !== revision) throw new Error('个人资料工作区摘要不匹配');
  return {...body, revision};
}
function readWorkspace(filePath) {
  const file = path.resolve(filePath), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WORKSPACE_BYTES) throw new Error('个人资料工作区文件无效或过大');
  return validatePersonalWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function profileSummary(profile) {
  return {candidateSubjectRole:profile.candidateProfile?.subjectRole || 'candidate', activeJobProfileId:profile.activeJobProfileId || '',
    jobProfiles:(profile.jobProfiles || []).map(p => ({id:p.id,label:p.label,priorityTopics:p.priorityTopics}))};
}
async function preparePersonalWorkspaceImport({filePath, workspace:value, materialService, store}) {
  if (!materialService || !store) throw new Error('个人资料服务不可用');
  recoverPersonalWorkspaceImport({materialService,store});
  const workspace = value ? validatePersonalWorkspace(value) : readWorkspace(filePath);
  const settings = store.getSettings(), prior = settings.personalWorkspace || {}, already = settings.personalWorkspaceRevision === workspace.revision;
  // Keep the original v1 install contract; v2 upgrades merge stable IDs and retain local additions.
  const mode = workspace.schemaVersion === 1 && !settings.personalWorkspaceRevision ? 'replace-projects' : 'merge';
  const materialPreview = already ? {token:randomUUID(),baseGeneration:materialService.snapshot.generation,conflicts:[],packConflicts:[],changes:[]} : await materialService.prepareImport({index:workspace.facts,mode});
  const preservedCards = workspace.facts.cards.filter(c => {
    const old = materialService.snapshot.facts.cards.find(row => row.cardId === c.cardId);
    return old && prior.cardBaselines?.[c.cardId] && hash(old) !== prior.cardBaselines[c.cardId];
  }).map(c => c.cardId);
  const token = materialPreview.token;
  previews.set(token, {workspace,store,materialService,materialPreview,preservedCards,createdAt:Date.now(),already});
  if (previews.size > 8) previews.delete(previews.keys().next().value);
  return {...materialPreview, changes:materialPreview.changes?.map(c => ({id:c.id,projectId:c.projectId,kind:c.kind})), alreadyApplied:already, preservedCards,
    summary:{...materialPreview.summary,workspaceRevision:workspace.revision,schemaVersion:workspace.schemaVersion,facts:workspace.facts.cards.length,sourceCount:workspace.sourceManifest?.length || new Set(workspace.facts.cards.flatMap(c => c.sources.map(s => s.path))).size,
      projects:workspace.facts.projects.filter(p => p.kind !== 'knowledge').map(p => ({id:p.id,name:p.name})),...profileSummary(workspace.profile)}};
}
function writeBackup(materialService, settings) {
  if (!materialService.userDirectory) return null;
  const directory = path.join(materialService.userDirectory, 'personal-workspace-backups'); fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const target = path.join(directory, Date.now() + '-' + randomUUID() + '.json');
  fs.writeFileSync(target, JSON.stringify({schemaVersion:1,materialGeneration:materialService.snapshot.generation,profile:Object.fromEntries(MANAGED_FIELDS.filter(k => Object.hasOwn(settings,k)).map(k => [k,settings[k]]))},null,2), {mode:0o600});
  return target;
}
async function commitPersonalWorkspaceImport({token,baseGeneration,resolutions={},mappings={},variants={},materialService,store}) {
  if(activeTransactions.has(materialService))throw new Error('个人资料正在提交，请等待当前事务完成');
  recoverPersonalWorkspaceImport({materialService,store});
  const prepared = previews.get(token);
  if (!prepared || Date.now() - prepared.createdAt > 15 * 60000 || prepared.materialService !== materialService || prepared.store !== store) throw new Error('个人资料预览已失效，请重新选择文件');
  if (baseGeneration !== prepared.materialPreview.baseGeneration || materialService.snapshot.generation !== baseGeneration) throw new Error('材料版本已变化，请刷新个人资料预览');
  if (prepared.already) { previews.delete(token); return {...getPersonalWorkspaceState({materialService,store}),applied:false,reason:'already-applied'}; }
  const workspace = prepared.workspace, settings = store.getSettings(), prior = settings.personalWorkspace || {}, first = !settings.personalWorkspaceRevision;
  const backupPath = writeBackup(materialService,settings);
  const safeResolutions = {...Object.fromEntries(prepared.preservedCards.map(id => [id,'keep'])),...resolutions};
  const patch = {}, preservedFields = [];
  for (const field of ['resumeText','jobDescription','candidateProfile','jobProfiles','activeJobProfileId']) {
    if (!Object.hasOwn(workspace.profile,field)) continue;
    const empty = settings[field] == null || settings[field] === '' || Array.isArray(settings[field]) && settings[field].length === 0;
    const addedField = !Object.hasOwn(prior.profileBaselines || {}, field) && empty;
    if (first || addedField || hash(settings[field] ?? null) === prior.profileBaselines?.[field]) patch[field] = clone(workspace.profile[field]);
    else preservedFields.push(field);
  }
  if (patch.resumeText != null) patch.resumeText = sanitizeResumeForPrompt(patch.resumeText);
  const next = {...settings,...patch};
  if (workspace.schemaVersion === 2 && !preservedFields.includes('jobDescription')) patch.jobDescription = (next.jobProfiles || []).find(p => p.id === next.activeJobProfileId)?.jobDescription || next.jobDescription;
  patch.personalWorkspaceRevision = workspace.revision;
  patch.personalWorkspace = {schemaVersion:workspace.schemaVersion,revision:workspace.revision,sourceCount:workspace.sourceManifest?.length || new Set(workspace.facts.cards.flatMap(c => c.sources.map(s => s.path))).size,
    importedAt:new Date().toISOString(),profileBaselines:Object.fromEntries(Object.keys(workspace.profile).map(k => [k,hash(k === 'resumeText' ? sanitizeResumeForPrompt(workspace.profile[k]) : workspace.profile[k])])),
    cardBaselines:Object.fromEntries(workspace.facts.cards.map(c => [c.cardId,hash(c)]))};
  const materialPreview=materialService.previews.get(token);
  if(!materialPreview)throw new Error('材料预览已失效，请重新选择个人资料');
  const combined=combinePacks(materialPreview.packs,variants,true);
  const stagedFacts=combined.index?mergeFactIndexes(materialService.snapshot.facts,combined.index,{mode:materialPreview.mode,resolutions:safeResolutions}).index:materialService.snapshot.facts;
  let previousPointer=null;
  try{previousPointer=JSON.parse(fs.readFileSync(path.join(materialService.directory,'previous.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const transaction={schemaVersion:1,id:randomUUID(),createdAt:new Date().toISOString(),baseGeneration,basePointer:clone(materialService.pointer),previousPointer,
    expectedFactSha256:digest(JSON.stringify(stagedFacts)),expectedSourceSha256:digest(JSON.stringify(materialPreview.sources)),publishedGeneration:null,revision:workspace.revision,phase:'prepared',patch,
    beforeFields:Object.fromEntries(MANAGED_FIELDS.map(key=>[key,Object.hasOwn(settings,key)?{present:true,value:clone(settings[key])}:{present:false}]))};
  const file=journalPath(materialService);
  activeTransactions.add(materialService);
  try{writeJournal(file,transaction);}catch(error){activeTransactions.delete(materialService);throw error;}
  let publication;
  try{publication=materialService.commitImport({...prepared.materialPreview,resolutions:safeResolutions,mappings,variants});}catch(error){publication=Promise.reject(error);}
  // Keep the unified material queue occupied until settings and verification are
  // committed too. Later imports cannot slip between publication and compensation.
  const completion=publication.then(state=>{
    transaction.publishedGeneration=state.generation;transaction.phase='materials-published';writeJournal(file,transaction);
    if(!ownsPublishedGeneration(materialService,transaction))throw new Error('个人资料提交期间材料版本已变化');
    materialService.verifyPersisted();
    const current=store.getSettings(),writePatch={};
    for(const [key,value] of Object.entries(patch)) {
      const before=transaction.beforeFields[key];
      if(!sameValue(current[key],before.present?before.value:undefined)&&!['personalWorkspace','personalWorkspaceRevision'].includes(key)){preservedFields.push(key);continue;}
      writePatch[key]=value;
    }
    transaction.patch=writePatch;transaction.phase='settings-pending';writeJournal(file,transaction);
    store.setSettings(writePatch,{replaceFields:Object.keys(writePatch)});store.verifyPersisted?.();
    transaction.phase='committed';writeJournal(file,transaction);
    // Failure to remove a completed journal is cleanup work, not a failed
    // import. Keep the durable marker so the next startup can safely remove it.
    let cleanupPending=false;try{clearJournal(file);}catch{cleanupPending=true;}
    previews.delete(token);
    return {...getPersonalWorkspaceState({materialService,store}),applied:true,generation:state.generation,counts:state.counts,preservedCards:prepared.preservedCards,preservedFields:[...new Set(preservedFields)],backupPath,cleanupPending};
  }).catch(error=>{
    try {
      error.recovery=compensateImport({materialService,store,transaction});clearJournal(file);
      if(error.recovery.reason==='newer-generation-retained')error.message+='；已保留更新的材料版本，未回滚其他导入';
    } catch(recoveryError) {
      error.code='personal-import-recovery-needed';error.recoveryError=recoveryError;
      error.message+='；自动恢复未完成，已保留事务日志，下次启动将重试恢复：'+recoveryError.message;
    }
    previews.delete(token);throw error;
  }).finally(()=>activeTransactions.delete(materialService));
  materialService.queue=completion.catch(()=>{});
  return completion;
}
function getPersonalWorkspaceState({materialService,store}) {
  recoverPersonalWorkspaceImport({materialService,store});
  const settings = store.getSettings(), meta = settings.personalWorkspace || {}, facts = materialService?.snapshot?.facts;
  return {revision:settings.personalWorkspaceRevision || '',schemaVersion:meta.schemaVersion || null,generation:materialService?.snapshot?.generation || '',factRevision:materialService?.snapshot?.factRevision || '',cardCount:facts?.cards.length || 0,sourceCount:meta.sourceCount || 0,
    projects:(facts?.projects || []).filter(p => p.kind !== 'knowledge').map(p => ({id:p.id,name:p.name,cardCount:facts.cards.filter(c => c.projectId === p.id).length})),...profileSummary(settings),importRecovery:recoveryResults.get(materialService)||null};
}
function selectJobProfile({jobProfileId,store,materialService}) {
  recoverPersonalWorkspaceImport({materialService,store});
  const settings = store.getSettings(), profiles = clone(settings.jobProfiles || []), selected = profiles.find(p => p.id === jobProfileId);
  if (!JOB_PROFILE_IDS.includes(jobProfileId) || !selected) throw new Error('岗位画像不存在，请先导入个人资料');
  const current = profiles.find(p => p.id === settings.activeJobProfileId);
  if (current) current.jobDescription = String(settings.jobDescription || current.jobDescription);
  store.setSettings({jobProfiles:profiles,activeJobProfileId:jobProfileId,jobDescription:selected.jobDescription});
  return getPersonalWorkspaceState({materialService,store});
}
function getSelectedJobProfileContext({store,materialService}) {
  recoverPersonalWorkspaceImport({materialService,store});
  const settings = store.getSettings(), selected = (settings.jobProfiles || []).find(p => p.id === settings.activeJobProfileId);
  return {jobProfileId:selected?.id || '',jobDescription:String(settings.jobDescription || selected?.jobDescription || ''),priorityTopics:clone(selected?.priorityTopics || []),
    candidateProfile:settings.candidateProfile ? validateCandidateProfile(settings.candidateProfile) : null,resumeText:sanitizeResumeForPrompt(settings.resumeText)};
}
async function installPersonalWorkspace({directory,materialService,store}) {
  recoverPersonalWorkspaceImport({materialService,store});
  if (!directory) return {applied:false,reason:'not-requested'};
  const preview = await preparePersonalWorkspaceImport({filePath:path.join(path.resolve(directory),'workspace.json'),materialService,store});
  if (preview.conflicts?.length || preview.packConflicts?.length) throw new Error('个人项目资料存在未解决的身份冲突');
  return commitPersonalWorkspaceImport({...preview,materialService,store});
}
module.exports = {validatePersonalWorkspace,installPersonalWorkspace,preparePersonalWorkspaceImport,commitPersonalWorkspaceImport,recoverPersonalWorkspaceImport,getPersonalWorkspaceState,selectJobProfile,getSelectedJobProfileContext,sanitizeResumeForPrompt,MAX_WORKSPACE_BYTES};
