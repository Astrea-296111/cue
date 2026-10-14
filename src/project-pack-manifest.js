'use strict';
const { parseFrontMatter, relativePath } = require('./project-document-parser');
const MANIFEST_PATH = 'interview/project.md';

function parseProjectManifest(text) {
  const parsed = parseFrontMatter(text), value = parsed.metadata;
  const warnings = [...parsed.warnings];
  if (!parsed.valid || value.schema_version !== 1 || typeof value.project_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value.project_id) || typeof value.project_name !== 'string' || !value.project_name.trim()) {
    warnings.push('项目清单缺少有效 schema_version、project_id 或 project_name；沿用旧项目身份');
    return { manifest: null, warnings };
  }
  let order = value.resume_order;
  if (order != null && (!Number.isInteger(order) || order < 1 || order > 99)) { warnings.push('resume_order 无效，未设置简历顺序'); order = null; }
  return { manifest: { schema_version: 1, project_id: value.project_id, project_name: value.project_name.trim().slice(0, 180), resume_order: order ?? null,
    aliases: value.aliases, source_revision: typeof value.source_revision === 'string' ? value.source_revision.slice(0, 160) : '',
    code_roots: value.code_roots, exclude_paths: value.exclude_paths }, warnings };
}
function excludedByManifest(filePath, manifest) {
  const safe = relativePath(filePath);
  return !!safe && (manifest?.exclude_paths || []).some(prefix => safe === prefix || safe.startsWith(prefix + '/'));
}
function applyProjectManifest(project, parsed) {
  project.importReport = { warnings: [...(parsed?.warnings || [])], manifestPath: parsed ? MANIFEST_PATH : null };
  if (!parsed?.manifest) return;
  const manifest = parsed.manifest;
  Object.assign(project, { id: manifest.project_id, name: manifest.project_name, aliases: manifest.aliases, resumeOrder: manifest.resume_order,
    sourceRevision: manifest.source_revision, hasManifest: true, manifest, manifestPath: MANIFEST_PATH });
}
module.exports = { MANIFEST_PATH, parseProjectManifest, excludedByManifest, applyProjectManifest };
