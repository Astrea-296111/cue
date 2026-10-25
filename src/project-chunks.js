'use strict';
const path = require('path');
const { createHash } = require('crypto');
const { parseFrontMatter, markdownSections, retrievalPrefix, hash } = require('./project-document-parser');
const TARGET = 1800;
const MAX = 2400;
const METADATA_SCHEMA_VERSION = 3;
const CONDITIONAL_BODY = /(?:^|\n)\s*(?:[-*>]\s*)?(?:如果|假设|假如|计划(?:中|是|将|在|使用|实现|改为|引入)|待实现|尚未实现|未实现|后续计划|未来(?:准备|计划)|not implemented|planned\b|TODO\b)/i;

// Conservative lexical boundary detection, not an AST parser. Strings/comments
// are masked before brace matching; unsupported syntax falls back to line windows.
function maskCode(text, python = false) {
  let out = '', state = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (state === 'line') {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\n') state = '';
    } else if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i++; state = ''; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (state === 'string') {
      if (text.startsWith(quote, i)) { out += ' '.repeat(quote.length); i += quote.length - 1; state = ''; }
      else if (c === '\\' && n) { out += ' ' + (n === '\n' ? '\n' : ' '); i++; }
      else out += c === '\n' ? '\n' : ' ';
    } else if ((!python && c === '/' && n === '/') || (python && c === '#')) {
      state = 'line'; out += ' ';
    } else if (!python && c === '/' && n === '*') {
      state = 'block'; out += '  '; i++;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = python && text.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c;
      state = 'string'; out += ' '.repeat(quote.length); i += quote.length - 1;
    } else out += c;
  }
  return out;
}

// Keep the source comment, not a generated summary. Only comments immediately
// attached to a declaration belong to its description.
function declarationStart(lines, at) {
  let start = at;
  while (start > 0) {
    const line = lines[start - 1].trim();
    if (/^@\w/.test(line) || /^\/\//.test(line)) { start--; continue; }
    if (/\)\s*$/.test(line)) {
      let annotation = start - 1;
      while (annotation >= Math.max(0, start - 12) && !/^\s*@\w/.test(lines[annotation])) annotation--;
      if (annotation >= 0 && /^\s*@[\w.]+\s*\([\s\S]*\)\s*$/.test(maskCode(lines.slice(annotation, start).join('\n')))) {
        start = annotation; continue;
      }
    }
    if (line.endsWith('*/')) {
      let open = start - 1;
      while (open >= 0 && !lines[open].includes('/*')) open--;
      if (open >= 0) { start = open; continue; }
    }
    break;
  }
  return start;
}

function sourceDescription(lines, start, declaration) {
  return lines.slice(start, declaration).filter(line => /^\s*(?:\/\/|\/\*|\*|\*\/)/.test(line))
    .map(line => line.replace(/^\s*(?:\/\/|\/\*\*?|\*\/|\*)\s?/, '').replace(/\*\/\s*$/, '').trim())
    .filter(Boolean).join('\n');
}

function sourceCalls(text, startLine, python = false, localTypes = {}) {
  const masked = maskCode(text, python), calls = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = re.exec(masked))) {
    const prefix = masked.slice(0, match.index).trimEnd();
    if (/^\s*@/.test(masked.slice(masked.lastIndexOf('\n', match.index) + 1, match.index))) continue;
    // A chain such as foo.bar.run() has an unknown receiver type. The explicit
    // this.field.run() form can use a declared field of the current class.
    if (prefix.endsWith('.') && !/\bthis\s*\.\s*$/.test(prefix)) continue;
    const explicitThis = /\bthis\s*\.\s*$/.test(prefix);
    calls.push({ receiver: match[1], method: match[2], line: startLine + (masked.slice(0, match.index).match(/\n/g) || []).length,
      ...(explicitThis ? { explicitThis: true } : {}),
      ...(!explicitThis && Object.hasOwn(localTypes, match[1]) ? { shadowed: true } : {}) });
  }
  return calls;
}

function javaLocalTypes(text) {
  const localTypes = {};
  const masked = maskCode(text).replace(/@[\w.]+(?:\s*\([^)]*\))?\s*/g, ' ');
  const declaration = /(?:^|[;{}(,])\s*(?:final\s+)?([\w$.]+(?:\s*<[^;{}()]+>)?(?:\s*\[\])*)\s+([\w$]+)\s*(?=[=;,)])/g;
  for (const match of masked.matchAll(declaration)) {
    if (!/^(?:return|throw|new|else|break|continue)$/.test(match[1])) localTypes[match[2]] = match[1].replace(/\s+/g, '');
  }
  return localTypes;
}

function roleFor(filePath, symbol, text, kind, language) {
  if (/(?:^|\/)(?:application[^/]*\.(?:ya?ml|properties)|[^/]*config[^/]*\.[^/]+|Dockerfile|compose[^/]*\.ya?ml)$/i.test(filePath)) return 'config';
  if (language === 'text') return 'document';
  const evidence = `${symbol}\n${(text.match(/^\s*@(RestController|Controller|Service|Repository)\b/gm) || []).join('\n')}`;
  if (/@(?:RestController|Controller)\b|\b\w*Controller\b/.test(evidence)) return 'controller';
  if (/@Service\b|\b\w*Service\b/.test(evidence)) return 'service';
  if (/@Repository\b|\b\w*(?:Repository|Dao|DAO)\b/.test(evidence)) return 'repository';
  return /^(?:method|function)$/.test(kind) ? 'function' : 'unknown';
}

function javaClassMetadata(span, maskedText, text) {
  const header = maskedText.slice(span.openOffset < 0 ? 0 : span.declarationOffset, span.openOffset);
  const names = value => String(value || '').replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, '').split(',').map(x => x.trim()).filter(Boolean);
  const extendsMatch = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(header);
  const implementsMatch = /\bimplements\s+([\s\S]*)$/.exec(header);
  const fieldTypes = {};
  let depth = 1, statementStart = span.openOffset + 1;
  for (let i = statementStart; i < span.closeOffset; i++) {
    const c = maskedText[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 1) statementStart = i + 1;
    } else if (c === ';' && depth === 1) {
      const statement = maskedText.slice(statementStart, i).trim()
        .replace(/@[\w.]+(?:\s*\([^)]*\))?\s*/g, '').trim();
      const field = /^(?:(?:public|private|protected|static|final|transient|volatile)\s+)*([\w$.]+(?:\s*<[^;{}]+>)?(?:\s*\[\])*)\s+([\w$]+)(?:\s*=\s*[\s\S]*|\s*)$/.exec(statement);
      if (field && field[1] !== 'var') fieldTypes[field[2]] = field[1].replace(/\s+/g, '');
      statementStart = i + 1;
    }
  }
  return { fieldTypes, extends: names(extendsMatch?.[1]), implements: names(implementsMatch?.[1]),
    role: roleFor('', span.symbol, text, span.kind, 'java') };
}

function chunkText(filePath, text, options = {}) {
  const safePath = String(filePath || '').replace(/\\/g, '/');
  const language = ({ '.java': 'java', '.go': 'go', '.py': 'python', '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript' })[path.extname(safePath).toLowerCase()] || 'text';
  const lines = String(text || '').split('\n');
  const source = lines.join('\n');
  const maskedSource = maskCode(source, language === 'python');
  const masked = maskedSource.split('\n');
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1) + line.length + 1);
  const imports = language === 'java' ? [...maskedSource.matchAll(/^\s*import\s+(?:static\s+)?([\w.$]+(?:\.\*)?)\s*;/gm)].map(m => m[1]) : [];
  const packageName = language === 'java' ? /^\s*package\s+([\w.]+)\s*;/m.exec(maskedSource)?.[1] || '' : '';
  const chunks = [];
  const parents = [];
  Object.defineProperty(chunks, 'parents', { value: parents });
  const defaultMetadata = { docType: 'implementation', truthScope: language === 'text' ? 'unverified' : /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|(?:Test|Spec)\.[^/]+$|\.(?:test|spec)\./i.test(safePath) ? 'test_only' : 'implemented',
    status: 'draft', topics: [], aliases: [], codeRefs: [], relatedDocs: [], headingPath: [], provenance: 'imported', offsetEncoding: 'utf16', docTypeDeclared: language !== 'text', metadataDeclared: false, parserKind: 'lexical', parserVersion: 'cue-lexical-4', parserQuality: 'conservative', ...options.metadata };
  function emit(start, end, symbol = '', kind = 'text', metadata = {}) {
    if (end <= start) return;
    const parentId = metadata.parentId || hash(safePath + ':' + offsets[start] + ':' + offsets[end] + ':' + symbol);
    if (!parents.some(parent => parent.id === parentId)) parents.push({ id: parentId, path: safePath,
      text: source.slice(offsets[start], Math.min(source.length, offsets[end] - 1)), startLine: start + 1, endLine: end,
      startOffset: offsets[start], endOffset: Math.min(source.length, offsets[end] - 1), symbol, kind, ...defaultMetadata, ...metadata });
    let cursor = start;
    while (cursor < end) {
      let stop = cursor, chars = 0;
      // Keep complete small functions; split only oversized regions.
      const remaining = lines.slice(cursor, end).join('\n');
      if (remaining.length <= MAX) stop = end;
      else {
        while (stop < end && (stop === cursor || chars + lines[stop].length + 1 <= MAX)) {
          chars += lines[stop].length + 1; stop++;
          if (chars >= TARGET) break;
        }
      }
      const body = lines.slice(cursor, stop).join('\n');
      // A minified / single long line must not silently lose its tail.
      for (let offset = 0; offset < body.length; offset += MAX) {
        const part = body.slice(offset, offset + MAX);
        if (!part.trim()) continue;
        const startOffset = offsets[cursor] + offset;
        const startLine = cursor + 1 + (body.slice(0, offset).match(/\n/g) || []).length;
        const endLine = startLine + (part.match(/\n/g) || []).length;
        const role = roleFor(safePath, symbol, part, kind, language);
        // Reuse the existing source-profile topic vocabulary. This is lexical
        // source classification, not a claim about runtime behavior.
        const { TOPICS } = require('./project-profile');
        const interviewTopics = TOPICS.filter(topic => topic.re.test(`${safePath}\n${symbol}\n${part}`)).map(topic => topic.key);
        const record = { path: safePath, startLine, endLine, startOffset, endOffset: startOffset + part.length,
          text: part, language, symbol, kind, metadataSchemaVersion: METADATA_SCHEMA_VERSION,
          type: kind === 'class' || metadata.parentClass && kind === 'context' ? 'class' : /^(method|function)$/.test(kind) ? 'function' : 'document',
          parentClass: '', method: kind === 'method' ? symbol.split('#').at(-1) : '', methods: [],
          imports, packageName, fieldTypes: {}, localTypes: {}, extends: [], implements: [], description: '', declarationLine: cursor + 1, descriptionLine: null,
          role, importance: /(?:^|\/)(?:test|tests|__tests__|build|dist|generated)(?:\/|$)|(?:Test|Spec)\.[^/]+$|\.(?:test|spec)\./i.test(safePath) ? 'low' : /^(?:controller|service|repository)$/.test(role) || /(?:^|\/)readme\./i.test(safePath) ? 'high' : 'normal',
          interviewTopics, ...defaultMetadata, ...metadata, parentId,
          calls: language === 'text' ? [] : sourceCalls(part, startLine, language === 'python', metadata.localTypes),
          ...(cursor !== start || stop !== end || body.length > MAX ? { partial: true } : {}) };
        if (language === 'text' && record.truthScope === 'implemented' && CONDITIONAL_BODY.test(part)) {
          record.declaredTruthScope = 'implemented'; record.truthScope = 'unverified';
          record.truthWarnings = ['原文包含计划、条件或未实现范围，不能仅凭 front matter 升级为已实现'];
        }
        record.id = hash(safePath + ':' + startOffset + ':' + record.endOffset + ':' + part);
        record.contentHash = createHash('sha256').update(part).digest('hex');
        record.retrievalText = [retrievalPrefix(record, options.projectName), part].filter(Boolean).join('\n');
        chunks.push(record);
      }
      cursor = stop;
    }
  }

  if (/\.mdx?$/i.test(safePath)) {
    const parsed = parseFrontMatter(source), fields = parsed.metadata;
    Object.defineProperty(chunks, 'warnings', { value: parsed.warnings });
    const frontLines = source.slice(0, parsed.bodyOffset).split('\n');
    const codeRefs = fields.code_refs.map(ref => {
      const line = frontLines.findIndex(value => /^\s*(?:-\s*)?path\s*:/.test(value) && value.includes(ref.path));
      return { ...ref, ...(line >= 0 ? { sourceLine: line + 1 } : {}) };
    });
    const referenceLines = {};
    for (const ref of fields.related_docs) {
      const line = frontLines.findIndex(value => /^\s*(?:-\s|related_docs\s*:)/.test(value) && value.includes(ref));
      if (line >= 0) referenceLines[ref] = line + 1;
    }
    const declared = { ...defaultMetadata, docType: fields.doc_type, truthScope: fields.truth_scope, status: fields.status,
      docTypeDeclared: fields.docTypeDeclared, metadataDeclared: fields.metadataDeclared,
      topics: fields.topics, aliases: fields.aliases, codeRefs, relatedDocs: fields.related_docs, referenceLines,
      declaredProjectId: typeof fields.project_id === 'string' ? fields.project_id : '', sourceRevision: typeof fields.source_revision === 'string' ? fields.source_revision : '',
      parserKind: 'markdown', parserVersion: 'cue-markdown-4', parserQuality: parsed.valid === false ? 'front-matter-fallback' : 'structured' };
    for (const section of markdownSections(parsed, safePath)) {
      const metadata = { ...declared, headingPath: section.headingPath, parentId: section.id };
      emit(section.startLine - 1, section.endLine - (section.text.endsWith('\n') ? 1 : 0), section.title, 'section', metadata);
      const parent = parents.find(item => item.id === section.id);
      if (parent) Object.assign(parent, { text: section.parentText, startOffset: section.startOffset, endOffset: section.parentEndOffset,
        endLine: section.startLine + (section.parentText.match(/\n/g) || []).length - (section.parentText.endsWith('\n') ? 1 : 0), parentId: section.parentHeading || '' });
      if (parent?.truthScope === 'implemented' && CONDITIONAL_BODY.test(parent.text)) {
        parent.declaredTruthScope = 'implemented'; parent.truthScope = 'unverified';
        parent.truthWarnings = ['父段包含计划或条件范围，引用时保留原文限制'];
      }
    }
    return chunks;
  }
  if (language === 'text') { emit(0, lines.length); return chunks; }

  const spans = [];
  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    if (!line.trim()) continue;
    let name = '', kind = 'function', end = -1, openOffset = -1, closeOffset = -1, declarationOnly = false;
    if (language === 'python') {
      const match = /^(\s*)(?:async\s+)?(def|class)\s+(\w+)\s*[(\[:]/.exec(line);
      if (!match) continue;
      kind = match[2] === 'class' ? 'class' : 'function'; name = match[3];
      const indent = match[1].replace(/\t/g, '    ').length;
      end = i + 1;
      while (end < masked.length) {
        const next = masked[end];
        if (next.trim() && next.match(/^\s*/)[0].replace(/\t/g, '    ').length <= indent) break;
        end++;
      }
    } else {
      let signature = masked.slice(i, i + 6).join('\n');
      let match;
      if ((match = /^\s*(?:(?:export|default|public|private|protected|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(line))) {
        name = match[1]; kind = 'class';
        // Real Java records often list more than six typed components. Bound
        // the header scan but keep the actual opening brace/source span instead
        // of losing the type and fabricating an unresolved class reference.
        signature = masked.slice(i, i + 96).join('\n');
      } else if (language === 'go' && (match = /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/.exec(line))) name = match[1];
      else if ((match = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/.exec(line))) name = match[1];
      else if ((match = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{/.exec(signature))) name = match[1];
      else if (language !== 'go' && (match = /^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|default|async|override|readonly)\s+)*(?:[\w.$]+(?:\s*<[^;{}()]+>)?(?:\s*\[\])*\s+)?(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+|:\s*[^;={]+)?\s*\{/.exec(signature))) {
        if (/^(if|for|while|switch|catch|with|synchronized|try)$/.test(match[1])) continue;
        name = match[1]; kind = 'method';
      }
      else if (language === 'java' && (match = /^\s*(?:(?:public|private|protected|static|final|abstract|default)\s+)*(?:[\w<>[\],.?]+\s+)(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+)?\s*;/.exec(signature))) {
        name = match[1]; kind = 'method'; declarationOnly = true;
        end = i + signature.slice(0, match[0].lastIndexOf(';') + 1).split('\n').length;
      }
      if (!name) continue;
      if (declarationOnly) {
        const parent = spans.filter(s => s.kind === 'class' && s.declaration <= i && s.end >= end).at(-1);
        if (!parent) continue;
        const before = maskedSource.slice(parent.openOffset + 1, offsets[i]);
        if ((before.match(/\{/g) || []).length !== (before.match(/\}/g) || []).length) continue;
      }
      const open = signature.indexOf('{');
      if (!declarationOnly && (open < 0 || signature.slice(0, open).includes(';'))) continue;
      if (!declarationOnly) openOffset = offsets[i] + open;
      let depth = 0, started = false;
      for (let j = i; j < masked.length && end < 0; j++) {
        for (let column = 0; column < masked[j].length; column++) {
          const c = masked[j][column];
          if (c === '{') { depth++; started = true; }
          if (c === '}' && started && --depth === 0) { end = j + 1; closeOffset = offsets[j] + column; break; }
        }
      }
    }
    if (end > i) {
      const start = declarationStart(lines, i);
      spans.push({ start, declaration: i, declarationOffset: offsets[i], end, symbol: name, kind,
        openOffset, closeOffset, declarationOnly, description: sourceDescription(lines, start, i) });
    }
  }
  for (const span of spans.filter(s => s.kind === 'class')) {
    span.metadata = language === 'java' ? javaClassMetadata(span, maskedSource, lines.slice(span.start, span.end).join('\n')) : { fieldTypes: {}, extends: [], implements: [] };
    span.metadata.methods = [...new Set(spans.filter(s => s.kind !== 'class' && s.declaration > span.declaration && s.end <= span.end
      && !spans.some(inner => inner.kind === 'class' && inner !== span && inner.declaration > span.declaration && inner.declaration < s.declaration && inner.end >= s.end)).map(s => s.symbol))];
    span.metadata.parentClass = span.symbol;
    span.metadata.description = span.description;
    span.metadata.declarationLine = span.declaration + 1;
    span.metadata.descriptionLine = span.description ? span.start + 1 : null;
  }
  const parentOf = (start, end) => spans.filter(s => s.kind === 'class' && s.declaration <= start && s.end >= end).at(-1);
  const emitContext = (start, end) => {
    // A gap can contain the end of one class and the beginning of the next.
    // Split at class boundaries rather than attaching the wrong field types.
    const boundaries = [...new Set([start, end, ...spans.filter(s => s.kind === 'class').flatMap(s => [s.start, s.end]).filter(n => n > start && n < end)])].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i], to = boundaries[i + 1];
      const parent = spans.filter(s => s.kind === 'class' && s.start <= from && s.end >= to).at(-1);
      emit(from, to, parent?.symbol || '', 'context', parent?.metadata || {});
    }
  };
  // Prefer methods inside a class. Keep its header/fields in separate gap chunks.
  const leaf = spans.filter(s => !spans.some(t => t !== s && t.start > s.start && t.end <= s.end));
  leaf.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  for (const span of leaf) {
    if (span.start < cursor) continue;
    emitContext(cursor, span.start);
    const parent = span.kind === 'class' ? null : parentOf(span.declaration, span.end);
    emit(span.start, span.end, parent ? `${parent.symbol}#${span.symbol}` : span.symbol, span.kind,
      { ...(span.metadata || parent?.metadata || {}), description: span.description, declarationLine: span.declaration + 1, descriptionLine: span.description ? span.start + 1 : null,
        ...(span.kind === 'method' || parent && span.kind === 'function' ? { method: span.symbol, declarationOnly: span.declarationOnly } : {}),
        ...(language === 'java' && span.kind === 'method' ? { localTypes: javaLocalTypes(lines.slice(span.declaration, span.end).join('\n')) } : {}) });
    cursor = span.end;
  }
  emitContext(cursor, lines.length);
  return chunks;
}
module.exports = { chunkText };
