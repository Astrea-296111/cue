#!/usr/bin/env node
'use strict';
// Local acceptance for the CUE final pack. Never prints private cards or SDK bodies.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {ProjectMaterialService}=require('../src/project-material-service');
const {ProjectFactPacks,validateIndex}=require('../src/project-fact-packs');
const {loadAdapter,sha}=require('../test/helpers/material-fixture');
const {createInterviewRuntime}=require('../test/helpers/interview-agent-runtime');
const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const cases=[
 ['CAE 项目介绍',['cae'],'cae.overview'],['你们几个人',['cae'],'cae.collaboration'],['你负责哪块',['cae'],'cae.ownership'],['用了多久',['cae'],'cae.timeline'],
 ['那 Arclight 呢',['arclight'],null],['是你一个人做的吗',['arclight'],'arclight.collaboration'],['你负责什么',['arclight'],'arclight.ownership'],['Arclight 时间线是什么',['arclight'],'arclight.timeline'],
 ['不是 CAE，是 Arclight',['arclight'],null],['Redis 过期策略是什么',[],null],['只有五种吗',[],null],['回到刚才那个项目',['arclight'],null],
 ['CAE 恢复机制如何实现',['cae'],null],['CAE 团队如何协作',['cae'],'cae.collaboration'],['CAE 个人职责是什么',['cae'],'cae.ownership'],
 ['比较 CAE 与 Arclight 的实现',['arclight','cae'],null],['那你们几个人',[],null],['介绍星河项目',[],null],['Arclight 项目介绍',['arclight'],'arclight.overview'],['CAE 项目介绍',['cae'],'cae.overview']
];
async function main(){
 if(!arg('--facts'))throw new Error('请提供 --facts 本地最终事实 JSON 路径');
 const original=validateIndex(JSON.parse(fs.readFileSync(arg('--facts'),'utf8'))),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cue-local-acceptance-')),cleanup=[];
 try{
 const bundled=new ProjectFactPacks().getIndex(),adapter=loadAdapter(dir),service=new ProjectMaterialService({directory:dir,bundled,sourceAdapter:adapter});
 const imports=[];
 for(const key of ['--cae-source','--arclight-source'])if(arg(key)){const t=performance.now(),p=await service.prepareImport({kind:'folder',path:arg(key)});await service.commitImport(p);imports.push({project:key.slice(2,-7),ms:performance.now()-t,sourceChunks:service.state().counts.sourceChunks});}
 const p=await service.prepareImport({kind:'json',path:arg('--facts')});await service.commitImport(p);
 const ordered=cards=>JSON.stringify([...cards].sort((a,b)=>a.cardId.localeCompare(b.cardId)));
 assert.equal(sha(ordered(service.snapshot.facts.cards)),sha(ordered(original.cards)),'preserve original text/status/provenance');
 const modes=[];
 for(const mode of ['instant','standard']){
 const r=createInterviewRuntime({after:fn=>cleanup.push(fn)},{indexSnapshot:service.snapshot.sources,settings:{realtimeAnswerMode:mode,sourceRagPolicies:{instant:'off',standard:'off'},manualProjectKnowledgeEnabled:false}});
 const preview=await r.invoke('materials:prepare',{index:original,mode:'replace-all'});await r.invoke('materials:commit',preview);
 const rows=[];
 for(const [question,expected,required] of cases){await r.ask('say',question);const d=r.events.filter(e=>e.channel==='llm:materials').at(-1),body=r.calls.at(-1).messages[0].content;assert.deepEqual([...d.projectIds].sort(),[...expected].sort(),question);assert.ok(d.sentFactIds.every(id=>expected.some(project=>id.startsWith(project+'.'))),'cross-project card');if(required){assert.ok(d.sentFactIds.includes(required),question+' must send '+required);assert.ok(body.includes(required),'fact source label visible at SDK');}rows.push({projectIds:d.projectIds,sentFactIds:d.sentFactIds,requiredCard:required,reason:d.resolutionReason});}
 assert.equal(r.searches.length,0);modes.push({mode,questions:rows.length,sourceSearches:r.searches.length,rows});
 }
 const report={privateDataPublished:false,provider:'stream mock',onlineModelTested:false,cards:original.cards.length,embeddedDocuments:Object.keys(original.sourceDocuments||{}).length,projects:service.state().projects.map(p=>({id:p.id,facts:p.factCount,sourceChunks:p.sourceChunks})),imports,modes};
 if(arg('--output'))fs.writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cards:report.cards,embeddedDocuments:report.embeddedDocuments,projects:report.projects,imports,modes:modes.map(m=>({mode:m.mode,questions:m.questions,sourceSearches:m.sourceSearches})),onlineModelTested:false},null,2));
 }finally{for(const fn of cleanup)await fn();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});
