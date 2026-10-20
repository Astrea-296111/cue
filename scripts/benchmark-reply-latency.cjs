'use strict';

// Offline application benchmark: real entry/planning/retrieval/request assembly,
// fixture SDK transport. This does NOT measure a real provider's TTFT or ASR.
const { performance } = require('node:perf_hooks');
const { createInterviewRuntime } = require('../test/helpers/interview-agent-runtime');

async function measure(name, options, questions) {
  const cleanup = [];
  const runtime = createInterviewRuntime({ after: fn => cleanup.push(fn) }, options);
  const rows = [];
  try {
    for (const question of questions) {
      runtime.answer('缓存版本在事务中更新，读取时校验版本，过期后重新加载。'.repeat(45));
      const started = performance.now();
      await runtime.ask('say', question);
      const line = runtime.logs.filter(args => String(args[0]).startsWith('[latency][prompt] ')).at(-1)?.[0];
      if (!line) throw new Error('Application did not send a model request');
      const metrics = JSON.parse(line.slice('[latency][prompt] '.length));
      rows.push({ prepareMs: metrics.prepareMs, fixtureRoundTripMs: +(performance.now() - started).toFixed(2),
        promptChars: metrics.promptChars, inputTokensEstimate: metrics.finalBudget.estimatedInputTokens,
        historyChars: metrics.historyChars, lexicalMs: metrics.retrieval.lexicalMs || 0,
        semanticWaitMs: metrics.retrieval.semanticWaitMs || 0 });
    }
    return { name, samples: rows.length, rows };
  } finally { cleanup.forEach(fn => fn()); }
}

(async () => {
  const blockedSemantic = { status: () => ({ modelReady: true, modelVersion: 'benchmark-unavailable' }),
    queryCandidates: () => new Promise(() => {}), resetSession() {} };
  const result = { scope: 'Offline fixture; real ASR, provider inference, network and Windows UI excluded', cases: [
    await measure('cold-semantic-worker', { semanticRetriever: blockedSemantic },
      ['TCS 项目的缓存一致性如何设计？', 'TCS 的缓存版本怎么校验？', 'TCS 版本过期后如何重新加载？']),
    await measure('project-followups', {}, ['TCS 的缓存一致性如何设计？', '这个方案为什么要检查版本？',
      '刚才的方案出现版本不一致时如何处理？', '那这个实现的失败边界是什么？'])
  ] };
  if (process.argv.includes('--large-index')) {
    const chunks = Array.from({ length: 4000 }, (_, i) => ({ id: 'tcs-' + i, projectId: 'tcs', projectName: 'TCS',
      path: `src/service${i}.java`, docType: 'implementation', truthScope: 'implemented', status: 'confirmed', startLine: 1, endLine: 4,
      text: `TCS CacheService${i} 事务校验数据库缓存版本，版本失效后查询 MySQL。 ` +
        'public String find(long id) { return database.read(id); } '.repeat(7) }));
    const indexSnapshot = { version: 2, chunkerVersion: 4, metadataSchemaVersion: 4,
      projects: [{ id: 'tcs', name: 'TCS', aliases: ['TCS'], hasManifest: true, sourceType: 'folder',
        stats: { fileCount: chunks.length, chunkCount: chunks.length } }], chunks,
      stats: { fileCount: chunks.length, chunkCount: chunks.length } };
    result.cases.push(await measure('4000-source-chunks', { indexSnapshot },
      ['TCS 的缓存读取如何实现？', 'TCS 的缓存版本更新如何实现？']));
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
