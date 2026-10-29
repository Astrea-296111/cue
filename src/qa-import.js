'use strict';
const { createHash } = require('crypto');
const { validateIndex, MAX_FACT_BYTES } = require('./project-fact-packs');
const sha = text => createHash('sha256').update(text).digest('hex');
function fail(location, message) { throw new Error(`${location}: ${message}`); }
function string(value, location, max = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(location, `需要 1–${max} 字符的文本`);
  return value;
}
function strings(value, location) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) fail(location, '需要最多 64 项的数组');
  return value.map((v, i) => string(v, `${location}[${i}]`, 2000));
}
function keys(value, allowed, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(location,'需要对象');
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${location}.${name}`,'未知字段');
}
function compile(raw) {
  if (Buffer.byteLength(raw) > MAX_FACT_BYTES) fail('文件', '超过 16MiB');
  let value;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch (e) { fail('JSON', e.message); }
  if (value?.format !== 'cue-qa/v1') fail('format', '必须为 cue-qa/v1');
  keys(value,['format','title','projects','items'],'root');
  if (!Array.isArray(value.projects) || !value.projects.length || !Array.isArray(value.items) || value.items.length > 4096) fail('projects/items', '结构或数量无效');
  for(const [i,p] of value.projects.entries()){
    keys(p,['id','name','aliases','kind'],`projects[${i}]`);
    if(p.kind!==undefined&&p.kind!=='knowledge')fail(`projects[${i}].kind`,'只接受 knowledge，项目资料请省略此字段');
  }
  const projects = value.projects.map((p, i) => ({ id: string(p.id, `projects[${i}].id`, 41),
    name: string(p.name, `projects[${i}].name`, 80), aliases: strings(p.aliases, `projects[${i}].aliases`), ...(p.kind === 'knowledge' ? { kind: 'knowledge' } : {}) }));
  const ids = new Set(), sourceHash = sha(raw), sourcePath = `qa/import-${sourceHash}.json`;
  const cards = value.items.map((item, i) => {
    keys(item,['id','projectId','topic','question','aliases','answerShort','answerDetailed','keywords','mustCover','excludeIntents','boundaries','sourceType','applicableVersion','delivery','enabled'],`items[${i}]`);
    const loc = `items[${i}]`, id = string(item.id, loc + '.id', 100);
    if (ids.has(id)) fail(loc + '.id', '重复 ID ' + id); ids.add(id);
    const projectId = string(item.projectId, loc + '.projectId', 41);
    if (!projects.some(p => p.id === projectId)) fail(loc + '.projectId', '项目不存在');
    const question = string(item.question, loc + '.question', 2000), aliases = strings(item.aliases, loc + '.aliases');
    const answerShort = string(item.answerShort, loc + '.answerShort'), detailed = item.answerDetailed === undefined ? '' : string(item.answerDetailed, loc + '.answerDetailed', 40000);
    const sourceType = item.sourceType || 'user_claim';
    if (!['user_claim', 'proposed_design', 'general_knowledge'].includes(sourceType)) fail(loc + '.sourceType', '允许 user_claim/proposed_design/general_knowledge；源码核实请使用 facts v2');
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') fail(loc + '.enabled', '需要布尔值');
    if (item.delivery && !['prefer_verbatim', 'evidence_only'].includes(item.delivery)) fail(loc + '.delivery', '无效策略');
    const boundaries = strings(item.boundaries, loc + '.boundaries');
    if(item.applicableVersion!==undefined&&(typeof item.applicableVersion!=='string'||item.applicableVersion.length>1000))fail(loc+'.applicableVersion','需要不超过 1000 字符的版本文本');
    return { cardId: id, projectId, topic: item.topic===undefined?question:string(item.topic,loc+'.topic',2000), docType: 'implementation',
      truthScope: sourceType === 'proposed_design' ? 'planned' : sourceType === 'general_knowledge' ? 'unverified' : 'implemented',
      status: 'source-claim', provenance: sourceType === 'proposed_design' ? 'FUTURE' : sourceType === 'general_knowledge' ? 'REFERENCE' : 'USER',
      implementation: sourceType === 'proposed_design' ? 'proposed_design' : sourceType === 'general_knowledge' ? 'general_knowledge' : 'resume_claim',
      path: sourcePath, text: answerShort, questions: [question, ...aliases], answerShort,
      deepPoints: detailed ? [detailed] : [], boundaries, cannotSay: [], followups: [], facts: [], related: [],
      keywords: strings(item.keywords, loc + '.keywords'), applicableVersion: item.applicableVersion || '',
      sources: [{ path: sourcePath, symbol: id, commit: null, contentSha256: sourceHash }],
      qa: { enabled: item.enabled !== false, delivery: item.delivery || 'evidence_only', answerDetailed: detailed,
        mustCover: strings(item.mustCover, loc + '.mustCover'), excludeIntents: strings(item.excludeIntents, loc + '.excludeIntents') } };
  });
  return validateIndex({ schemaVersion: 2, projects, cards, sourceDocuments: { [sourcePath]: raw } });
}
function exportQA(index) {
  return { format: 'cue-qa/v1', title: 'CUE 项目问答库', projects: index.projects.map(p=>({id:p.id,name:p.name,aliases:p.aliases,...(p.kind==='knowledge'?{kind:'knowledge'}:{})})),
    items: index.cards.filter(c => c.questions?.length && c.answerShort).map(c => ({ id: c.cardId, projectId: c.projectId,
      topic: c.topic, question: c.questions[0], aliases: c.questions.slice(1), answerShort: c.answerShort,
      answerDetailed: c.qa?.answerDetailed ?? c.deepPoints.join('\n\n'), keywords: c.keywords,
      boundaries: c.boundaries, sourceType: c.implementation === 'proposed_design' ? 'proposed_design' : c.implementation === 'general_knowledge' ? 'general_knowledge' : 'user_claim',
      applicableVersion: c.applicableVersion, enabled: c.qa?.enabled !== false,
      delivery: c.qa?.delivery || 'evidence_only', mustCover: c.qa?.mustCover || [], excludeIntents: c.qa?.excludeIntents || [] })) };
}
function compileMarkdown(raw) {
  if(Buffer.byteLength(raw)>MAX_FACT_BYTES)fail('Markdown','超过 16MiB');
  const normalized=raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if(!normalized.startsWith('# CUE-QA/v1\n'))fail('Markdown:1','需要 # CUE-QA/v1 标题');
  const blocks=normalized.split(/^## ID: /m);if(blocks.length<2||blocks[0].trim()!=='# CUE-QA/v1')fail('Markdown','需要 ## ID: 条目头，不接受任意长文切分');
  const projects=new Map(),items=[];
  for(const [i,block] of blocks.slice(1).entries()) {
    const lines=block.split('\n'),id=lines.shift().trim(),at=lines.indexOf('### A');
    if(at<0)fail(`Markdown 条目 ${i+1}`,'缺少 ### A');
    const fields={};for(const line of lines.slice(0,at).filter(x=>x.trim())) {
      const match=/^(Project|Q|Aliases|Meta): (.+)$/.exec(line);
      if(!match||fields[match[1]])fail(`Markdown 条目 ${i+1}`,'未知或重复字段：'+line);
      fields[match[1]]=match[2];
    }
    const project=/^([a-z][a-z0-9-]{1,40}) \| (.+)$/.exec(fields.Project||'');
    if(!project)fail(`Markdown 条目 ${i+1}.Project`,'格式为 id | 项目名');
    if(projects.has(project[1])&&projects.get(project[1]).name!==project[2])fail('Project','同 ID 项目名称冲突');
    projects.set(project[1],{id:project[1],name:project[2],aliases:[]});
    const body=lines.slice(at+1).join('\n').replace(/\n+$/,''),parts=body.split('\n### Detailed\n');
    if(parts.length>2)fail(`Markdown 条目 ${i+1}`,'重复 ### Detailed');
    let aliases,meta;try{aliases=JSON.parse(fields.Aliases||'[]');meta=JSON.parse(fields.Meta||'{}');}catch{fail(`Markdown 条目 ${i+1}`,'Aliases/Meta 必须是有效 JSON');}
    items.push({...meta,id,projectId:project[1],question:fields.Q,aliases,answerShort:parts[0],...(parts.length===2?{answerDetailed:parts[1]}:{})});
  }
  const index=compile(JSON.stringify({format:'cue-qa/v1',projects:[...projects.values()],items}));
  const contentSha256=sha(raw),sourcePath=`qa/import-${contentSha256}.md`;
  for(const c of index.cards){c.path=sourcePath;c.sources=[{path:sourcePath,symbol:c.cardId,commit:null,contentSha256}];}
  index.sourceDocuments={[sourcePath]:raw};return validateIndex(index);
}
module.exports = { compile, compileMarkdown, exportQA };
