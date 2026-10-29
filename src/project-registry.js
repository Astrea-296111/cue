'use strict';
const { createHash } = require('crypto');
const { buildProjectCatalog } = require('./project-scope');
const normalized = value => String(value||'').toLowerCase().replace(/(?:-main|-master|\.zip)$/,'').replace(/[\s_-]/g,'');
const sourceScopes = project => Array.isArray(project.sourceScopes) ? project.sourceScopes : typeof project.prefix==='string'&&project.prefix ? [project.prefix] : [];
function strictProjectScopes(scopes) {
  return Array.isArray(scopes) && scopes.length>0 && scopes.every(s=>typeof s==='string'&&s.trim()===s&&s.length>0&&(s.startsWith('@project:')?s.length>9:!s.includes('..')));
}
function buildRegistry(facts, source, mappings={}, activeSources={}) {
  const rows = facts.projects.filter(p=>p.kind!=='knowledge').map(p=>({...p,projectId:p.id,factProjectId:p.id,sourceProjectIds:[],sourceScopes:[],resumeOrder:Number.isInteger(p.resumeOrder)?p.resumeOrder:null,factRevision:facts.revision,sourceRevision:''}));
  const conflicts=[];
  for(const original of buildProjectCatalog(source)) {
    const names=[original.name,...original.aliases||[]].map(normalized);
    let matches=rows.filter(p=>p.factProjectId&&(p.id===original.projectId||[p.name,...p.aliases||[]].some(a=>names.includes(normalized(a)))));
    if(original.hasManifest&&rows.some(p=>p.id===original.projectId))matches=rows.filter(p=>p.id===original.projectId);
    if(Object.hasOwn(mappings,original.projectId)) {
      const id=mappings[original.projectId];
      if(typeof id!=='string'||!id||/[/\\]|\.\./.test(id))throw new Error('项目映射目标无效');
      let selected=rows.find(p=>p.id===id);
      if(!selected){selected={...original,id,projectId:id,aliases:[...original.aliases||[],id],factProjectId:null,sourceProjectIds:[],sourceScopes:[]};rows.push(selected);}
      matches=[selected];
    }
    else if(original.hasManifest&&matches.length&&!matches.some(p=>p.id===original.projectId)){conflicts.push({sourceId:original.projectId,candidates:matches.map(p=>p.id),reason:'manifest-id-mismatch'});continue;}
    if(matches.length>1) {conflicts.push({sourceId:original.projectId,candidates:matches.map(p=>p.id)});continue;}
    let row=matches[0];
    if(!row){row={...original,id:original.projectId||original.prefix,projectId:original.projectId||original.prefix,factProjectId:null,sourceProjectIds:[],sourceScopes:[]};rows.push(row);}
    row.sourceProjectIds.push(original.projectId);
    row.sourceScopes.push(...sourceScopes(original));
    row.aliases=[...new Set([...(row.aliases||[]),original.name,...original.aliases||[]])];
    row.resumeOrder=row.resumeOrder??original.resumeOrder??null;
    row.sourceRevision=original.sourceRevision;
    row.hasManifest=original.hasManifest;row.manifestPath=original.manifestPath;
  }
  for(const row of rows) {
    const active=activeSources[row.id];
    if(active && row.sourceProjectIds.includes(active)) {
      row.archivedSourceProjectIds=row.sourceProjectIds.filter(id=>id!==active);
      row.sourceProjectIds=[active];
      row.sourceScopes=row.sourceScopes.filter(scope=>scope===`@project:${active}`);
      const current=source.projects?.find(project=>project.id===active);
      row.sourceRevision=current?.revision||current?.sourceRevision||'';
      row.activeSourceProjectId=active;
      row.activeSourceSnapshotId=current?.contentHash||current?.revision||'';
    }
    row.sourceScopes=[...new Set(row.sourceScopes)];row.prefix=row.sourceScopes[0]||`@facts:${row.id}`;
    row.retrieveSources=strictProjectScopes(row.sourceScopes);row.label=row.name;
  }
  return {schemaVersion:1,projects:rows,conflicts,revision:createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,24)};
}
module.exports={buildRegistry,strictProjectScopes,sourceScopes};
