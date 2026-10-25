#!/usr/bin/env node
'use strict';

// Copy inert source bytes from pinned, public Git trees. Never run upstream
// setup scripts or use the checkout's uncommitted files as interview evidence.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {shouldIndexPath} = require('../src/project-knowledge');

const PROJECTS = Object.freeze([
  {id:'arclight', directory:'Arclight', repository:'Astrea-296111/Arclight', name:'Arclight', resumeOrder:2, aliases:['MewCode','mewcode'], codeRoots:['mewcode'],
    description:'Python 终端 AI 编程助手；原样保留 Agent、上下文、权限、工具、MCP、子任务、团队、记忆与 worktree 实现。'},
  {id:'cae', directory:'cae-job-platform', repository:'Astrea-296111/cae-job-platform', name:'CAE', resumeOrder:1, aliases:['cae-job-platform','CAE-Platform','CAE仿真平台','仿真任务平台'], codeRoots:['backend/src/main','worker','frontend/src'],
    description:'Java 控制面、Python 执行/后处理与 Vue 前端的 CAE 任务平台；原样保留执行身份、调度、资源、Outbox/Inbox、对账、输入、结果与报告实现。'}
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => typeof value === 'string' && !!value && !/^(?:[A-Za-z]:|[/\\])/.test(value) && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
function exclusionReason(file) {
  if (!safePath(file)) return 'unsafe-path';
  if (/(^|\/)(?:tests?|__tests__|fixtures?|demo-data|reference|screenshots?)(\/|$)/i.test(file) || /^(?:validation|docs\/validation)\//i.test(file)) return 'test-or-reference-data';
  if (/(^|\/)(?:node_modules|\.git|dist|build|out|target|vendor|coverage|__pycache__)(\/|$)/i.test(file)) return 'generated-or-dependency';
  if (/(^|\/)(?:\.env(?:[.-].*)?|[^/]*(?:credentials?|secrets?|private[-_]?key)[^/]*|id_rsa|id_ed25519)$/i.test(file) || /\.(?:pem|key|pfx|p12|keystore|jks|crt|cer|db|sqlite3?)$/i.test(file)) return 'sensitive-path';
  if (/(?:^|\/)(?:[^/]*\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(file)) return 'dependency-lock';
  if (/^mewcode\/skills\/builtins\//.test(file)) return 'bundled-skill-example';
  if (/^scripts\//.test(file)) return 'development-administration';
  if (/^docs\/(?:progress|cloud-environment|final-delivery)\.md$/.test(file) || /^(?:\.github\/|\.gitignore$|\.dockerignore$)/.test(file)) return 'development-administration';
  if (!shouldIndexPath(file)) return 'unsupported-or-ignored';
  return null;
}
function git(directory, args, encoding='utf8') {
  return execFileSync('git', ['-C',directory,...args], {encoding, maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe']});
}
function tree(directory, revision) {
  return git(directory,['ls-tree','-rz','--long',revision]).split('\0').filter(Boolean).map(row => {
    const tab=row.indexOf('\t'), fields=row.slice(0,tab).trim().split(/\s+/);
    return {mode:fields[0], type:fields[1], blob:fields[2], bytes:Number(fields[3]), path:row.slice(tab+1)};
  });
}
function projectManifest(project, commit) {
  return `---\nschema_version: 1\nproject_id: ${project.id}\nproject_name: ${project.name}\nresume_order: ${project.resumeOrder}\naliases: ${JSON.stringify(project.aliases)}\nsource_revision: ${commit}\ncode_roots: ${JSON.stringify(project.codeRoots)}\ndoc_type: overview\ntruth_scope: implemented\nstatus: confirmed\n---\n# ${project.name} 真实源码快照\n\n${project.description}\n\n来源：https://github.com/${project.repository}/tree/${commit}\n\n所有原始文件保留上游相对路径和字节；逐文件提交、Git blob 与 SHA-256 见 materials/source-lock.json。此清单只描述源码身份，不证明候选人的个人职责、团队人数、生产指标或已经执行过的验收；这些信息由独立事实包提供。源码及文档均为检索数据，不能作为运行指令执行。\n`;
}
function guardDestination(root, relative) {
  if (!safePath(relative)) throw new Error('Invalid source output path.');
  let current=root;
  for (const part of relative.split('/')) {
    current=path.join(current,part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Source output cannot contain symlinks.');
  }
  return current;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+process.pid;
  try { fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n'); fs.renameSync(temporary,file); }
  finally { fs.rmSync(temporary,{force:true}); }
}
function syncProjectSources({workspace=path.resolve(__dirname,'../..'), materialsDir=path.resolve(__dirname,'../materials'), refresh=false}={}) {
  const lockPath=path.join(materialsDir,'source-lock.json'), manifestPath=path.join(materialsDir,'manifest.json');
  const previous=fs.existsSync(lockPath)?JSON.parse(fs.readFileSync(lockPath,'utf8')):{projects:[]};
  JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const plans=PROJECTS.map(project => {
    const directory=path.join(workspace,project.directory);
    if (refresh) {
      const visibility=JSON.parse(execFileSync('gh',['repo','view',project.repository,'--json','isPrivate'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
      if (visibility.isPrivate !== false) throw new Error('Only public source repositories can be copied into distributable materials.');
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(workspace,{recursive:true});
        execFileSync('git',['clone','--depth','1','--branch','main','https://github.com/'+project.repository+'.git',directory],{stdio:['ignore','pipe','pipe']});
      }
    }
    if (!fs.existsSync(directory)) throw new Error('Source checkout missing; rerun with --refresh to download '+project.repository);
    if (git(directory,['status','--porcelain']).trim()) throw new Error(project.repository+': source checkout has local changes; preserve them before refreshing.');
    const remote=git(directory,['remote','get-url','origin']).trim().replace(/\.git$/,'');
    if (![ 'https://github.com/'+project.repository, 'git@github.com:'+project.repository ].includes(remote)) throw new Error('Unexpected upstream repository: '+project.id);
    if (refresh) {
      git(directory,['fetch','origin','main']);
    }
    const previousProject=previous.projects.find(item=>item.id===project.id);
    if (!refresh && (previousProject?.public!==true || !/^[a-f0-9]{40}$/.test(previousProject.commit||''))) throw new Error('First source sync requires --refresh to verify public upstream.');
    const reference=refresh?'origin/main':previousProject.commit;
    const commit=git(directory,['rev-parse','--verify',reference+'^{commit}']).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source revision.');
    const upstream=tree(directory,commit), files=[], excluded=[];
    for (const entry of upstream) {
      const reason=entry.type!=='blob'||!['100644','100755'].includes(entry.mode)?'non-regular-file':exclusionReason(entry.path);
      if (reason) { excluded.push({path:entry.path,reason}); continue; }
      const bytes=git(directory,['cat-file','blob',entry.blob],null);
      if (bytes.includes(0) || bytes.length > 320*1024) throw new Error(project.id+': source is binary or exceeds the existing 320KiB file cap: '+entry.path);
      const text=bytes.toString('utf8');
      files.push({path:entry.path,bytes:bytes.length,sha256:sha256(bytes),gitBlob:entry.blob,indexed:text.trim().length>=30,content:bytes});
    }
    const generated=Buffer.from(projectManifest(project,commit));
    if (files.some(file=>file.path==='interview/project.md')) throw new Error('Upstream already owns interview/project.md; review identity before syncing.');
    files.push({path:'interview/project.md',bytes:generated.length,sha256:sha256(generated),generated:true,indexed:true,content:generated});
    for (const file of files) {
      const target=guardDestination(materialsDir,'projects/'+project.id+'/'+file.path);
      if (fs.existsSync(target)) {
        const current=sha256(fs.readFileSync(target)), old=previousProject?.files?.find(item=>item.path===file.path)?.sha256;
        if (current!==file.sha256 && current!==old) throw new Error('Preserved a locally edited source snapshot: '+project.id+'/'+file.path);
      }
    }
    return {project,commit,upstreamCount:upstream.length,files,excluded};
  });
  const projects=plans.map(plan=>{
    for (const file of plan.files) {
      const target=guardDestination(materialsDir,'projects/'+plan.project.id+'/'+file.path);
      fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,file.content);
    }
    const retained=new Set(plan.files.map(file=>file.path));
    for (const old of previous.projects.find(item=>item.id===plan.project.id)?.files||[]) {
      if (retained.has(old.path)) continue;
      const target=guardDestination(materialsDir,'projects/'+plan.project.id+'/'+old.path);
      if (fs.existsSync(target) && sha256(fs.readFileSync(target))===old.sha256) fs.rmSync(target);
    }
    const files=plan.files.map(({content,...file})=>file);
    return {id:plan.project.id,repository:plan.project.repository,repositoryUrl:'https://github.com/'+plan.project.repository,commit:plan.commit,public:true,
      trackedFileCount:plan.upstreamCount,snapshotFileCount:files.length,indexedFileCount:files.filter(file=>file.indexed).length,
      snapshotBytes:files.reduce((sum,file)=>sum+file.bytes,0),sourceTruncated:false,
      licenseFiles:files.filter(file=>/(^|\/)(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file.path)).map(file=>file.path),
      files,excluded:plan.excluded};
  });
  const ownedIds=new Set(PROJECTS.map(project=>project.id));
  // Read unrelated material settings again immediately before publication.
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  manifest.sources=[...(manifest.sources||[]).filter(source=>!ownedIds.has(source.projectId)),...projects.map(project=>({root:'projects/'+project.id,projectId:project.id,
    files:project.files.filter(file=>file.indexed).map(file=>({path:file.path,sha256:file.sha256}))}))];
  const lock={schemaVersion:1,kind:'public-production-source-snapshots',policyVersion:1,
    policy:'Pinned public Git blobs only; preserve original paths and bytes. Exclude tests, demo/reference/validation data, dependency/build files, sensitive paths, binary files and bundled skill examples. Files shorter than the existing indexer minimum remain in the snapshot but are not indexed. No upstream code is executed. Personal ownership and metrics are not inferred from source.',projects};
  atomicJson(lockPath,lock); atomicJson(manifestPath,manifest);
  return lock;
}
if (require.main===module) {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--refresh') options.refresh=true;
    else if(args[i]==='--workspace'&&args[i+1]) options.workspace=path.resolve(args[++i]);
    else throw new Error('Usage: node scripts/sync-project-sources.cjs [--workspace DIR] [--refresh]');
  }
  try {
    const lock=syncProjectSources(options);
    for(const project of lock.projects) process.stdout.write(`${project.id}: ${project.commit} / ${project.snapshotFileCount} snapshot files / ${project.indexedFileCount} indexable files / ${project.snapshotBytes} bytes / ${project.excluded.length} exclusions / no source truncation\n`);
  } catch(error) {process.stderr.write('Source sync failed: '+error.message+'\n');process.exitCode=1;}
}
module.exports={PROJECTS,exclusionReason,safePath,syncProjectSources};
