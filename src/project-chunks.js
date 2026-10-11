'use strict';
const path = require('path');
const TARGET = 1800;
const MAX = 2400;

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

function chunkText(filePath, text) {
  const safePath = String(filePath || '').replace(/\\/g, '/');
  const language = ({ '.java': 'java', '.go': 'go', '.py': 'python', '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript' })[path.extname(safePath).toLowerCase()] || 'text';
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  function emit(start, end, symbol = '', kind = 'text') {
    if (end <= start) return;
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
        chunks.push({ path: safePath, startLine: cursor + 1, endLine: stop,
          text: part, language, symbol, kind,
          ...(cursor !== start || stop !== end || body.length > MAX ? { partial: true } : {}) });
      }
      cursor = stop;
    }
  }

  if (/\.mdx?$/i.test(safePath)) {
    let start = 0, title = '', fenced = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
      if (!fenced && /^#{1,6}\s+/.test(lines[i])) {
        emit(start, i, title, 'section'); start = i; title = lines[i].replace(/^#+\s+/, '');
      }
    }
    emit(start, lines.length, title, 'section');
    return chunks;
  }
  if (language === 'text') { emit(0, lines.length); return chunks; }

  const masked = maskCode(lines.join('\n'), language === 'python').split('\n');
  const spans = [];
  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    let name = '', kind = 'function', end = -1;
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
      const signature = masked.slice(i, i + 6).join('\n');
      let match;
      if ((match = /^\s*(?:(?:export|default|public|private|protected|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(line))) {
        name = match[1]; kind = 'class';
      } else if (language === 'go' && (match = /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/.exec(line))) name = match[1];
      else if ((match = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/.exec(line))) name = match[1];
      else if ((match = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{/.exec(signature))) name = match[1];
      else if (language !== 'go' && (match = /^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|async|override|readonly)\s+)*(?:[\w<>[\],.?]+\s+)?(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+|:\s*[^;={]+)?\s*\{/.exec(signature))) {
        if (/^(if|for|while|switch|catch|with|synchronized)$/.test(match[1])) continue;
        name = match[1]; kind = 'method';
      }
      if (!name) continue;
      const open = signature.indexOf('{');
      if (open < 0 || signature.slice(0, open).includes(';')) continue;
      let depth = 0, started = false;
      for (let j = i; j < masked.length && end < 0; j++) {
        for (const c of masked[j]) {
          if (c === '{') { depth++; started = true; }
          if (c === '}' && started && --depth === 0) { end = j + 1; break; }
        }
      }
    }
    if (end > i) {
      let start = i;
      while (start > 0 && /^\s*@\w/.test(lines[start - 1])) start--;
      spans.push({ start, end, symbol: name, kind });
    }
  }
  // Prefer methods inside a class. Keep its header/fields in separate gap chunks.
  const leaf = spans.filter(s => !spans.some(t => t !== s && t.start > s.start && t.end <= s.end));
  leaf.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  for (const span of leaf) {
    if (span.start < cursor) continue;
    emit(cursor, span.start, '', 'context');
    const parent = spans.filter(s => s.kind === 'class' && s.start < span.start && s.end >= span.end).at(-1);
    emit(span.start, span.end, parent ? `${parent.symbol}#${span.symbol}` : span.symbol, span.kind);
    cursor = span.end;
  }
  emit(cursor, lines.length, '', 'context');
  return chunks;
}
module.exports = { chunkText };
