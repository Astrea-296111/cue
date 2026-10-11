'use strict';

const GENERIC = /^(?:src|source|docs?|backend|frontend|server|client|app|apps|packages|services|test|tests|lib|config|public|examples|scripts|resources)$/i;
const MANIFEST = /^(?:readme(?:\.[^/]+)?|package\.json|pom\.xml|go\.mod|pyproject\.toml|cargo\.toml)$/i;

function aliases(name) {
  return [...new Set([String(name || ''), String(name || '').replace(/(?:-main|-master|\.zip)$/i, '')])]
    .map(x => x.trim()).filter(s => s.length >= 2);
}

function buildProjectCatalog(index) {
  if (Array.isArray(index?.projects) && index.projects.length) {
    return index.projects.map(project => ({
      name: project.name || project.sourceName || 'Project',
      prefix: `@project:${project.id}`,
      projectId: project.id,
      aliases: aliases(project.name || project.sourceName || '')
    }));
  }

  const found = new Map();
  for (const chunk of index?.chunks || []) {
    const parts = String(chunk.path || '').replace(/\\/g, '/').split('/');
    if (parts.length < 2 || parts.length > 3 || !MANIFEST.test(parts.at(-1))) continue;
    const name = parts.at(-2);
    if (GENERIC.test(name) || GENERIC.test(parts[0])) continue;
    const prefix = parts.slice(0, -1).join('/') + '/';
    found.set(prefix, { name, prefix, aliases: aliases(name) });
  }
  const projects = [...found.values()].filter(p => ![...found.keys()].some(prefix => prefix !== p.prefix && p.prefix.startsWith(prefix)));
  if (projects.length) return projects;
  const name = String(index?.sourceName || '').replace(/\.zip$/i, '');
  return name ? [{ name, prefix: '', aliases: aliases(name) }] : [];
}

function inProjectScope(chunk, scopes) {
  if (!Array.isArray(scopes) || !scopes.length) return true;
  const filePath = String(chunk.path || '').replace(/\\/g, '/');
  return scopes.some(scope => {
    const value = String(scope || '');
    if (value.startsWith('@project:')) return String(chunk.projectId || '') === value.slice('@project:'.length);
    return value === '' || filePath.startsWith(value);
  });
}

module.exports = { buildProjectCatalog, inProjectScope, aliases };
