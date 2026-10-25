'use strict';

// Persist one answer's transitions without rewriting every earlier response.
// Journals remain private and are folded into authenticated encrypted snapshots.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {stableCaseKey}=require('./multiturn-quality.cjs');
const DIRECTORY='judge-journal';
const MAX_CASE_BYTES=32*1024*1024,MAX_CHECKPOINT_BYTES=256*1024*1024;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function read(file,limit) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw new Error('Invalid private judge journal file.');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function writeCaseJournal(outputDir,identity,key,entry) {
  if(!/^[a-f0-9]{64}$/.test(identity)||typeof key!=='string'||key.length>512||!object(entry))throw new Error('Invalid private judge journal.');
  const directory=path.join(outputDir,DIRECTORY);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const target=path.join(directory,hash(key)+'.json'),temporary=target+'.tmp-'+crypto.randomUUID();
  const body=JSON.stringify({schemaVersion:1,identity,key,updatedAt:new Date().toISOString(),entry});
  if(Buffer.byteLength(body)>MAX_CASE_BYTES)throw new Error('Private judge journal exceeds its bounded size.');
  try{fs.writeFileSync(temporary,body,{mode:0o600});fs.renameSync(temporary,target);}
  finally{fs.rmSync(temporary,{force:true});}
}
function readCaseJournals(outputDir,identity,{after}={}) {
  const directory=path.join(outputDir,DIRECTORY),entries=Object.create(null);
  if(!fs.existsSync(directory))return entries;
  const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid private judge journal directory.');
  const files=fs.readdirSync(directory).filter(file=>/^[a-f0-9]{64}\.json$/.test(file));
  if(files.length>10000)throw new Error('Too many private judge journals.');
  for(const file of files) {
    const row=read(path.join(directory,file),MAX_CASE_BYTES);
    if(row.schemaVersion!==1||row.identity!==identity||typeof row.key!=='string'||row.key.length>512||
      hash(row.key)+'.json'!==file||!object(row.entry)||!Number.isFinite(Date.parse(row.updatedAt)))throw new Error('Private judge journal identity mismatch.');
    if(after&&Date.parse(row.updatedAt)<Date.parse(after))continue;
    entries[row.key]=row.entry;
  }
  return entries;
}
function hydrateJudgeSnapshot(outputDir,report) {
  const file=path.join(outputDir,'judge-checkpoint.json');
  if(!fs.existsSync(file))return {report,checkpoint:null};
  const checkpoint=read(file,MAX_CHECKPOINT_BYTES);
  if(checkpoint.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(checkpoint.identity||'')||!object(checkpoint.entries))throw new Error('Invalid private judge checkpoint.');
  const entries=Object.assign(Object.create(null),checkpoint.entries,readCaseJournals(outputDir,checkpoint.identity,{after:checkpoint.updatedAt}));
  const hydrated={...report,providers:(report.providers||[]).map(provider=>({...provider,cases:(provider.cases||[]).map(item=>{
    const entry=entries[stableCaseKey(item,provider.id)];
    return entry?{...item,judging:entry}:item;
  })}))};
  return {report:hydrated,checkpoint:{...checkpoint,entries,updatedAt:new Date().toISOString()}};
}
module.exports={DIRECTORY,writeCaseJournal,readCaseJournals,hydrateJudgeSnapshot};
