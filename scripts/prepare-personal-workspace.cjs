#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseDocumentFile} = require('../src/resume');
const {validatePersonalWorkspace,MAX_WORKSPACE_BYTES} = require('../src/personal-workspace');
const {compilePersonalWorkspace} = require('../src/personal-workspace-compiler');
async function text(file, limit=8*1024*1024) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw new Error('个人资料文件无效或超过允许大小');
  return /\.(?:pdf|docx)$/i.test(file)?parseDocumentFile(file):fs.readFileSync(file,'utf8');
}
function writeLocal(directory,name,value) {
  const target=path.join(directory,name),temporary=target+'.tmp-'+process.pid;
  fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,target);
}
async function preparePersonalWorkspace({resumePath,factsPath,jdPath,workspacePath,taskDirectory,seedPath,baselinePath,auditPath,directory=path.join(__dirname,'../materials/personal')}) {
  let workspace,compiled;
  if(workspacePath)workspace=validatePersonalWorkspace(JSON.parse(await text(workspacePath,MAX_WORKSPACE_BYTES)));
  else if(taskDirectory||seedPath) {
    const root=path.resolve(taskDirectory||path.join(path.dirname(seedPath),'..'));
    compiled=compilePersonalWorkspace({taskDirectory:root,baselinePath,auditPath,resumeText:resumePath?await text(resumePath):undefined});workspace=compiled.workspace;
  } else {
    if(!resumePath||!factsPath||!jdPath)throw new Error('请提供个人工作区，或简历、已编译事实和岗位文件');
    workspace=validatePersonalWorkspace({schemaVersion:1,facts:JSON.parse(await text(factsPath,MAX_WORKSPACE_BYTES)),profile:{resumeText:(await text(resumePath)).trim(),jobDescription:(await text(jdPath)).trim()}});
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700});writeLocal(directory,'workspace.json',workspace);
  if(compiled){writeLocal(directory,'facts.json',workspace.facts);writeLocal(directory,'manifest.json',compiled.manifest);writeLocal(directory,'merge-log.json',compiled.mergeLog);}
  return workspace;
}
if(require.main===module) {
  const options={},flags={'--resume':'resumePath','--facts':'factsPath','--jd':'jdPath','--workspace':'workspacePath','--task-directory':'taskDirectory','--seed':'seedPath','--baseline':'baselinePath','--audit':'auditPath','--directory':'directory'},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!flags[args[i]]||!args[i+1]){process.stderr.write('用法：npm run prepare:personal -- --workspace 工作区.json [--directory materials/personal]\n或 --task-directory 附件目录 [--baseline 旧workspace.json] [--audit 来源核查.json]\n兼容：--resume 简历.pdf --facts 已编译事实.json --jd 岗位.txt\n');process.exit(2);}
    options[flags[args[i]]]=args[i+1];
  }
  preparePersonalWorkspace(options).then(workspace=>process.stdout.write(`个人工作区已准备：v${workspace.schemaVersion}，${workspace.facts.cards.length} 张卡，revision ${workspace.revision}；私人原文仅保存在本地。\n`)).catch(error=>{process.stderr.write('个人工作区准备失败：'+error.message+'\n');process.exitCode=1;});
}
module.exports={preparePersonalWorkspace};
