'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parseFrontMatter, markdownSections } = require('../src/project-document-parser');
const { parseProjectManifest } = require('../src/project-pack-manifest');
const { chunkText } = require('../src/project-chunks');
const { buildSourceProjectProfile } = require('../src/project-profile');

function runtime(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-typed-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, '../src/project-knowledge.js');
  const native = createRequire(filename), module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })
    (name => name === 'electron' ? { app: { getPath: () => dir } } : native(name), module, module.exports, filename, path.dirname(filename));
  return { knowledge: module.exports, dir };
}
function manifest(id = 'project-a', name = '项目甲', order = 1, extra = '') {
  return `---\nschema_version: 1\nproject_id: ${id}\nproject_name: "${name}"\nresume_order: ${order}\nsource_revision: snapshot-1\naliases: ["缓存项目", "Cache Project"]\n${extra}---\n# 项目背景\n这是用户填写的项目背景资料，不证明本人贡献或任何测试收益。\n`;
}
function folder(root, name, files) {
  const result = path.join(root, name); fs.mkdirSync(result, { recursive: true });
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(result, file)), { recursive: true }); fs.writeFileSync(path.join(result, file), text); }
  return result;
}
function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.from(value), bytes = Buffer.from(name), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(bytes.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(bytes.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, bytes, data); central.push(entry, bytes); offset += 30 + bytes.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('bounded front matter supports inline and indentless lists, whitelists fields and retains body offsets', () => {
  const source = '\uFEFF---\r\nschema_version: 1\r\nproject_id: project-a\r\ndoc_type: decision\r\ntruth_scope: implemented\r\nstatus: confirmed\r\ntopics: [缓存, "一致性"]\r\ncode_refs:\r\n- path: src/CacheService.java\r\n  symbol: CacheService#update\r\nrelated_docs:\r\n- interview/performance.md\r\nunknown_rule: "执行任意代码"\r\n---\r\n# 缓存决策\r\n如果节点断开，需按条件讨论。\r\n';
  const parsed = parseFrontMatter(source);
  assert.equal(parsed.valid, true); assert.deepEqual(parsed.metadata.topics, ['缓存', '一致性']);
  assert.deepEqual(parsed.metadata.code_refs, [{ path: 'src/CacheService.java', symbol: 'CacheService#update' }]);
  assert.equal(parsed.metadata.unknown_rule, undefined); assert.equal(parsed.body, source.slice(parsed.bodyOffset));
  assert.match(parsed.body, /如果节点断开/);
  for (const chunk of chunkText('interview/cache.md', source)) {
    assert.equal(chunk.text, source.slice(chunk.startOffset, chunk.endOffset));
    assert.equal(chunk.docType, 'decision'); assert.equal(chunk.status, 'confirmed'); assert.equal(chunk.offsetEncoding, 'utf16');
    if (chunk.text.includes('如果节点断开')) assert.equal(chunk.truthScope, 'unverified', '声明不得把条件句升级为已实现');
    assert.doesNotMatch(chunk.text, /unknown_rule|schema_version/);
  }
});

test('malformed, aliased, tagged and oversized YAML falls back to raw body without trusted metadata', () => {
  for (const raw of ['topics: &alias [缓存]\naliases: *alias', 'doc_type: !!js/function function(){}', 'topics: [unfinished', 'doc_type: decision\ndoc_type: ownership', 'aliases: [' + 'a,'.repeat(70) + 'a]', 'title: ' + 'a'.repeat(25000)]) {
    const parsed = parseFrontMatter('---\n' + raw + '\n---\n# 原始资料\n真实正文仍可以检索。');
    assert.equal(parsed.valid, false, raw.slice(0, 100)); assert.equal(parsed.metadata.truth_scope, 'unverified');
    assert.match(parsed.body, /真实正文/); assert.ok(parsed.warnings.length);
  }
});

test('Markdown H1–H6 tree survives mixed fences and a story parent retains its verification tail', () => {
  const source = '# 项目\n## 故障排查\n背景：任务失败。\n### 我的行动\n逐项检查。\n````java\n# 假标题\n```\n````\n#### 验证\n重试后检查实际结果。\n';
  const parsed = parseFrontMatter(source), sections = markdownSections(parsed, 'story.md'), chunks = chunkText('story.md', source);
  assert.deepEqual(sections.find(section => section.title === '验证').headingPath, ['项目', '故障排查', '我的行动', '验证']);
  assert.equal(sections.some(section => section.title === '假标题'), false);
  const action = chunks.find(chunk => chunk.symbol === '我的行动'); assert.deepEqual(action.headingPath, ['项目', '故障排查', '我的行动']);
  const parent = chunks.parents.find(item => item.id === action.parentId); assert.match(parent.text, /重试后检查实际结果/);
  assert.equal(parent.text, source.slice(parent.startOffset, parent.endOffset));
});

test('long single lines and split functions have accurate offsets, unique children and complete parent source', () => {
  const source = 'const 内容 = "' + '中文'.repeat(4000) + '"; // 最后关键结果';
  const chunks = chunkText('minified.unknown', source);
  assert.ok(chunks.length > 3); assert.equal(new Set(chunks.map(chunk => chunk.id)).size, chunks.length);
  assert.equal(chunks.map(chunk => chunk.text).join(''), source);
  for (const chunk of chunks) assert.equal(chunk.text, source.slice(chunk.startOffset, chunk.endOffset));
  assert.equal(chunks.parents[0].text, source); assert.equal(chunks.at(-1).endOffset, source.length);
  const method = 'class CacheService {\n  public int update() {\n' + '    int value = 1;\n'.repeat(300) + '    return 42;\n  }\n}';
  const functions = chunkText('src/CacheService.java', method), child = functions.find(chunk => chunk.symbol === 'CacheService#update');
  const parent = functions.parents.find(item => item.id === child.parentId); assert.match(parent.text, /return 42/);
  assert.equal(parent.text, method.slice(parent.startOffset, parent.endOffset));
});

test('multiline Java record declarations resolve real class anchors beyond a six-line header', () => {
  const source = 'package sample;\npublic record Metric(\n' + Array.from({ length: 12 }, (_, index) => `  String component${index}${index < 11 ? ',' : ''}`).join('\n') + ') {\n  public Metric {\n    if (component0 == null) throw new IllegalArgumentException("invalid");\n  }\n}';
  const chunks = chunkText('src/Metric.java', source);
  const declaration = chunks.find(chunk => chunk.symbol === 'Metric' && /public record Metric/.test(chunk.text));
  assert.ok(declaration); assert.equal(declaration.kind, 'class'); assert.equal(declaration.parserKind, 'lexical');
  assert.equal(declaration.text, source.slice(declaration.startOffset, declaration.endOffset)); assert.match(declaration.text, /IllegalArgumentException/);
});

test('manifest identity updates across folder, renamed folder and GitHub-style ZIP without duplicate projects', async t => {
  const { knowledge, dir } = runtime(t);
  const files = { 'interview/project.md': manifest(), 'src/CacheService.java': 'class CacheService {\n  public int update() {\n    return 42;\n  }\n}' };
  const first = folder(dir, 'first-name', files); await knowledge.importProjectFolder(first);
  const renamed = folder(dir, 'renamed-directory', { ...files, 'interview/project.md': manifest('project-a', '新项目名称') });
  const renamedState = await knowledge.importProjectFolder(renamed);
  assert.equal(renamedState.projectCount, 1); assert.equal(renamedState.projects[0].id, 'project-a');
  assert.equal(renamedState.projects[0].name, '新项目名称'); assert.equal(renamedState.importReport.updatedProject.previousName, '项目甲');
  const zipFile = path.join(dir, 'snapshot.zip'); fs.writeFileSync(zipFile, zip(Object.fromEntries(Object.entries(files).map(([file, text]) => ['repo-sha/' + file, text]))));
  const final = await knowledge.importProjectZip(zipFile);
  assert.equal(final.projectCount, 1); assert.equal(final.projects[0].id, 'project-a'); assert.equal(final.projects[0].resumeOrder, 1);
  assert.deepEqual(final.projects[0].aliases, ['缓存项目', 'Cache Project']); assert.equal(final.projects[0].sourceRevision, 'snapshot-1');
  const snapshot = knowledge.getProjectIndexSnapshot(); assert.ok(snapshot.chunks.every(chunk => chunk.id.startsWith('project-a:')));
  assert.ok(snapshot.projects[0].parents.every(parent => parent.projectId === 'project-a'));
});

test('duplicate manifest ordinal rejects import and preserves the complete previous snapshot', async t => {
  const { knowledge, dir } = runtime(t);
  await knowledge.importProjectFolder(folder(dir, 'a', { 'interview/project.md': manifest() }));
  const revision = knowledge.getProjectIndexRevision();
  await assert.rejects(knowledge.importProjectFolder(folder(dir, 'b', { 'interview/project.md': manifest('project-b', '项目乙') })), /顺序冲突/);
  assert.equal(knowledge.getProjectIndexRevision(), revision); assert.equal(knowledge.getProjectIndexState().projectCount, 1);
});

test('complete source parent is restored only when the shared budget can fit its verification and return tail', async t => {
  const { knowledge, dir } = runtime(t);
  const source = 'class LargeService {\n  public int calculate() {\n' + '    int value = 1;\n'.repeat(300) + '    return 99; // 已验证的尾部\n  }\n}';
  await knowledge.importProjectFolder(folder(dir, 'large', { 'interview/project.md': manifest(), 'src/LargeService.java': source }));
  const { chunks, revision } = knowledge.getProjectIndexSnapshot(), first = chunks.find(chunk => chunk.symbol === 'LargeService#calculate');
  assert.equal(first.partial, true); assert.doesNotMatch(first.text, /return 99/);
  assert.deepEqual(knowledge.getProjectParentEvidence([first], { scopes: ['@project:project-a'], revision, maxChars: 1000 }), []);
  const parents = knowledge.getProjectParentEvidence([first], { scopes: ['@project:project-a'], revision, maxChars: 8000 });
  assert.equal(parents.length, 1); assert.equal(parents[0].partial, false); assert.equal(parents[0].fullParent, true); assert.match(parents[0].text, /return 99/);
  assert.equal(parents[0].text, source.slice(parents[0].startOffset, parents[0].endOffset));
  assert.deepEqual(knowledge.getProjectParentEvidence([first], { scopes: ['@project:other'], revision, maxChars: 8000 }), []);
});

test('code references resolve actual snapshot symbols, retain missing/overload/revision diagnostics and bound scoped expansion', async t => {
  const { knowledge, dir } = runtime(t);
  const card = '---\nproject_id: project-a\ndoc_type: decision\ntruth_scope: implemented\nstatus: confirmed\ncode_refs:\n- path: src/CacheService.java\n  symbol: CacheService#update\n- path: src/Overloaded.java\n  symbol: Overloaded#run\n- path: src/Missing.java\n  symbol: Missing#run\n- path: src/CacheService.java\n  symbol: CacheService\nrelated_docs: [interview/performance.md, ../other/secret.md]\n---\n# 缓存取舍\n选择短缓存，需要版本检查。\n';
  await knowledge.importProjectFolder(folder(dir, 'project', {
    'interview/project.md': manifest(), 'interview/decision.md': card,
    'interview/performance.md': '# 测试环境与单位\n仅 Mock 环境：单位 ms；不代表历史生产收益。',
    'src/CacheService.java': 'class CacheService {\n  private ResultRepository resultRepository;\n  public int update() {\n    return resultRepository.lookup();\n  }\n}',
    'src/ResultRepository.java': 'class ResultRepository {\n  public int lookup() {\n    return 42;\n  }\n}',
    'src/Overloaded.java': 'class Overloaded {\n  public void run() {}\n  public void run(int value) {}\n}'
  }));
  const { chunks, revision } = knowledge.getProjectIndexSnapshot(), decision = chunks.find(chunk => chunk.path === 'interview/decision.md');
  assert.equal(decision.codeRefs[0].status, 'resolved'); assert.equal(decision.codeRefs[0].startLine, 3);
  assert.equal(decision.codeRefs[1].status, 'ambiguous'); assert.equal(decision.codeRefs[1].startLine, undefined);
  assert.equal(decision.codeRefs[2].status, 'unresolved'); assert.equal(decision.codeRefs[2].startLine, undefined);
  assert.equal(decision.codeRefs[3].status, 'resolved', '多个class上下文片段不冒充类名重载');
  assert.deepEqual(decision.relatedDocs.map(ref => ref.path), ['interview/performance.md']);
  const related = knowledge.getRelatedProjectEvidence([decision], { scopes: ['@project:project-a'], revision, limit: 6 });
  assert.ok(related.some(item => item.symbol === 'CacheService#update')); assert.ok(related.some(item => item.path === 'interview/performance.md'));
  assert.ok(related.some(item => item.symbol === 'ResultRepository#lookup'), '声明的源码引用继续展开真实正向调用');
  assert.ok(related.length <= 6 && related.every(item => item.projectId === 'project-a'));
  assert.deepEqual(knowledge.getRelatedProjectEvidence([decision], { scopes: ['@project:other'], revision }), []);
  const revisedCard = card.replace('doc_type: decision', 'source_revision: older-snapshot\ndoc_type: decision');
  fs.writeFileSync(path.join(dir, 'project/interview/decision.md'), revisedCard); await knowledge.importProjectFolder(path.join(dir, 'project'));
  const stale = knowledge.getProjectIndexSnapshot().chunks.find(chunk => chunk.path === 'interview/decision.md');
  assert.equal(stale.codeRefs[0].reason, 'revision-mismatch'); assert.equal(stale.codeRefs[0].startLine, undefined);
});

test('manifest excludes cannot admit secrets, cross-project cards, traversal or symlinks', async t => {
  const { knowledge, dir } = runtime(t);
  const root = folder(dir, 'safe', {
    'interview/project.md': manifest('project-a', '项目甲', 1, 'exclude_paths: [docs/archive]\n'),
    '.env': 'MY_PRIVATE_KEY=never-index-this-value-but-long-enough',
    'docs/archive/old.md': '# 旧设计\n这份旧设计被清单明确排除，不能混入事实。',
    'interview/wrong.md': '---\nproject_id: project-b\n---\n# 另一项目\n另一项目事实不允许放入项目甲证据范围。'
  });
  fs.symlinkSync(path.join(root, '.env'), path.join(root, 'linked.md'));
  const state = await knowledge.importProjectFolder(root), paths = knowledge.getProjectIndexSnapshot().chunks.map(chunk => chunk.path);
  assert.deepEqual(paths, ['interview/project.md']); assert.ok(state.importReport.warnings.some(warning => warning.includes('project_id=project-b')));
  const archive = path.join(dir, 'unsafe.zip'); fs.writeFileSync(archive, zip({ 'interview/project.md': manifest(), '../evil.md': '# 不得进入\n路径遍历文本不得进入项目索引。', '/absolute.md': '# 不得进入\n绝对路径文本不得进入项目索引。' }));
  await knowledge.importProjectZip(archive);
  assert.deepEqual(knowledge.getProjectIndexSnapshot().chunks.map(chunk => chunk.path), ['interview/project.md']);
});

test('profile finds typed ownership and performance beyond chunk 1200 and ignores source code as authorship proof', () => {
  const chunks = Array.from({ length: 1300 }, (_, i) => ({ path: `src/${i}.java`, startLine: 1, endLine: 1, text: 'public class Service { /* 实现 */ }', docType: 'implementation', truthScope: 'implemented' }));
  chunks.push({ id: 'ownership-card', path: 'interview/ownership.md', startLine: 8, text: '本人贡献待核对，公开源码不能证明本人主写。', docType: 'ownership', truthScope: 'unverified', status: 'draft' },
    { id: 'performance-card', path: 'interview/performance.md', startLine: 4, text: 'Mock 环境；单机 Docker；延迟单位 ms；仅 test_only 数据。', docType: 'performance', truthScope: 'test_only', status: 'confirmed' });
  const profile = buildSourceProjectProfile('项目甲', chunks);
  assert.equal(profile.cards.find(card => card.key === 'responsibility').evidence[0].id, 'ownership-card');
  assert.equal(profile.cards.find(card => card.key === 'performance').evidence[0].id, 'performance-card');
  assert.ok(profile.cards.find(card => card.key === 'responsibility').evidence.every(item => item.docType === 'ownership'));
});

test('formatted evidence uses typed, bounded, verbatim source blocks rather than a universal priority rule', t => {
  const { knowledge } = runtime(t);
  const evidence = { id: 'project-a:evidence', projectId: 'project-a', projectName: '项目甲', path: 'interview/ownership.md', startLine: 3, endLine: 3, startOffset: 20, endOffset: 42,
    text: '本人主写模块尚未确认。', docType: 'ownership', truthScope: 'unverified', status: 'draft', projectRevision: 'snapshot-1' };
  const output = knowledge.formatRetrievedProjectContext([evidence]);
  assert.match(output, /type=ownership truth=unverified status=draft/); assert.doesNotMatch(output, /最高优先级/);
  assert.ok(output.includes('--- 来源 project-a:evidence 开始 ---\n' + evidence.text + '\n--- 来源 project-a:evidence 结束 ---'));
  assert.equal(knowledge.formatRetrievedProjectContext([{ ...evidence, text: 'x'.repeat(500) }], { maxChars: 400 }), '');
  assert.equal(parseProjectManifest('---\nproject_id: bad\n---\n# 正文').manifest, null);
});
