'use strict';

// A deliberately small, bounded YAML data reader. No tags, anchors, aliases,
// merge keys, executable constructors or document code are accepted. The import
// format needs scalars, lists and path/symbol maps; unsupported YAML falls back
// to the original Markdown body and is reported instead of executing anything.
const { createHash } = require('crypto');
const DOC_TYPES = new Set('overview implementation decision challenge incident performance ownership collaboration environment process limitation theory'.split(' '));
const TRUTH_SCOPES = new Set('implemented test_only planned hypothetical abandoned general_knowledge unverified'.split(' '));
const MAX_FRONT_MATTER = 24 * 1024;
const FIELDS = new Set('schema_version project_id project_name resume_order aliases source_revision code_roots exclude_paths doc_type truth_scope status topics code_refs related_docs'.split(' '));
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

function relativePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  if (!text || text.length > 500 || /^[\/]|^[A-Za-z]:/.test(text) || text.split('/').some(part => part === '..' || part === '.')) return '';
  return text.replace(/\/+$/, '');
}
function stripComment(value) {
  let quote = '', escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && c === '\\') { escaped = true; continue; }
    if (quote && c === quote) quote = '';
    else if (!quote && (c === '"' || c === "'")) quote = c;
    else if (!quote && c === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}
function boundedYaml(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAX_FRONT_MATTER) throw new Error('front matter 超过 24 KB');
  const records = raw.split('\n').map(line => {
    if (/\t/.test(line.slice(0, line.search(/\S|$/)))) throw new Error('缩进不能使用 tab');
    const indent = /^ */.exec(line)[0].length;
    return { indent, text: stripComment(line.slice(indent)) };
  }).filter(line => line.text);
  if (records.length > 256) throw new Error('front matter 超过 256 行');
  let nodes = 0, cursor = 0;
  const check = depth => { if (++nodes > 512 || depth > 5) throw new Error('front matter 嵌套或节点数量超过上限'); };
  function splitFlow(text) {
    let quote = '', escaped = false, level = 0, start = 0;
    const values = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (quote === '"' && c === '\\') { escaped = true; continue; }
      if (quote && c === quote) quote = '';
      else if (!quote && (c === '"' || c === "'")) quote = c;
      else if (!quote && /[\[{]/.test(c)) level++;
      else if (!quote && /[\]}]/.test(c)) level--;
      else if (!quote && level === 0 && c === ',') { values.push(text.slice(start, i).trim()); start = i + 1; }
    }
    if (quote || level !== 0) throw new Error('front matter 引号或集合未闭合');
    if (text.slice(start).trim()) values.push(text.slice(start).trim());
    if (values.length > 64) throw new Error('front matter 列表超过 64 项');
    return values;
  }
  function scalar(value, depth) {
    check(depth);
    value = value.trim();
    if (value.length > 2000) throw new Error('front matter 字段过长');
    if (/^[&*!]|(?:^|\s)[&*][\w-]+|^!!|^<<\s*:/.test(value)) throw new Error('不支持 YAML 标签、锚点、别名或 merge');
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch (_) { throw new Error('front matter 双引号字符串无效'); } }
    if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) throw new Error('front matter 单引号字符串无效');
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new Error('front matter 列表未闭合');
      return splitFlow(value.slice(1, -1)).map(item => scalar(item, depth + 1));
    }
    if (value.startsWith('{')) {
      if (!value.endsWith('}')) throw new Error('front matter map 未闭合');
      const map = Object.create(null);
      for (const item of splitFlow(value.slice(1, -1))) {
        const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(item);
        if (!pair || Object.hasOwn(map, pair[1])) throw new Error('front matter map 字段无效或重复');
        map[pair[1]] = scalar(pair[2], depth + 1);
      }
      return map;
    }
    if (/^(?:\||>)/.test(value)) throw new Error('请将 front matter 多行字段改为普通字符串');
    if (/^(?:null|~)$/i.test(value) || !value) return null;
    if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    return value;
  }
  function block(indent, depth) {
    check(depth);
    const list = /^-\s/.test(records[cursor]?.text || '');
    const output = list ? [] : Object.create(null);
    while (cursor < records.length && records[cursor].indent === indent) {
      const line = records[cursor];
      if (list) {
        if (!/^-\s/.test(line.text)) break;
        if (output.length >= 64) throw new Error('front matter 列表超过 64 项');
        const rest = line.text.replace(/^-\s+/, ''); cursor++;
        const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(rest);
        if (pair) {
          const item = Object.create(null); item[pair[1]] = scalar(pair[2], depth + 1);
          if (cursor < records.length && records[cursor].indent > indent) {
            const tail = block(records[cursor].indent, depth + 1);
            if (Array.isArray(tail)) throw new Error('front matter map 结构无效');
            for (const [k, v] of Object.entries(tail)) {
              if (Object.hasOwn(item, k)) throw new Error('front matter 字段重复');
              item[k] = v;
            }
          }
          output.push(item);
        } else if (!rest && cursor < records.length && records[cursor].indent > indent) output.push(block(records[cursor].indent, depth + 1));
        else output.push(scalar(rest, depth + 1));
      } else {
        if (/^-\s/.test(line.text)) break;
        const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.text);
        if (!pair || Object.hasOwn(output, pair[1])) throw new Error('front matter 字段无效或重复');
        cursor++;
        if (!pair[2] && cursor < records.length && (records[cursor].indent > indent || records[cursor].indent === indent && /^-\s/.test(records[cursor].text))) {
          output[pair[1]] = block(records[cursor].indent, depth + 1);
        } else output[pair[1]] = scalar(pair[2], depth + 1);
      }
    }
    return output;
  }
  if (!records.length) return Object.create(null);
  const output = block(records[0].indent, 0);
  if (cursor !== records.length || Array.isArray(output)) throw new Error('front matter 缩进结构无效');
  return output;
}
function strings(value) { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 250)))].slice(0, 32) : []; }
function metadataFields(value) {
  const metadata = {};
  for (const field of FIELDS) if (Object.hasOwn(value, field)) metadata[field] = value[field];
  for (const field of ['topics', 'aliases']) metadata[field] = strings(metadata[field]);
  for (const field of ['code_roots', 'exclude_paths', 'related_docs']) metadata[field] = strings(metadata[field]).map(relativePath).filter(Boolean);
  metadata.code_refs = (Array.isArray(metadata.code_refs) ? metadata.code_refs : []).slice(0, 32).filter(ref => ref && typeof ref === 'object' && relativePath(ref.path)).map(ref => ({ path: relativePath(ref.path), ...(typeof ref.symbol === 'string' ? { symbol: ref.symbol.slice(0, 250) } : {}) }));
  metadata.docTypeDeclared = DOC_TYPES.has(metadata.doc_type);
  metadata.doc_type = metadata.docTypeDeclared ? metadata.doc_type : 'implementation';
  metadata.truth_scope = TRUTH_SCOPES.has(metadata.truth_scope) ? metadata.truth_scope : 'unverified';
  metadata.status = metadata.status === 'confirmed' ? 'confirmed' : 'draft';
  metadata.metadataDeclared = metadata.docTypeDeclared || TRUTH_SCOPES.has(value.truth_scope) || value.status === 'confirmed' || value.status === 'draft';
  return metadata;
}
function parseFrontMatter(source) {
  const text = String(source || '');
  if (!/^\uFEFF?---[ \t]*\r?\n/.test(text)) return { text, body: text, bodyOffset: 0, bodyLine: 1, metadata: metadataFields({}), warnings: [], present: false };
  const closing = /\n(?:---|\.\.\.)[ \t]*\r?(?:\n|$)/g; closing.lastIndex = 4;
  const end = closing.exec(text);
  if (!end) return { text, body: text, bodyOffset: 0, bodyLine: 1, metadata: metadataFields({}), warnings: ['front matter 未闭合，按原文检索'], present: true, valid: false };
  const bodyOffset = end.index + end[0].length;
  const result = { text, body: text.slice(bodyOffset), bodyOffset, bodyLine: 1 + (text.slice(0, bodyOffset).match(/\n/g) || []).length, present: true };
  try { result.metadata = metadataFields(boundedYaml(text.slice(text.indexOf('\n') + 1, end.index))); result.warnings = []; result.valid = true; }
  catch (error) { result.metadata = metadataFields({}); result.warnings = [String(error.message) + '；已回退正文检索']; result.valid = false; }
  return result;
}

function markdownSections(parsed, filePath) {
  const source = parsed.text, lines = source.split('\n'), offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1) + line.length + 1);
  const headings = [], stack = [];
  let fence = null;
  for (let i = parsed.bodyLine - 1; i < lines.length; i++) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && /^\s{0,3}(?:`+|~+)\s*$/.test(lines[i])) fence = null;
      continue;
    }
    const heading = !fence && /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!heading) continue;
    const level = heading[1].length;
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const node = { level, title: heading[2], line: i + 1, offset: offsets[i], headingPath: [...stack.map(x => x.title), heading[2]], parentHeading: stack.at(-1)?.id || '' };
    node.id = hash(filePath + ':' + node.offset + ':' + node.title); headings.push(node); stack.push(node);
  }
  const starts = [...(headings[0]?.offset === parsed.bodyOffset ? [] : [{ offset: parsed.bodyOffset, line: parsed.bodyLine, title: '', headingPath: [], id: hash(filePath + ':body'), level: 0 }]), ...headings];
  return starts.map((node, i) => {
    const endOffset = starts[i + 1]?.offset ?? source.length;
    const parentEnd = headings.find(next => next.offset > node.offset && next.level <= node.level)?.offset ?? source.length;
    return { ...node, startOffset: node.offset, endOffset, startLine: node.line, endLine: node.line + (source.slice(node.offset, endOffset).match(/\n/g) || []).length,
      text: source.slice(node.offset, endOffset), parentText: source.slice(node.offset, parentEnd), parentEndOffset: parentEnd };
  }).filter(section => section.text.trim());
}

function retrievalPrefix(chunk, projectName = '') {
  // Only original names, headings, declared types and symbols form this hint.
  // It is retrieval metadata, never prepended to the quoted source text.
  return [projectName, ...(chunk.headingPath || []), chunk.docType, ...(chunk.aliases || []), chunk.symbol]
    .filter(Boolean).join(' · ').slice(0, 250);
}
module.exports = { parseFrontMatter, markdownSections, retrievalPrefix, relativePath, DOC_TYPES, TRUTH_SCOPES, hash };
