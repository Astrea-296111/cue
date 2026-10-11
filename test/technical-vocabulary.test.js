'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTechnicalVocabulary } = require('../src/technical-vocabulary');
const { isSpeechNoise } = require('../src/speech-noise-filter');
const { buildQwenContext } = require('../src/stt-providers/qwen');

test('Chinese-accent RAG/FAISS/Function Call aliases normalize in technical context', () => {
  assert.equal(normalizeTechnicalVocabulary('为什么用 red？'), '为什么用 RAG？');
  assert.equal(normalizeTechnicalVocabulary('为什么用 function cool？'), '为什么用 Function Call？');
  assert.equal(
    normalizeTechnicalVocabulary('BM25 和 face 怎么做融合？', { contextText: 'RepoPilot 使用 BM25、FAISS、RRF' }),
    'BM25 和 FAISS 怎么做融合？'
  );
});

test('ambiguous English words are protected outside the intended technical meaning', () => {
  assert.equal(normalizeTechnicalVocabulary('red-black tree 是什么？'), 'red-black tree 是什么？');
  assert.equal(
    normalizeTechnicalVocabulary('face recognition 怎么做？', { contextText: '计算机视觉' }),
    'face recognition 怎么做？'
  );
});

test('resume-specific technical terms are normalized', () => {
  const text = normalizeTechnicalVocabulary('repo pilot 用 lang graph、b m 25、f a i s s、r r f 和 fast api');
  assert.match(text, /RepoPilot/);
  assert.match(text, /LangGraph/);
  assert.match(text, /BM25/);
  assert.match(text, /FAISS/);
  assert.match(text, /RRF/);
  assert.match(text, /FastAPI/);
});

test('noise filter keeps real short technical terms but drops known artifacts', () => {
  for (const term of ['Go', 'DP', 'GC', 'IO', 'AI', 'QF']) assert.equal(isSpeechNoise(term), false, term);
  for (const artifact of ['ops', 'ok', '嗯', '呃']) assert.equal(isSpeechNoise(artifact), true, artifact);
});

test('Qwen context contains resume/project vocabulary used by this candidate', () => {
  const context = buildQwenContext({});
  for (const term of ['RAG', 'MCP', 'BM25', 'FAISS', 'LangGraph', 'MDS', 'RMM', 'UERD', 'RepoPilot']) {
    assert.ok(context.includes(term), term);
  }
});
