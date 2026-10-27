'use strict';
// Only this service publishes material generations. No source document is ever executed or expanded.
const fs = require('fs');
const path = require('path');
const {createHash, randomUUID} = require('crypto');
const {EventEmitter} = require('events');
const {ProjectFactPacks,validateIndex,mergeFactIndexes,MAX_FACT_BYTES,migrateCard} = require('./project-fact-packs');
const {buildRegistry} = require('./project-registry');
const digest = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function immutable(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))immutable(child);}return value;}
const FACT_PATHS = ['interview/facts.json','project-fact-packs.json','CUE_最终项目事实.json'];
const emptySources = () => ({version:2,projects:[],chunks:[],stats:{fileCount:0,chunkCount:0}});
function materialError(code,message) {const e=new Error(message);e.code=code;return e;}
function validateSources(source) {
  if(!source||!Array.isArray(source.projects)||!Array.isArray(source.chunks)||source.projects.length>12||source.chunks.length>12*7000)throw new Error('源码快照结构或数量无效');
  const ids=new Set();
  for(const p of source.projects){if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id))throw new Error('源码项目身份无效或重复');ids.add(p.id);}
  for(const id of ids)if(source.chunks.filter(c=>c?.projectId===id).length>7000)throw new Error('单项目源码片段超过 7000');
  for(const c of source.chunks)if(!c||typeof c.text!=='string'||typeof c.path!=='string'||!c.path||/^(?:[A-Za-z]:|[/\\])/.test(c.path)||c.path.split(/[\\/]/).some(p=>p==='..'||p==='.')||(c.projectId&&!ids.has(c.projectId)))throw new Error('源码片段路径或项目归属无效');
  return source;
}
class ProjectMaterialService extends EventEmitter {
  constructor({directory,bundled,legacySource,sourceAdapter,failpoint=()=>{}}) {
    super();this.directory=path.join(directory,'cue-materials');this.userDirectory=directory;this.adapter=sourceAdapter;this.bundled=validateIndex(bundled);this.failpoint=failpoint;this.previews=new Map();this.queue=Promise.resolve();this.warnings=[];
    fs.mkdirSync(this.directory,{recursive:true});
    let pointer;try{pointer=JSON.parse(fs.readFileSync(path.join(this.directory,'current.json'),'utf8'));this.snapshot=this.readPointer(pointer);this.pointer=pointer;}catch(error){
      if(error.code!=='ENOENT')this.warnings.push('当前材料快照校验失败，尝试恢复上一版。');
      try{pointer=JSON.parse(fs.readFileSync(path.join(this.directory,'previous.json'),'utf8'));this.snapshot=this.readPointer(pointer);this.pointer=pointer;this.warnings.push('已恢复上一版完整材料。');}catch{
        if(fs.existsSync(path.join(this.directory,'current.json')))throw new Error('当前与上一版材料均无法校验；保留文件，请恢复备份。');
      }
    }
    if(!this.snapshot) {
      let facts=this.bundled;
      const old=path.join(directory,'project-fact-packs.json');
      if(fs.existsSync(old)) facts=mergeFactIndexes(facts,validateIndex(JSON.parse(fs.readFileSync(old,'utf8')))).index;
      for(const file of ['project-fact-packs.json','cue-project-index-v2.json','cue-project-index-v1.json']) {
        const full=path.join(directory,file);if(fs.existsSync(full)&&!fs.existsSync(full+'.pre-materials.bak'))fs.copyFileSync(full,full+'.pre-materials.bak',fs.constants.COPYFILE_EXCL);
      }
      this.publish({facts,sources:validateSources((typeof legacySource==='function'?legacySource():legacySource)||emptySources()),registry:null},false);
    }
  }
  readPointer(pointer) {
    if(pointer?.schemaVersion!==1||!/^\d+-[a-f0-9-]+$/.test(pointer.generation)||!pointer.files)throw new Error('材料指针无效');
    const data={};
    for(const key of ['facts','sources','registry']) {
      const record=pointer.files[key],expected=`snapshots/${pointer.generation}/${key}.json`;
      if(record?.path!==expected||!/^[a-f0-9]{64}$/.test(record.sha256))throw new Error('材料路径或摘要无效');
      const target=path.join(this.directory,expected),stat=fs.lstatSync(target);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>(key==='facts'?MAX_FACT_BYTES:(key==='sources'?512:2)*1024*1024))throw new Error('材料文件或大小无效');
      const real=fs.realpathSync(target);if(!real.startsWith(fs.realpathSync(this.directory)+path.sep))throw new Error('材料符号链接越界');
      const text=fs.readFileSync(target,'utf8');if(digest(text)!==record.sha256)throw new Error('材料摘要不匹配');data[key]=JSON.parse(text);
    }
    validateIndex(data.facts);validateSources(data.sources);
    const registry=buildRegistry(data.facts,data.sources,pointer.mappings||{});
    if(JSON.stringify(registry)!==JSON.stringify(data.registry))throw new Error('项目目录与材料不一致');
    return this.makeSnapshot(data.facts,data.sources,registry,pointer);
  }
  makeSnapshot(facts,sources,registry,pointer) {
    return Object.freeze({generation:pointer.generation,factRevision:pointer.files.facts.sha256,sourceRevision:pointer.files.sources.sha256,registryRevision:registry.revision,
      facts:immutable(facts),sources:immutable(sources),registry:immutable(registry),factPacks:new ProjectFactPacks({index:facts}),qaIndex:new (require('./qa-index').QAIndex)(facts,pointer.files.facts.sha256)});
  }
  writeFile(file,text) {const fd=fs.openSync(file,'w',0o600);try{fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  atomicPointer(name,pointer) {
    const file=path.join(this.directory,name),temp=file+'.tmp-'+randomUUID();this.writeFile(temp,JSON.stringify(pointer));
    let error;
    for(let i=0;i<3;i++){try{fs.renameSync(temp,file);return;}catch(e){error=e;if(!['EPERM','EACCES','EBUSY','EEXIST'].includes(e.code))break;}}
    try{fs.unlinkSync(temp);}catch{}throw error;
  }
  publish({facts,sources,mappings={}},notify=true) {
    facts=validateIndex(facts);sources=validateSources(sources);const registry=buildRegistry(facts,sources,mappings);
    if(registry.conflicts.length)throw materialError('ambiguous-project','项目身份有歧义，请在预览中指定映射。');
    // Canonical identity outlives the presence of fact cards. Replacing the fact
    // layer must not rename a retained source project or orphan a manual choice.
    mappings={...mappings};for(const project of registry.projects)if(project.factProjectId)for(const sourceId of project.sourceProjectIds)mappings[sourceId]=project.id;
    const n=Number(this.snapshot?.generation.split('-')[0]||0)+1,generation=`${n}-${randomUUID()}`;
    const dir=path.join(this.directory,'snapshots',generation);fs.mkdirSync(dir,{recursive:true});
    const pointer={schemaVersion:1,generation,mappings,files:{}};
    for(const [key,value] of Object.entries({facts,sources,registry})) {
      const text=JSON.stringify(value);this.writeFile(path.join(dir,key+'.json'),text);pointer.files[key]={path:`snapshots/${generation}/${key}.json`,sha256:digest(text)};this.failpoint('write-'+key);
    }
    const next=this.readPointer(pointer);this.failpoint('before-pointer');
    if(this.pointer)this.atomicPointer('previous.json',this.pointer);
    this.atomicPointer('current.json',pointer);
    // Publish first; even a process exit here restores the complete new generation on restart.
    this.pointer=pointer;this.snapshot=next;this.failpoint('after-pointer');
    if(notify)this.emit('changed',this.state());
    return this.state();
  }
  state() {
    const s=this.snapshot;
    return {generation:s.generation,factRevision:s.factRevision,sourceRevision:s.sourceRevision,registryRevision:s.registryRevision,warnings:[...this.warnings],
      previousGeneration:this.previousGeneration(),projects:s.registry.projects.map(p=>({...p,factCount:s.facts.cards.filter(c=>c.projectId===p.id).length,
        sourceFiles:new Set(s.sources.chunks.filter(c=>p.sourceProjectIds.includes(c.projectId)).map(c=>c.path)).size,sourceChunks:s.sources.chunks.filter(c=>p.sourceProjectIds.includes(c.projectId)).length})),
      counts:{facts:s.facts.cards.length,sourceChunks:s.sources.chunks.length,sourceProjects:s.sources.projects.length}};
  }
  verifyPersisted() {
    const saved=this.readPointer(JSON.parse(fs.readFileSync(path.join(this.directory,'current.json'),'utf8')));
    if(saved.generation!==this.snapshot.generation||saved.sourceRevision!==this.snapshot.sourceRevision||saved.factRevision!==this.snapshot.factRevision)throw materialError('persistence-mismatch','材料持久化校验失败，请重载资料后检查。');
    return true;
  }
  previousGeneration(){try{return JSON.parse(fs.readFileSync(path.join(this.directory,'previous.json'),'utf8')).generation;}catch{return null;}}
  async discover({kind,path:inputPath,factPaths=[]}) {
    if(kind==='json') {const stat=await fs.promises.stat(inputPath);if(stat.size>MAX_FACT_BYTES)throw new Error('事实包超过允许大小');return {packs:[validateIndex(JSON.parse(await fs.promises.readFile(inputPath,'utf8')))],excluded:[]};}
    if(!this.adapter)throw new Error('源码导入适配器不可用');
    const candidates=[...new Set([...FACT_PATHS,...factPaths])];for(const rel of candidates)if(!this.adapter.safeRelativePath(rel)||!this.adapter.shouldIndexPath(rel))throw new Error('事实文件相对路径无效或敏感');
    const packs=[],excluded=[],seen=new Set();
    const accept=(rel,buffer)=>{if(buffer.length>MAX_FACT_BYTES)throw new Error(rel+'：事实包超过允许大小');let parsed;try{parsed=validateIndex(JSON.parse(buffer.toString('utf8')));}catch(e){throw new Error(rel+'：'+e.message);}excluded.push(rel);const id=digest(buffer);if(!seen.has(id)){seen.add(id);packs.push(parsed);}};
    if(kind==='folder') {
      const root=await fs.promises.realpath(inputPath);
      for(const rel of candidates) {
        const file=path.join(root,rel);let stat;try{stat=await fs.promises.lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
        if(stat.isSymbolicLink()||!stat.isFile()||!(await fs.promises.realpath(file)).startsWith(root+path.sep))throw new Error(rel+'：符号链接或路径越界');
        if(stat.size>MAX_FACT_BYTES)throw new Error(rel+'：事实包超过允许大小');accept(rel,await fs.promises.readFile(file));
      }
    } else if(kind==='zip') {
      const stat=await fs.promises.stat(inputPath);if(stat.size>96*1024*1024)throw new Error('ZIP 超过 96MiB');
      const buffer=await fs.promises.readFile(inputPath),entries=this.adapter.readZipEntries(buffer);
      if(entries.some(e=>e.symlink))throw new Error('ZIP 不接受符号链接');
      const paths=entries.map(e=>this.adapter.safeRelativePath(e.name));
      if(paths.some((p,i)=>!p&&entries[i].name&&!entries[i].name.endsWith('/')))throw new Error('ZIP 路径越界');
      const useful=paths.filter(p=>p&&!p.endsWith('/')&&this.adapter.shouldIndexPath(p)),roots=new Set(useful.map(p=>p.split('/')[0]));
      const structural=new Set(['src','source','docs','doc','backend','frontend','server','client','app','apps','packages','services','test','tests','lib','config','resources','interview']);
      const root=roots.size===1&&!structural.has([...roots][0].toLowerCase())&&useful.every(p=>p.includes('/'))?[...roots][0]:null;
      const names=new Set();
      for(let i=0;i<entries.length;i++) {
        const entry=entries[i],rel=root?paths[i]?.slice(root.length+1):paths[i];
        if(!candidates.includes(rel))continue;if(names.has(rel))throw new Error('ZIP 存在重复事实文件：'+rel);names.add(rel);
        const extracted=this.adapter.extractZipEntry(buffer,entry,MAX_FACT_BYTES);if(!extracted)throw new Error(rel+'：事实文件不能解压');accept(rel,extracted);
      }
    } else throw new Error('未知材料导入类型');
    return {packs,excluded};
  }
  async prepareImport(input) {
    const base=this.snapshot;
    if(input.sourceSnapshot&&(!input.index||input.kind==='folder'||input.kind==='zip'))throw materialError('invalid-source-input','随包源码快照必须与事实索引一起导入。');
    const onProgress=typeof input.onProgress==='function'?input.onProgress:()=>{};
    onProgress({phase:'discover'});
    const discovered=input.index?{packs:[validateIndex(input.index)],excluded:[]}:await this.discover(input);
    let sources=input.sourceSnapshot?validateSources(copy(input.sourceSnapshot)):base.sources;
    const scanOptions={previous:base.sources,excludePaths:discovered.excluded,allowEmpty:discovered.packs.length>0,onProgress};
    if(input.kind==='folder'||input.kind==='zip')onProgress({phase:'scan',indexedFiles:0,sourceChunks:0});
    if(input.kind==='folder')sources=await this.adapter.scanProjectFolder(input.path,scanOptions);
    if(input.kind==='zip')sources=await this.adapter.scanProjectZip(input.path,scanOptions);
    const combined=combinePacks(discovered.packs);
    let facts=base.facts,changes=[];
    if(combined.index){const merged=mergeFactIndexes(facts,combined.index,{mode:input.mode||'merge'});facts=merged.index;changes=merged.changes;}
    const registry=buildRegistry(facts,sources,this.pointer.mappings||{});
    onProgress({phase:'ready',sourceChunks:sources.chunks.length,facts:facts.cards.length});
    const token=randomUUID();this.previews.set(token,{baseGeneration:base.generation,facts,sources,packs:discovered.packs,mode:input.mode||'merge',mappings:this.pointer.mappings||{},createdAt:Date.now()});
    if(this.previews.size>8)this.previews.delete(this.previews.keys().next().value);
    return {token,baseGeneration:base.generation,summary:{projects:registry.projects.map(p=>({id:p.id,name:p.name})),facts:facts.cards.length,sourceChunks:sources.chunks.length,factFiles:discovered.excluded},changes,conflicts:registry.conflicts,packConflicts:combined.conflicts,warnings:registry.conflicts.length?['请指定歧义源码项目的 canonical ID']:[],mode:input.mode||'merge'};
  }
  commitImport({token,baseGeneration,resolutions={},mappings={},variants={}}) {
    const job=async()=>{
      const prepared=this.previews.get(token);if(!prepared||Date.now()-prepared.createdAt>15*60000)throw materialError('preview-expired','预览已失效，请重新选择材料。');
      if(prepared.baseGeneration!==baseGeneration||this.snapshot.generation!==baseGeneration)throw materialError('revision-changed','材料版本已变化，请刷新预览后重试。');
      let facts=this.snapshot.facts;
      const combined=combinePacks(prepared.packs,variants,true);
      if(combined.index)facts=mergeFactIndexes(facts,combined.index,{mode:prepared.mode,resolutions}).index;
      const result=this.publish({facts,sources:prepared.sources,mappings:{...prepared.mappings,...mappings}});this.previews.delete(token);return result;
    };
    const result=this.queue.then(job,job);this.queue=result.catch(()=>{});return result;
  }
  rollbackMaterials({targetGeneration}={}) {
    const job=()=>{const previous=JSON.parse(fs.readFileSync(path.join(this.directory,'previous.json'),'utf8'));if(targetGeneration&&previous.generation!==targetGeneration)throw new Error('仅支持恢复上一代有效材料');const old=this.readPointer(previous);return this.publish({facts:old.facts,sources:old.sources,mappings:previous.mappings||{}});};
    const result=this.queue.then(job,job);this.queue=result.catch(()=>{});return result;
  }
  publishSource(sources) {const job=()=>this.publish({facts:this.snapshot.facts,sources,mappings:this.pointer.mappings||{}});const result=this.queue.then(job,job);this.queue=result.catch(()=>{});return result;}
  async importLegacy(kind,inputPath) {const preview=await this.prepareImport({kind,path:inputPath});await this.commitImport(preview);return this.adapter.getProjectIndexState(this.snapshot.sources);}
  clearSources(){return this.publishSource(emptySources());}
  refresh() {
    try {
      const pointer=JSON.parse(fs.readFileSync(path.join(this.directory,'current.json'),'utf8'));
      if(JSON.stringify(pointer)!==JSON.stringify(this.pointer)){this.snapshot=this.readPointer(pointer);this.pointer=pointer;this.emit('changed',this.state());}
    } catch(error) {
      const warning='外部材料变更校验失败，继续使用上一份有效材料。';
      if(!this.warnings.includes(warning)){this.warnings.push(warning);this.emit('warning',warning);}
      return {error:warning};
    }
  }
}
function combinePacks(packs,choices={},requireChoices=false) {
  if(!packs.length)return {index:null,conflicts:[]};
  const groups=new Map(),conflicts=[];
  const add=(key,value)=>{if(!groups.has(key))groups.set(key,[]);const items=groups.get(key);if(!items.some(v=>JSON.stringify(v)===JSON.stringify(value)))items.push(value);};
  for(const p of packs){for(const row of p.projects)add('project:'+row.id,row);for(const row of p.cards)add('card:'+row.cardId,row);for(const [name,text] of Object.entries(p.sourceDocuments||{}))add('document:'+name,text);}
  const projects=[],cards=[],sourceDocuments=Object.create(null);
  for(const [key,values] of groups){if(values.length>1){conflicts.push({key,variants:values});if(requireChoices&&(!Number.isInteger(choices[key])||choices[key]<0||choices[key]>=values.length))throw materialError('conflicting-packs','多份事实文件存在差异，请选择版本：'+key);}
    const value=values[choices[key]??values.length-1];if(key.startsWith('project:'))projects.push(value);else if(key.startsWith('card:'))cards.push(value);else sourceDocuments[key.slice(9)]=value;}
  const version=Math.max(...packs.map(p=>p.schemaVersion||1));
  return {index:validateIndex({schemaVersion:version,projects,cards:version===2?cards.map(migrateCard):cards,sourceDocuments,provenanceNotes:Object.assign({},...packs.map(p=>p.provenanceNotes||{}))}),conflicts};
}
module.exports={ProjectMaterialService,FACT_PATHS,digest,validateSources,combinePacks};
