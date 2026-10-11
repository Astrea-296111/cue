'use strict';

// Common terms from the candidate's resume/project stack plus frequent interview
// vocabulary. Aliases are deliberately conservative: ambiguous words such as
// "red" and "face" are only rewritten when technical context makes the intended
// term likely.
const TERMS = {
  RAG: ['r a g', 'rag', 'rack'],
  MCP: ['m c p', 'mc p', 'emcp', 'mcp'],
  FAISS: ['f a i s s', 'faiss'],
  BM25: ['b m 25', 'bm 25', 'b m two five', 'bm25'],
  LangGraph: ['lang graph', 'lang grab', 'langgraph'],
  LangChain: ['lang chain', 'langchain'],
  React: ['react框架', 'react'],
  'Function Call': ['function calling', 'function call', 'function cool'],
  Redis: ['red is', 'redis'],
  PostgreSQL: ['post gre sql', 'postgre sql', 'postgres sql', 'postgresql'],
  FastAPI: ['fast api', 'fastapi'],
  SQLAlchemy: ['sql alchemy', 'sqlalchemy'],
  Docker: ['dock er', 'docker'],
  Git: ['git'],
  API: ['a p i', 'api'],
  SDK: ['s d k', 'sdk'],
  CLI: ['c l i', 'cli'],
  AST: ['a s t', 'ast'],
  RRF: ['r r f', 'rrf'],
  SSE: ['s s e', 'sse'],
  JPEG: ['j p e g', 'jpeg', 'jpg'],
  DCT: ['d c t', 'dct'],
  DWT: ['d w t', 'dwt'],
  MDS: ['m d s', 'mds'],
  RMM: ['r m m', 'rmm'],
  UERD: ['u e r d', 'uerd'],
  'J-UNIWARD': ['j uniward', 'j-uniward', 'j uni ward'],
  'TCSweighted': ['tcs weighted', 't c s weighted', 'tcsweighted'],
  bpnzac: ['b p n z a c', 'bpnzac'],
  RepoPilot: ['repo pilot', 'repopilot'],
  Embedding: ['embedding', 'embeddings'],
  MySQL: ['my sql', 'my sequel', 'mysql'],
  TCP: ['t c p', 'tcp'],
  HTTP: ['h t t p', 'http'],
  HTTPS: ['h t t p s', 'https']
};

const AMBIGUOUS = [
  {
    canonical: 'RAG',
    aliases: ['red'],
    protect: /\bred[\s-]+black\b/i,
    context: /\bRAG\b|检索|召回|知识库|向量|embedding|BM25|FAISS|LangGraph|Agent|大模型|LLM|RepoPilot|(?:为什么|为何|怎么|如何|项目|技术|框架).{0,8}\bred\b|\bred\b.{0,8}(?:为什么|为何|怎么|如何|检索|召回|知识库|向量|Agent|LLM)/i
  },
  {
    canonical: 'FAISS',
    aliases: ['face'],
    protect: /人脸|face\s+(?:recognition|detection|image|photo)/i,
    context: /\bFAISS\b|向量|embedding|BM25|RRF|检索|召回|索引|RepoPilot/i
  }
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceContext(options = {}) {
  if (typeof options === 'string') return options;
  const settings = options.settings || {};
  return [
    options.contextText || '',
    options.recentText || '',
    settings.resumeText || '',
    settings.projectKnowledge || '',
    settings.jobDescription || '',
    Array.isArray(settings.sttVocabulary) ? settings.sttVocabulary.join(' ') : (settings.sttVocabulary || ''),
    Array.isArray(settings.qwenAsr?.vocabulary) ? settings.qwenAsr.vocabulary.join(' ') : ''
  ].filter(Boolean).join('\n');
}

function replaceAlias(text, alias, canonical) {
  const escaped = escapeRegExp(alias).replace(/\\ /g, '\\s+');
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
  return text.replace(pattern, canonical);
}

function normalizeTechnicalVocabulary(text = '', options = {}) {
  let out = String(text || '');
  if (!out) return '';

  for (const [canonical, aliases] of Object.entries(TERMS)) {
    for (const alias of aliases) out = replaceAlias(out, alias, canonical);
  }

  const context = `${sourceContext(options)}\n${out}`;
  for (const rule of AMBIGUOUS) {
    if (rule.protect && rule.protect.test(out)) continue;
    if (!rule.context.test(context)) continue;
    for (const alias of rule.aliases) out = replaceAlias(out, alias, rule.canonical);
  }

  return out;
}

module.exports = { normalizeTechnicalVocabulary, TERMS };
