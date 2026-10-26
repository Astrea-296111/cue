'use strict';

const { inProjectScope } = require('./project-scope');
const { tokenize } = require('./project-search');
const { maskCode } = require('./project-chunks');

const SCHEMA_VERSION = 3;
const GENERIC_ROOT = /^(?:src|source|docs?|backend|frontend|server|client|app|apps|packages|services|test|tests|lib|config|public|resources)$/i;
const GENERIC_BUSINESS_TERM = /^(?:流程|实现|在哪|哪里|怎么|如何|这个|那个|方法|代码|功能|服务|系统|业务|接口|项目|创建流|建流程|的流程)$/;
const simpleType = value => String(value || '').replace(/<[^>]*>/g, '').replace(/\[\]/g, '').trim().split('.').at(-1);
const folded = value => String(value || '').normalize('NFKC').toLowerCase();
function projectKey(chunk) {
  if (chunk.projectId) return '@project:' + chunk.projectId;
  const root = String(chunk.path || '').replace(/\\/g, '/').split('/')[0];
  return root && !GENERIC_ROOT.test(root) ? 'legacy:' + root : 'legacy:root';
}
const key = (project, value) => project + '\n' + value;
const sourceId = chunk => chunk.id || `${projectKey(chunk)}:${chunk.path}:${chunk.startOffset ?? chunk.startLine}:${chunk.endOffset ?? chunk.endLine}:${chunk.symbol || ''}`;
function append(map, mapKey, value) {
  let values = map.get(mapKey);
  if (!values) map.set(mapKey, values = []);
  values.push(value);
}

// Runtime-only maps. Build once for an index revision; query/expansion use these
// maps rather than rescanning the workspace. Old chunks without metadata remain
// searchable, but are not silently promoted into a fabricated call graph.
function buildProjectCodeRelations(chunks = []) {
  const graph = { version: SCHEMA_VERSION, chunks, byFile: new Map(), bySymbol: new Map(),
    classes: new Map(), classNames: new Map(), edges: new Map(), mappings: [], mappingTerms: new Map(),
    chunkIds: new Map(), diagnostics: [] };
  const symbolAliases = new Map();
  const stableIds = new Map(chunks.flatMap((chunk, id) => chunk.id ? [[chunk.id, id]] : []));
  chunks.forEach((chunk, id) => {
    graph.chunkIds.set(chunk, id);
    const project = projectKey(chunk);
    append(graph.byFile, key(project, chunk.path), id);
    if (chunk.symbol) {
      append(graph.bySymbol, key(project, folded(chunk.symbol)), id);
      append(symbolAliases, key(project, folded(chunk.symbol)), id);
      append(symbolAliases, key(project, folded(chunk.symbol).replace('#', '.')), id);
    }
    const parentClass = chunk.parentClass || (String(chunk.symbol || '').includes('#') ? chunk.symbol.split('#')[0]
      : chunk.kind === 'class' ? chunk.symbol : '');
    if (!parentClass) return;
    const classKey = key(project, chunk.path + '\n' + parentClass);
    let record = graph.classes.get(classKey);
    if (!record) {
      record = { project, path: chunk.path, name: parentClass, packageName: chunk.packageName || '',
        ids: [], declarations: [], methods: new Map(), extends: [], role: chunk.role || 'unknown' };
      graph.classes.set(classKey, record);
      append(graph.classNames, key(project, simpleType(parentClass)), record);
    }
    record.ids.push(id);
    if (chunk.packageName) record.packageName = chunk.packageName;
    if (chunk.role && chunk.role !== 'unknown') record.role = chunk.role;
    record.extends = [...new Set([...record.extends, ...(Array.isArray(chunk.extends) ? chunk.extends : [])])];
    const declared = new RegExp(`\\b(?:class|interface|record|enum)\\s+${parentClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(chunk.text || '');
    if (declared) record.declarations.push(id);
    const method = chunk.method || (String(chunk.symbol || '').includes('#') ? chunk.symbol.split('#').at(-1) : '');
    if (method) append(record.methods, method, id);
  });

  // Import-time front matter references are resolved against the same immutable
  // project snapshot. Reuse the graph for document→code→forward-call expansion;
  // unresolved/ambiguous declarations never become edges to guessed symbols.
  chunks.forEach((chunk, id) => {
    for (const ref of [...(chunk.codeRefs || []), ...(chunk.relatedDocs || [])]) {
      if (ref.status !== 'resolved') continue;
      for (const stableId of (ref.targetIds || []).slice(0, 6)) {
        const targetId = stableIds.get(stableId), target = chunks[targetId];
        if (!target || projectKey(target) !== projectKey(chunk) || target.path !== ref.path) continue;
        append(graph.edges, id, { status: 'resolved', reason: 'declared-project-reference', targetId,
          fromSymbol: chunk.symbol || '', toSymbol: target.symbol || target.path,
          sourcePath: chunk.path, ...(Number.isInteger(ref.sourceLine) ? { sourceLine: ref.sourceLine } : {}),
          targetPath: target.path, targetLine: target.startLine, projectId: chunk.projectId || '' });
      }
    }
  });
  for (const record of graph.classes.values()) {
    // Class names are query aliases only if a source declaration exists.
    const ids = record.declarations;
    if (ids.length) append(symbolAliases, key(record.project, folded(record.name)), ids[0]);
  }

  function resolveType(chunk, type) {
    const project = projectKey(chunk), name = simpleType(type);
    let records = graph.classNames.get(key(project, name)) || [];
    const cleanType = String(type || '').replace(/<[^>]*>/g, '').replace(/\[\]/g, '').trim();
    const imports = (Array.isArray(chunk.imports) ? chunk.imports : []).filter(value => String(value).split('.').at(-1) === name);
    const qualified = cleanType.includes('.') ? [cleanType] : imports;
    if (qualified.length) records = records.filter(record => qualified.includes(`${record.packageName ? record.packageName + '.' : ''}${record.name}`));
    return records;
  }

  const seenCalls = new Set();
  chunks.forEach((chunk, id) => {
    for (const call of Array.isArray(chunk.calls) ? chunk.calls : []) {
      if (!call || typeof call.method !== 'string' || !Number.isInteger(call.line) || call.line < chunk.startLine || call.line > chunk.endLine) continue;
      const receiver = String(call.receiver || '').replace(/^this\./, '');
      const localShadow = !call.explicitThis && (call.shadowed || Object.hasOwn(chunk.localTypes || {}, receiver));
      const type = ['this','self'].includes(receiver) ? chunk.parentClass
        : localShadow ? ''
          : chunk.fieldTypes?.[receiver] || (/^[A-Z][A-Za-z0-9_$]*$/.test(receiver) ? receiver : '');
      const edge = { status: 'unresolved', fromSymbol: chunk.symbol || chunk.parentClass || '',
        receiver: call.receiver || '', method: call.method, sourcePath: chunk.path, sourceLine: call.line,
        projectId: chunk.projectId || '', reason: localShadow ? 'receiver-shadowed' : type ? 'target-method-unresolved' : 'receiver-type-unresolved' };
      const records = type ? resolveType(chunk, type) : [];
      if (call.bare) {
        const targetPath = call.targetPath || chunk.path, symbol = call.targetSymbol || call.method;
        const targets = !call.shadowed ? (graph.byFile.get(key(projectKey(chunk), targetPath)) || [])
          .filter(targetId => {
            const target = chunks[targetId];
            return target.language === 'python' && !target.parentClass && target.symbol === symbol &&
              new RegExp(`^(?:async\\s+)?def\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'm').test(maskCode(target.text, true));
          }) : [];
        const declarations = new Map(targets.map(targetId => [chunks[targetId].declarationLine || chunks[targetId].startLine, targetId]));
        edge.reason = call.shadowed ? 'function-shadowed' : 'function-not-in-index';
        if (declarations.size === 1) {
          const targetId = declarations.values().next().value, target = chunks[targetId];
          Object.assign(edge, { status: 'resolved', reason: call.targetPath ? 'declared-function-import' : 'same-file-function',
            toSymbol: target.symbol, targetPath: target.path, targetLine: target.startLine, targetId });
        } else if (declarations.size > 1) {
          edge.status = 'ambiguous'; edge.reason = 'ambiguous-function-declaration';
        }
      } else if (records.length > 1) {
        edge.status = 'ambiguous'; edge.reason = 'ambiguous-receiver-type';
        edge.candidates = records.map(record => record.path);
      } else if (records.length === 1) {
        const record = records[0];
        const methodIds = record.methods.get(call.method) || [];
        // Oversized method parts are one declaration, not overloaded methods.
        const declarations = new Map();
        for (const targetId of methodIds) {
          const target = chunks[targetId];
          const declaration = target.declarationLine || target.startLine;
          if (!declarations.has(declaration)) declarations.set(declaration, targetId);
        }
        let targetId = declarations.size === 1 ? declarations.values().next().value : undefined;
        if (declarations.size > 1) {
          edge.status = 'ambiguous'; edge.reason = 'overload-unresolved';
          edge.candidates = [...declarations].map(([line]) => record.path + ':' + line);
        } else if (targetId === undefined && record.role === 'repository' && record.extends.some(value => /^(?:JpaRepository|CrudRepository|PagingAndSortingRepository|Repository)$/.test(simpleType(value)))) {
          targetId = record.declarations[0];
          edge.declarationOnly = true;
          edge.inherited = true;
        }
        if (targetId !== undefined) {
          const target = chunks[targetId];
          edge.status = 'resolved'; edge.reason = edge.declarationOnly ? 'inherited-repository-declaration' : 'declared-receiver-call';
          edge.toSymbol = target.symbol || record.name;
          edge.targetPath = target.path; edge.targetLine = target.startLine; edge.targetId = targetId;
        }
      } else if (type) edge.reason = 'receiver-type-not-in-index';
      const identity = `${sourceId(chunk)}:${call.line}:${call.receiver}:${call.method}:${edge.targetId ?? edge.reason}`;
      if (seenCalls.has(identity)) continue;
      seenCalls.add(identity);
      append(graph.edges, id, edge);
      if (edge.status !== 'resolved') graph.diagnostics.push(edge);
    }
  });

  // A Python function may return a module-level table rather than contain the
  // policy itself. Include only explicitly named, unique same-file definitions;
  // local bindings and foreign modules never establish this relationship.
  const declarations = new Map();
  chunks.forEach((chunk, id) => {
    if (chunk.language !== 'python' || chunk.parentClass || chunk.kind !== 'context') return;
    const text = maskCode(chunk.text, true);
    for (const match of text.matchAll(/^([A-Z_][A-Z0-9_]*)\s*(?::[^=\n]+)?\s*=(?!=)/gm)) {
      const name = key(projectKey(chunk), chunk.path + '\n' + match[1]);
      append(declarations, name, id);
    }
  });
  chunks.forEach((chunk, id) => {
    if (chunk.language !== 'python' || !['function', 'method'].includes(chunk.kind)) return;
    const text = maskCode(chunk.text, true), names = new Set(text.match(/\b[A-Z_][A-Z0-9_]*\b/g) || []);
    for (const name of names) {
      if (Object.hasOwn(chunk.localTypes || {}, name)) continue;
      const targets = declarations.get(key(projectKey(chunk), chunk.path + '\n' + name)) || [];
      if (targets.length !== 1) continue;
      const targetId = targets[0], target = chunks[targetId], offset = text.indexOf(name);
      append(graph.edges, id, { status: 'resolved', reason: 'same-file-declaration-reference',
        fromSymbol: chunk.symbol, toSymbol: name, method: name, receiver: '', projectId: chunk.projectId || '',
        sourcePath: chunk.path, sourceLine: chunk.startLine + (text.slice(0, offset).match(/\n/g) || []).length,
        targetPath: target.path, targetLine: target.startLine, targetId });
    }
  });

  // Bilingual business-to-symbol hints are quotations from documentation or a
  // symbol's own adjacent source comment, not translation guesses or LLM claims.
  function addMapping(chunk, text, sourceLine, directSymbol = '') {
    if (!/[\u3400-\u9fff]/.test(text)) return;
    const project = projectKey(chunk);
    const aliases = directSymbol ? [directSymbol] : text.match(/\b[A-Za-z_$][\w$]*(?:[#.][A-Za-z_$][\w$]*)?/g) || [];
    const targets = new Set();
    for (const alias of aliases) {
      for (const id of symbolAliases.get(key(project, folded(alias))) || []) targets.add(id);
    }
    if (!targets.size) return;
    const terms = [...new Set(tokenize(text, true).filter(term => /[\u3400-\u9fff]/.test(term) && !GENERIC_BUSINESS_TERM.test(term)))];
    if (!terms.length) return;
    const mapping = { project, projectId: chunk.projectId || '', sourcePath: chunk.path, sourceLine,
      text: text.slice(0, 600), terms, targetIds: [...targets] };
    const mappingId = graph.mappings.push(mapping) - 1;
    for (const term of terms) append(graph.mappingTerms, term, mappingId);
  }
  chunks.forEach(chunk => {
    if (chunk.description && chunk.symbol) addMapping(chunk, chunk.description, chunk.descriptionLine || chunk.startLine, chunk.symbol);
    if (!/\.(?:mdx?|txt|rst|adoc|pdf|docx)$/i.test(chunk.path || '')) return;
    const lines = String(chunk.text || '').split('\n');
    let block = [], start = 0;
    const flush = () => {
      if (block.length) addMapping(chunk, block.join('\n'), chunk.startLine + start);
      block = [];
    };
    lines.forEach((line, i) => {
      if (!line.trim() || block.length === 6) flush();
      if (line.trim()) { if (!block.length) start = i; block.push(line); }
    });
    flush();
  });
  return graph;
}

function expandProjectCodeQuery(query, graph, options = {}) {
  const scopes = options.scopes || [];
  const terms = new Set(tokenize(query, true).filter(term => /[\u3400-\u9fff]/.test(term) && !GENERIC_BUSINESS_TERM.test(term)));
  const candidates = new Map();
  for (const term of terms) for (const id of graph.mappingTerms.get(term) || []) candidates.set(id, (candidates.get(id) || 0) + 1);
  const mappings = [];
  const symbols = new Set();
  const maxSymbols = Math.max(1, Math.min(12, Number(options.maxSymbols) || 6));
  for (const [id, matches] of [...candidates].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    // A single shared generic word must not attach an unrelated business flow.
    if (matches < 2) continue;
    const mapping = graph.mappings[id];
    const source = { path: mapping.sourcePath, projectId: mapping.projectId };
    if (!inProjectScope(source, scopes)) continue;
    const own = mapping.targetIds.filter(targetId => inProjectScope(graph.chunks[targetId], scopes));
    if (!own.length) continue;
    const refs = [];
    for (const targetId of own) {
      const target = graph.chunks[targetId];
      const symbol = target.symbol || target.parentClass;
      if (!symbol || symbols.size >= maxSymbols && !symbols.has(symbol)) continue;
      symbols.add(symbol);
      refs.push({ symbol, path: target.path, startLine: target.startLine, endLine: target.endLine });
    }
    if (refs.length) mappings.push({ sourcePath: mapping.sourcePath, sourceLine: mapping.sourceLine,
      projectId: mapping.projectId, text: mapping.text, symbols: refs });
    if (symbols.size >= maxSymbols || mappings.length >= 4) break;
  }
  return { query: symbols.size ? `${query}\n源码资料中的业务符号：${[...symbols].join(' ')}` : query, mappings };
}

function expandProjectCodeRelations(rows, graph, options = {}) {
  const scopes = options.scopes || [];
  const maxSeeds = Math.max(1, Math.min(10, Number(options.maxSeeds) || 4));
  const maxNeighbors = Math.max(0, Math.min(16, Number(options.maxNeighbors) || 8));
  const maxDepth = Math.max(0, Math.min(3, Number(options.maxDepth) || 2));
  const out = rows.filter(row => row?.chunk && inProjectScope(row.chunk, scopes)).map(row => ({ ...row }));
  const byId = new Map(out.map(row => [graph.chunkIds.get(row.chunk), row]));
  const queue = out.slice(0, maxSeeds).map(row => ({ row, depth: 0 }));
  const visited = new Set();
  let added = 0;
  while (queue.length && added < maxNeighbors) {
    const { row, depth } = queue.shift();
    const id = graph.chunkIds.get(row.chunk);
    if (id === undefined || visited.has(id) || depth >= maxDepth) continue;
    visited.add(id);
    for (const edge of graph.edges.get(id) || []) {
      if (edge.status !== 'resolved' || !Number.isInteger(edge.targetId)) continue;
      const target = graph.chunks[edge.targetId];
      if (!target || !inProjectScope(target, scopes) || projectKey(target) !== projectKey(row.chunk)) continue;
      const { targetId, ...relation } = edge;
      let neighbor = byId.get(targetId);
      if (neighbor) {
        // Preserve relevance while exposing the actual connecting callsite.
        if (!neighbor.relation) neighbor.relation = relation;
        // A weak lexical hit must not suppress a target proven by a strong
        // caller; otherwise its next hop is filtered out by the score gate.
        neighbor.score = Math.max(neighbor.score, row.score * 0.8);
        neighbor.confidence = Math.max(neighbor.confidence, 0.46, row.confidence * 0.82);
      } else {
        neighbor = { chunk: target, score: row.score * 0.8,
          confidence: Math.max(0.46, row.confidence * 0.82), coverage: row.coverage || 0,
          originalMatches: row.originalMatches || 0, neighbor: true, relation };
        out.push(neighbor); byId.set(targetId, neighbor); added++;
      }
      queue.push({ row: neighbor, depth: depth + 1 });
      if (added >= maxNeighbors) break;
    }
  }
  return out.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}

module.exports = { SCHEMA_VERSION, buildProjectCodeRelations, expandProjectCodeQuery, expandProjectCodeRelations };
