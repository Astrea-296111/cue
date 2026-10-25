'use strict';

// Prepared alongside material publication. The answer path only matches a
// bounded identifier index; it never scans documents or asks a classifier.
const COMMON = new Set(('java javascript typescript python ruby rust golang node nodejs react vue spring springboot mysql postgres postgresql redis kafka rabbitmq mongodb sqlite docker kubernetes linux windows github git http https tcp udp sql api sdk rpc cli json yaml xml html css llm rag mcp ai agent agents tool tools memory context token tokens schema prompt prompts async asyncio await test tests license solver user code future reference project localbench readme string boolean integer status version content data object params process execute select update create delete true false none null server client framework model function skill skills functioncalling checkpoint retry confirm counter gauge actuator langgraph langchain textual pydantic').split(' '));
const keyFor = value => String(value).toLowerCase().replace(/[ _-]/g,'');
const metricTerms = value => String(value).match(/\d+(?:\.\d+)?\s*(?:ms\b|毫秒|s\b|秒|%|k\b)/gi)||[];

class ProjectEntityIndex {
  constructor(snapshot={}) {
    this.revision=snapshot.generation||null;
    this.entities=new Map();
    this.metrics=new Map();
    const projects=new Set((snapshot.registry?.projects||snapshot.facts?.projects||[]).filter(project=>project.kind!=='knowledge').map(project=>project.id||project.projectId));
    const add=(value,projectId)=>{
      const text=String(value||'').trim(),key=text.toLowerCase();
      if(!projects.has(projectId)||text.length<4||text.length>64||COMMON.has(key)||!/^[A-Za-z][A-Za-z0-9_]*(?:[ -][A-Za-z][A-Za-z0-9_]*)?$/.test(text)||!/[a-z][A-Z]|_|^[A-Z]/.test(text))return;
      if(!this.entities.has(key)&&this.entities.size>=12000)return;
      if(!this.entities.has(key))this.entities.set(key,{term:text,projectIds:new Set()});
      this.entities.get(key).projectIds.add(projectId);
    };
    const identifiers=(text,id)=>{
      for(const value of String(text||'').match(/\b(?:[A-Z][a-z0-9]+){2,}\b|\b[A-Za-z]+_[A-Za-z_]+\b/g)||[]) {
        add(value,id);
        const component=value.replace(/(?:Manager|Store|Service|Repository|Controller|Handler|Checker|Provider|Client)$/,'');
        if(component!==value)add(component,id);
      }
    };
    for(const card of snapshot.facts?.cards||[]) {
      if(!projects.has(card.projectId))continue;
      if(['FUTURE','REFERENCE-STORY','GAP'].includes(card.provenance)||['proposed_design','narrative_scenario','general_knowledge','unverified_reference'].includes(card.implementation))continue;
      for(const metric of metricTerms(card.text)) {
        const key=keyFor(metric.replace(/毫秒/g,'ms').replace(/秒/g,'s'));
        if(!this.metrics.has(key))this.metrics.set(key,new Set());
        this.metrics.get(key).add(card.projectId);
      }
      for(const keyword of card.keywords||[])add(keyword,card.projectId);
      identifiers(card.text,card.projectId);
      for(const source of card.sources||[])identifiers(source.symbol,card.projectId);
    }
    const sourceOwners=new Map();
    for(const project of snapshot.registry?.projects||[])for(const sourceId of project.sourceProjectIds||[])sourceOwners.set(sourceId,project.id||project.projectId);
    for(const chunk of snapshot.sources?.chunks||[]) {
      const owner=sourceOwners.get(chunk.projectId)||chunk.projectId;
      identifiers(chunk.symbol,owner);
      identifiers(String(chunk.path||'').split('/').at(-1),owner);
    }
    this.unique=new Map();
    for(const entity of this.entities.values()) {
      const key=keyFor(entity.term), prior=this.unique.get(key);
      if(!prior)this.unique.set(key,{terms:[entity.term],projectIds:new Set(entity.projectIds)});
      else {prior.terms.push(entity.term);for(const id of entity.projectIds)prior.projectIds.add(id);}
    }
  }
  infer(question='') {
    const text=String(question||'');
    if(require('./project-query').isClearProjectExit(text)||/换个|换一(?:个|道)|新话题|下一个问题|\b(?:new topic|next question)\b/i.test(text))return null;
    const words=text.match(/[A-Za-z][A-Za-z0-9_-]*/g)||[];
    const selected=words.length>64?[...words.slice(0,32),...words.slice(-32)]:words;
    const matches=[];
    for(let i=0;i<selected.length;i++)for(const candidate of [selected[i],selected[i+1]?selected[i]+' '+selected[i+1]:'']) {
      const entity=this.unique.get(keyFor(candidate));
      if(entity?.projectIds.size===1)matches.push(entity);
    }
    const metricHits=metricTerms(text).slice(0,64).map(term=>({term,owners:this.metrics.get(keyFor(term.replace(/毫秒/g,'ms').replace(/秒/g,'s')))})).filter(row=>row.owners?.size===1);
    const ids=[...new Set([...matches.flatMap(entity=>[...entity.projectIds]),...metricHits.flatMap(row=>[...row.owners])])];
    return ids.length===1?{projectId:ids[0],entities:[...new Set([...matches.flatMap(entity=>entity.terms),...metricHits.map(row=>row.term)])],revision:this.revision}:null;
  }
}

module.exports={ProjectEntityIndex};
