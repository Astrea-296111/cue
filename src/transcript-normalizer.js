'use strict';

const BASE_TERMS = [
  'Java', 'Go', 'Golang', 'Python', 'JavaScript', 'TypeScript', 'Node.js',
  'Spring', 'Spring Boot', 'Spring Cloud', 'JVM', 'GC', 'G1', 'ZGC',
  'HashMap', 'ConcurrentHashMap', 'ThreadLocal', 'CompletableFuture',
  'MySQL', 'PostgreSQL', 'Redis', 'MongoDB', 'Elasticsearch',
  'Kafka', 'RocketMQ', 'RabbitMQ', 'Docker', 'Kubernetes', 'K8s', 'Helm',
  'REST API', 'gRPC', 'HTTP', 'HTTPS', 'WebSocket', 'TCP', 'UDP',
  'RAG', 'LLM', 'MCP', 'A2A', 'LangChain', 'LangGraph', 'Agent',
  'MVCC', 'CAP', 'CAS', 'AQS', 'JMM', 'SQL', 'NoSQL', 'CI/CD'
];

// Conservative replacements for mistakes that are common in mixed Chinese/English
// software interviews. Avoid broad phonetic guesses that could rewrite ordinary words.
const FIXUPS = [
  [/\bred\s+is\b/gi, 'Redis'],
  [/\bredis\b/gi, 'Redis'],
  [/瑞迪斯|雷迪斯/g, 'Redis'],
  [/\bmy\s+sequel\b/gi, 'MySQL'],
  [/\bmy\s*sql\b/gi, 'MySQL'],
  [/\bpostgre\s*sql\b/gi, 'PostgreSQL'],
  [/\bspring\s*boot\b/gi, 'Spring Boot'],
  [/\bspring\s*cloud\b/gi, 'Spring Cloud'],
  [/\bconcurrent\s*hash\s*map\b/gi, 'ConcurrentHashMap'],
  [/\bthread\s*local\b/gi, 'ThreadLocal'],
  [/\bcomplete(?:able)?\s*future\b/gi, 'CompletableFuture'],
  [/\brocket\s*mq\b/gi, 'RocketMQ'],
  [/\brabbit\s*mq\b/gi, 'RabbitMQ'],
  [/\blang\s*graph\b/gi, 'LangGraph'],
  [/\blang\s*chain\b/gi, 'LangChain'],
  [/\bk\s*8\s*s\b/gi, 'K8s'],
  [/\bg\s*r\s*p\s*c\b/gi, 'gRPC'],
  [/\bm\s*c\s*p\b/gi, 'MCP'],
  [/\br\s*a\s*g\b/gi, 'RAG'],
  [/\bl\s*l\s*m\b/gi, 'LLM'],
  [/\bj\s*v\s*m\b/gi, 'JVM'],
  [/\bm\s*v\s*c\s*c\b/gi, 'MVCC'],
  [/卡夫卡/g, 'Kafka']
];

function clean(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim();
}

function extractDynamicTerms(settings = {}) {
  const qwen = settings.qwenAsr || {};
  const source = [
    settings.resumeText || '',
    settings.projectKnowledge || '',
    settings.jobDescription || '',
    Array.isArray(qwen.vocabulary) ? qwen.vocabulary.join(' ') : '',
    Array.isArray(settings.sttVocabulary) ? settings.sttVocabulary.join(' ') : (settings.sttVocabulary || '')
  ].join('\n');
  const found = source.match(/\b[A-Za-z][A-Za-z0-9+.#/_-]{1,36}(?:\s+[A-Za-z][A-Za-z0-9+.#/_-]{1,24}){0,2}\b/g) || [];
  return [...new Set([...BASE_TERMS, ...found.map(x => x.trim())])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .slice(0, 180);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTranscript(value, settings = {}) {
  let text = clean(value);
  if (!text) return '';
  for (const [pattern, canonical] of FIXUPS) text = text.replace(pattern, canonical);

  // Restore canonical casing for known/dynamic technical terms when ASR already
  // recognized the same lexical form. This does not fuzzy-rewrite unrelated words.
  for (const term of extractDynamicTerms(settings)) {
    if (!/[A-Za-z]/.test(term) || term.length < 3) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(term).replace(/\\ /g, '\\s+')}\\b`, 'gi');
    text = text.replace(pattern, term);
  }
  return clean(text);
}

function resolveLanguageHint(settings = {}) {
  const raw = String(settings.sttLanguage || settings.qwenAsr?.language || 'auto').trim().toLowerCase();
  if (!raw || raw === 'auto' || raw === 'multilingual' || raw === 'multi') return 'auto';
  if (/^(zh|zh-cn|zh-hans|cn|chinese)$/.test(raw)) return 'zh';
  if (/^(en|en-us|en-gb|english)$/.test(raw)) return 'en';
  return raw.slice(0, 16);
}

function comparisonText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function bigrams(value) {
  const text = comparisonText(value);
  if (!text) return new Set();
  if (text.length === 1) return new Set([text]);
  const out = new Set();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
}

function diceSimilarity(a, b) {
  const aa = bigrams(a), bb = bigrams(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const item of aa) if (bb.has(item)) common++;
  return (2 * common) / (aa.size + bb.size);
}

function transcriptSimilarity(a, b) {
  const x = comparisonText(a), y = comparisonText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length > y.length ? x : y;
  const containment = longer.includes(shorter) ? shorter.length / longer.length : 0;
  return Math.max(containment, diceSimilarity(x, y));
}

class TranscriptDeduper {
  constructor(options = {}) {
    this.echoWindowMs = Number(options.echoWindowMs) || 2600;
    this.replayWindowMs = Number(options.replayWindowMs) || 6500;
    this.events = [];
  }

  reset() { this.events = []; }

  accept(channel, text, ts = Date.now()) {
    const value = clean(text);
    if (!value) return { drop: true, reason: 'empty', text: '' };
    this.events = this.events.filter(e => ts - e.ts <= Math.max(this.replayWindowMs, 9000));

    // Same-channel duplicates are common immediately after replaying the rolling
    // PCM buffer into a batch fallback. Suppress only near-identical repeats.
    for (let i = this.events.length - 1; i >= 0; i--) {
      const prev = this.events[i];
      if (prev.channel !== channel || ts - prev.ts > this.replayWindowMs) continue;
      if (transcriptSimilarity(prev.text, value) >= 0.955) {
        return { drop: true, reason: 'same-channel-replay', text: value, duplicateOf: prev };
      }
    }

    let removeEvent = null;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const prev = this.events[i];
      if (prev.channel === channel || ts - prev.ts > this.echoWindowMs) continue;
      const compactLength = Math.min(comparisonText(prev.text).length, comparisonText(value).length);
      if (compactLength < 6) continue;
      if (transcriptSimilarity(prev.text, value) < 0.86) continue;

      // System/meeting audio is authoritative for interviewer speech. If the mic
      // hears the same sentence afterwards, treat it as speaker leakage.
      if (channel === 'you' && prev.channel === 'them') {
        return { drop: true, reason: 'cross-channel-echo', text: value, duplicateOf: prev };
      }
      if (channel === 'them' && prev.channel === 'you') removeEvent = prev;
      break;
    }

    const event = { channel, text: value, ts };
    this.events.push(event);
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
    return { drop: false, text: value, event, removeEvent };
  }
}

module.exports = {
  BASE_TERMS,
  normalizeTranscript,
  extractDynamicTerms,
  resolveLanguageHint,
  transcriptSimilarity,
  TranscriptDeduper
};
