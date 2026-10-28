'use strict';
const fs = require('fs');
const { compile, compileMarkdown, exportQA } = require('./qa-import');
const { validateIndex, MAX_FACT_BYTES, migrateFactIndex } = require('./project-fact-packs');
function parse(raw) {
  if (Buffer.byteLength(raw) > MAX_FACT_BYTES) throw new Error('问答文件超过 16MiB');
  if(raw.replace(/^\uFEFF/,'').startsWith('# CUE-QA/v1'))return compileMarkdown(raw);
  const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  return value.format === 'cue-qa/v1' ? compile(raw) : validateIndex(value);
}
async function prepare(service, { filePath, text } = {}) {
  let raw = text;
  if (filePath) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FACT_BYTES) throw new Error('问答文件无效或超过 16MiB');
    const bytes=fs.readFileSync(filePath);raw=bytes.toString('utf8');
    if(!bytes.equals(Buffer.from(raw,'utf8')))throw new Error('问答文件需要有效 UTF-8 编码');
  }
  if (typeof raw !== 'string') throw new Error('请选择 JSON 或输入问答正文');
  const index = parse(raw), preview = await service.prepareImport({ index, mode: 'merge' });
  return { ...preview, fileName: filePath ? require('path').basename(filePath) : '编辑器内容', qaProjects:index.projects.map(p=>({id:p.id,name:p.name})), qaSummary: index.cards.map(c => ({ id: c.cardId, question: c.questions?.[0], projectId: c.projectId, answerShort:c.answerShort, answerDetailed:c.qa?.answerDetailed||'',
    shortChars: [...(c.answerShort || c.text)].length, warning: [...(c.answerShort || c.text)].length > 260 ? '短答超过 260 字，将完整展示；建议编辑精简' : '' })) };
}
async function edit(service, { cardId, item, enabled, remove, baseGeneration }) {
  if (baseGeneration !== service.snapshot.generation) throw new Error('材料已变化，请刷新后编辑');
  const index = migrateFactIndex(service.snapshot.facts), card = index.cards.find(c => c.cardId === cardId);
  if (!card) throw new Error('问答条目不存在');
  if (remove) {
    index.cards = index.cards.filter(c => c.cardId !== cardId);
    for (const c of index.cards) c.related = c.related.filter(id => id !== cardId);
  } else if (item) {
    if (item.id !== cardId || item.projectId !== card.projectId) throw new Error('编辑不能改变条目 ID 或项目归属');
    const updated = compile(JSON.stringify({format:'cue-qa/v1',projects:index.projects.filter(p => p.id === card.projectId),items:[item]}));
    index.cards[index.cards.indexOf(card)] = updated.cards[0];
    Object.assign(index.sourceDocuments ||= {}, updated.sourceDocuments);
  } else {
    if (typeof enabled !== 'boolean') throw new Error('需要启用/停用操作');
    card.qa = { enabled, delivery: card.qa?.delivery || 'prefer_verbatim', answerDetailed: card.qa?.answerDetailed || card.deepPoints.join('\n\n'), mustCover: card.qa?.mustCover || [], excludeIntents: card.qa?.excludeIntents || [] };
  }
  const preview = await service.prepareImport({ index: validateIndex(index), mode: 'replace-all' });
  return service.commitImport(preview);
}
function state(service) {
  return { generation: service.snapshot.generation, revision: service.snapshot.factRevision,
    library: exportQA(migrateFactIndex(service.snapshot.facts)) };
}
module.exports = { parse, prepare, edit, state };
