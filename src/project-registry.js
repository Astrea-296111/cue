'use strict';
const { createHash } = require('crypto');
const { buildProjectCatalog } = require('./project-scope');
const normalized = value => String(value||'').toLowerCase().replace(/(?:-main|-master|\.zip)$/,'').replace(/[\s_-]/g,'');
const sourceScopes = project => Array.isArray(project.sourceScopes) ? project.sourceScopes : typeof project.prefix==='string'&&project.prefix ? [project.prefix] : [];
function strictProjectScopes(scopes) {
  return Array.isArray(scopes) && scopes.length>0 && scopes.every(s=>typeof s==='string'&&s.trim()===s&&s.length>0&&(s.startsWith('@project:')?s.length>9:!s.includes('..')));
}
function buildRegistry(facts, source, mappings={}) {
  const rows = facts.projects.map(p=>({...p,projectId:p.id,factProjectId:p.id,sourceProjectIds:[],sourceScopes:[],resumeOrder:null,factRevision:facts.revision,sourceRevision:''}));
  const conflicts=[];
  for(const original of buildProjectCatalog(source)) {
    const names=[original.name,...original.aliases||[]].map(normalized);
    let matches=rows.filter(p=>p.factProjectId&&(p.id===original.projectId||[p.name,...p.aliases||[]].some(a=>names.includes(normalized(a)))));
    if(original.hasManifest&&rows.some(p=>p.id===original.projectId))matches=rows.filter(p=>p.id===original.projectId);
    if(Object.hasOwn(mappings,original.projectId)) {const selected=rows.find(p=>p.id===mappings[original.projectId]);if(!selected)throw new Error('项目映射目标不存在');matches=[selected];}
    else if(original.hasManifest&&matches.length&&!matches.some(p=>p.id===original.projectId)){conflicts.push({sourceId:original.projectId,candidates:matches.map(p=>p.id),reason:'manifest-id-mismatch'});continue;}
    if(matches.length>1) {conflicts.push({sourceId:original.projectId,candidates:matches.map(p=>p.id)});continue;}
    let row=matches[0];
    if(!row){row={...original,id:original.projectId||original.prefix,projectId:original.projectId||original.prefix,factProjectId:null,sourceProjectIds:[],sourceScopes:[]};rows.push(row);}
    row.sourceProjectIds.push(original.projectId);
    row.sourceScopes.push(...sourceScopes(original));
    row.aliases=[...new Set([...(row.aliases||[]),original.name,...original.aliases||[]])];
    row.resumeOrder=original.resumeOrder??row.resumeOrder??null;
    row.sourceRevision=original.sourceRevision;
    row.hasManifest=original.hasManifest;row.manifestPath=original.manifestPath;
  }
  for(const row of rows) {
    row.sourceScopes=[...new Set(row.sourceScopes)];row.prefix=row.sourceScopes[0]||`@facts:${row.id}`;
    row.retrieveSources=strictProjectScopes(row.sourceScopes);row.label=row.name;
  }
  return {schemaVersion:1,projects:rows,conflicts,revision:createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,24)};
}
module.exports={buildRegistry,strictProjectScopes,sourceScopes};
