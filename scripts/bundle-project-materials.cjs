#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {makeBundle, emptyFacts, emptySources, MAX_RESUME_BYTES} = require('../src/bundled-materials');
const {combinePacks} = require('../src/project-material-service');
const {parseProjectManifest} = require('../src/project-pack-manifest');

function relative(value) {
  return typeof value === 'string' && !!value && !/^(?:[A-Za-z]:|[/\\])/.test(value) && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
}
function controlledFile(root, record, maxBytes) {
  if (!record || !relative(record.path) || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) throw new Error('材料白名单必须包含安全相对路径和 sha256');
  const rootReal = fs.realpathSync(root), target = path.join(rootReal, record.path);
  let current = rootReal;
  for (const part of record.path.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('材料白名单不接受符号链接：' + record.path); }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.size > maxBytes || !fs.realpathSync(target).startsWith(rootReal + path.sep)) throw new Error('材料文件无效、越界或过大：' + record.path);
  const bytes = fs.readFileSync(target);
  // hash() strings are UTF-8; file allowlists cover the original bytes, including PDF/DOCX.
  const actual = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if (actual !== record.sha256) throw new Error('材料白名单摘要不匹配：' + record.path);
  return bytes;
}
async function buildBundleFile({manifestPath=path.join(__dirname, '../materials/manifest.json'), outputPath=path.join(__dirname, '../materials/bundle.json')}={}) {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error('材料清单无效或过大');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')), root = path.dirname(path.resolve(manifestPath));
  if (manifest.schemaVersion !== 1 || manifest.approvedForDistribution !== true) throw new Error('发布材料必须在 manifest.json 明确 approvedForDistribution: true');
  if (Object.keys(manifest).some(key => !['schemaVersion','approvedForDistribution','facts','sources','profile'].includes(key)) || !Array.isArray(manifest.facts) || manifest.facts.length > 16 || !Array.isArray(manifest.sources) || manifest.sources.length > 12) throw new Error('材料清单结构或数量无效');
  const packs = manifest.facts.map(record => JSON.parse(controlledFile(root, record, 2 * 1024 * 1024).toString('utf8')));
  const combined = combinePacks(packs);
  if (combined.conflicts.length) throw new Error('多份打包事实存在冲突：' + combined.conflicts.map(item => item.key).join(', '));
  const profile = {};
  if (manifest.profile != null) {
    if (!/\.(?:md|txt)$/i.test(manifest.profile.path || '')) throw new Error('发布简历须先核验并转换为 Markdown 或纯文本');
    profile.resumeText = controlledFile(root, manifest.profile, MAX_RESUME_BYTES).toString('utf8');
  }
  let sources = emptySources();
  if (manifest.sources.length) {
    // prepareOnly + explicit previous use the real importer without Electron storage writes.
    const adapter = require('../src/project-knowledge');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-bundle-'));
    try {
      const seen = new Set(); let totalBytes = 0;
      for (const source of manifest.sources) {
        if (!source || !relative(source.root) || !/^[a-z][a-z0-9-]{1,40}$/.test(source.projectId || '') || seen.has(source.projectId) || !Array.isArray(source.files) || source.files.length < 1 || source.files.length > 1800) throw new Error('源码白名单的 root/projectId/files 无效或重复');
        seen.add(source.projectId);
        if (!source.files.some(record => record.path === 'interview/project.md')) throw new Error('源码白名单必须包含 interview/project.md 项目身份清单');
        const folder = path.join(stage, source.projectId), names = new Set();
        for (const record of source.files) {
          if (!relative(record.path) || names.has(record.path) || !adapter.shouldIndexPath(record.path)) throw new Error('源码白名单路径重复、不支持或可能敏感：' + record.path);
          names.add(record.path);
          const bytes = controlledFile(root, {...record, path:source.root + '/' + record.path}, 8 * 1024 * 1024);
          if (record.path === 'interview/project.md') {
            const parsed = parseProjectManifest(bytes.toString('utf8'));
            if (!parsed.manifest || parsed.manifest.project_id !== source.projectId) throw new Error('源码项目身份与白名单 projectId 不一致：' + source.projectId);
          }
          totalBytes += bytes.length;
          if (totalBytes > 16 * 1024 * 1024) throw new Error('打包源码原文超过 16MiB');
          const target = path.join(folder, record.path);
          fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, bytes);
        }
        const prepared = await adapter.scanProjectFolder(folder, {previous:emptySources(), allowEmpty:false});
        if (prepared.projects.length !== 1 || prepared.projects[0].id !== source.projectId || !prepared.projects[0].hasManifest) throw new Error('源码项目身份与白名单 projectId 不一致：' + source.projectId);
        const indexed = new Set(prepared.chunks.map(chunk => chunk.path));
        if ([...names].some(name => !indexed.has(name)) || prepared.projects[0].stats.truncatedCount > 0) throw new Error('源码白名单包含无法索引或被截断的文件：' + source.projectId);
        sources.projects.push(...prepared.projects); sources.chunks.push(...prepared.chunks);
      }
      sources.stats = {fileCount:new Set(sources.chunks.map(chunk => chunk.projectId + '/' + chunk.path)).size, chunkCount:sources.chunks.length};
    } finally { fs.rmSync(stage, {recursive:true, force:true}); }
  }
  const bundle = makeBundle({facts:combined.index || emptyFacts(), sources, profile});
  fs.mkdirSync(path.dirname(outputPath), {recursive:true});
  const temp = outputPath + '.tmp-' + randomUUID();
  try { fs.writeFileSync(temp, JSON.stringify(bundle, null, 2) + '\n', {mode:0o600}); fs.renameSync(temp, outputPath); }
  finally { fs.rmSync(temp, {force:true}); }
  return bundle;
}
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--manifest','--output'].includes(args[i]) || !args[i+1]) { process.stderr.write('用法：node scripts/bundle-project-materials.cjs [--manifest materials/manifest.json] [--output materials/bundle.json]\n'); process.exit(2); }
    options[args[i] === '--manifest' ? 'manifestPath' : 'outputPath'] = args[i+1];
  }
  buildBundleFile(options).then(bundle => process.stdout.write(`材料已编译：${bundle.revision}，${bundle.facts.cards.length} 事实，${bundle.sources.chunks.length} 源码片段\n`)).catch(error => { process.stderr.write('材料编译失败：' + error.message + '\n'); process.exitCode = 1; });
}
module.exports = {buildBundleFile, controlledFile};
