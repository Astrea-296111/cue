#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseDocumentFile} = require('../src/resume');
const {validatePersonalWorkspace} = require('../src/personal-workspace');

async function text(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('个人资料文件无效或超过 8MiB');
  return /\.(?:pdf|docx)$/i.test(file) ? parseDocumentFile(file) : fs.readFileSync(file, 'utf8');
}
async function preparePersonalWorkspace({resumePath, factsPath, jdPath, directory=path.join(__dirname,'../.cue-private')}) {
  const workspace = validatePersonalWorkspace({schemaVersion:1,
    facts:JSON.parse(await text(factsPath)),
    profile:{resumeText:(await text(resumePath)).trim(), jobDescription:(await text(jdPath)).trim()}});
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const target = path.join(directory,'workspace.json'), temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(workspace,null,2)+'\n', {mode:0o600});
  fs.renameSync(temporary,target);
  return workspace;
}
if (require.main === module) {
  const options={}, flags={'--resume':'resumePath','--facts':'factsPath','--jd':'jdPath','--directory':'directory'}, args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!flags[args[i]] || !args[i+1]) { process.stderr.write('用法：node scripts/prepare-personal-workspace.cjs --resume 简历.pdf --facts 事实.json --jd 岗位.txt [--directory .cue-private]\n'); process.exit(2); }
    options[flags[args[i]]]=args[i+1];
  }
  preparePersonalWorkspace(options).then(workspace=>process.stdout.write(`个人工作区已准备：${workspace.facts.cards.length} 张事实卡；原文仅写本地目录。\n`))
    .catch(()=>{process.stderr.write('个人工作区导入失败，请核对文件路径、格式和大小。\n');process.exitCode=1;});
}
module.exports={preparePersonalWorkspace};
