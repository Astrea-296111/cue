'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrefetchQuery } = require('../src/project-query');

test('RAG prefetch accepts the renderer object payload instead of silently dropping it', () => {
  assert.equal(buildPrefetchQuery({ text: '介绍 RepoPilot 项目', previous: ['旧问题'] }), '介绍 RepoPilot 项目');
});

test('short follow-up prefetch carries a small amount of previous question context', () => {
  assert.equal(
    buildPrefetchQuery({ text: '那重试呢？', previous: ['介绍 RepoPilot 项目', '它的任务执行链路是什么？'] }),
    '那重试呢？\n介绍 RepoPilot 项目\n它的任务执行链路是什么？'
  );
});

test('legacy bare-string prefetch payload remains compatible', () => {
  assert.equal(buildPrefetchQuery('为什么用 RAG？'), '为什么用 RAG？');
});
