'use strict';

// Real package entry, scoped retrieval, budgeting and SDK serialization. Model
// transport is a deterministic local fixture; no API/ASR/model download occurs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { createEvidenceRuntime, CASES } = require('../test/helpers/realtime-evidence-runtime');
const { createInterviewRuntime } = require('../test/helpers/interview-agent-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] || 0;
const summary = values => ({ n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(0, ...values) });
const argument = (name, fallback) => { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1]; };
const samples = Number(argument('samples', 300)), coldSamples = Number(argument('cold-samples', 20));
const sizes = String(argument('sizes', 'small,4000,14000')).split(',');
const output = argument('out', path.join(os.tmpdir(), 'cue-realtime-evidence.json'));
if (!Number.isInteger(samples) || samples < 1 || samples > 2000 || !Number.isInteger(coldSamples) || coldSamples < 1 || coldSamples > 100) throw new Error('invalid sample count');
const cleanup = () => { const callbacks = []; return { after: fn => callbacks.push(fn), close: async () => { for (const fn of callbacks) await fn(); } }; };
const metrics = r => {
  const line = r.logs.findLast(args => String(args[0]).startsWith('[latency][prompt] '))?.[0];
  return line ? JSON.parse(line.slice(18)) : null;
};
function record(m) {
  return { prepareMs: m.prepareMs, contextMs: m.contextMs, inputTokensEstimate: m.finalBudget.estimatedInputTokens,
    path: m.retrieval.retrievalPath, poolLookupMs: m.retrieval.poolLookupMs || 0,
    retrievalMs: m.retrieval.retrievalMs || 0, lexicalMs: m.retrieval.lexicalMs || 0,
    searchCalls: m.retrieval.searchCalls, sources: m.finalBudget.selectedSourceCount };
}
const answer = '缓存读取通过 CacheService 核验版本，命中返回，失效后重新加载；选择缓存为了多进程版本一致，代价是连接与失效处理。';

async function makeSnapshot(size) {
  const t = cleanup();
  try {
    const r = await createEvidenceRuntime(t);
    const index = JSON.parse(JSON.stringify(r.exports('src/project-knowledge.js').getProjectIndexSnapshot().index));
    const target = size === 'small' ? index.chunks.length : Number(size);
    if (![index.chunks.length, 4000, 14000].includes(target)) throw new Error('unsupported benchmark size');
    const own = Object.fromEntries(index.projects.map(p => [p.id, index.chunks.filter(c => c.projectId === p.id).length]));
    for (let i = index.chunks.length; i < target; i++) {
      const project = index.projects[i % 2], n = own[project.id]++;
      index.chunks.push({ id: project.id + ':noise-' + n, projectId: project.id, projectName: project.name,
        path: `src/Noise${Math.floor(n / 4)}.java`, kind: 'method', symbol: `Noise${Math.floor(n / 4)}#method${n % 4}`,
        startLine: n % 4 * 8 + 1, endLine: n % 4 * 8 + 5, docType: 'implementation', truthScope: 'implemented', status: 'confirmed',
        text: `public String method${n % 4}() { return catalog.lookup("noise-${n}"); }`,
        retrievalText: `${project.name}\n无关目录条目 ${n} public String method${n % 4}() { return catalog.lookup("noise-${n}"); }` });
    }
    for (const project of index.projects) {
      project.stats.chunkCount = own[project.id]; project.stats.fileCount = Math.ceil(own[project.id] / 4) + 12;
      if (project.stats.chunkCount > 7000 || project.stats.fileCount > 1800) throw new Error('benchmark exceeds per-import limits');
    }
    return index;
  } finally { await t.close(); }
}

async function warm(index, enabled, expectedPath) {
  const t = cleanup(), delay = monitorEventLoopDelay({ resolution: 1 });
  const r = createInterviewRuntime(t, { indexSnapshot: index, settings: { realtimeEvidencePrefetch: enabled } });
  const rows = []; let cpuStart;
  try {
    await r.ready;
    r.answer(answer);
    await r.ask('say', '松塔订单的缓存如何实现？');
    delay.enable(); cpuStart = process.cpuUsage();
    for (let i = 0; i < samples; i++) {
      const question = expectedPath === 'pool-partial' ? '松塔订单的缓存为什么这样选？'
        : '松塔订单的缓存版本校验如何实现？';
      if (expectedPath === 'lexical-fallback') r.value('activeProjectContextCache.clear(); ragSession.reset()');
      if (expectedPath === 'pool-partial') r.value(`for (const entry of activeProjectContextCache.entries.values()) {
        entry.evidence = entry.evidence.filter(source => source.docType === 'implementation'); delete entry.search;
      }`);
      if (expectedPath === 'exact-ready') {
        await r.prefetch({ text: question, final: true });
        for (let turn = 0; turn < 10 && r.value('!!ragSession.running || !!ragSession.pending'); turn++) await tick();
      }
      await r.ask('say', question);
      rows.push(record(metrics(r)));
      await tick();
    }
    const cpu = process.cpuUsage(cpuStart);
    return { enabled, intendedPath: expectedPath, chunks: index.chunks.length, samples: rows,
      prepareMs: summary(rows.map(row => row.prepareMs)), poolLookupMs: summary(rows.map(row => row.poolLookupMs)),
      paths: Object.fromEntries([...new Set(rows.map(row => row.path))].map(p => [p, rows.filter(row => row.path === p).length])),
      cpuMs: (cpu.user + cpu.system) / 1000, eventLoopMs: { p50: delay.percentile(50) / 1e6, p95: delay.percentile(95) / 1e6, max: delay.max / 1e6 } };
  } finally { delay.disable(); await t.close(); }
}

async function cold(index, enabled) {
  const rows = [];
  for (let i = 0; i < coldSamples; i++) {
    const t = cleanup();
    try {
      const r = createInterviewRuntime(t, { indexSnapshot: index, coldIndex: true, settings: { realtimeEvidencePrefetch: enabled } });
      const knowledge = r.exports('src/project-knowledge.js');
      const start = performance.now(); knowledge.getProjectCatalog();
      const catalogLoadMs = performance.now() - start;
      await r.ask('say', '松塔订单的缓存如何实现？');
      const row = record(metrics(r)), warmStart = performance.now();
      await knowledge.warmProjectIndex();
      rows.push({ ...row, catalogLoadMs, backgroundWarmMs: performance.now() - warmStart });
    } finally { await t.close(); }
  }
  return { enabled, chunks: index.chunks.length, samples: rows, prepareMs: summary(rows.map(row => row.prepareMs)),
    backgroundWarmMs: summary(rows.map(row => row.backgroundWarmMs)),
    note: 'Cold postings; catalog JSON load reported separately. Enabled path reports unavailable evidence instead of a synchronous cold build.' };
}

async function quality(enabled) {
  const t = cleanup(), rows = [];
  try {
    const r = await createEvidenceRuntime(t, { settings: { realtimeEvidencePrefetch: enabled } });
    for (const item of CASES) {
      r.clear(); r.answer(answer);
      await r.ask('say', item.project + '的缓存如何实现？');
      await r.ask('say', item.project + '的' + item.question);
      const event = r.evidence(), sent = r.sdkText(), m = r.metrics();
      const found = item.facts.filter(fact => sent.includes(item.prefix + '_' + fact)).length;
      rows.push({ split: item.split, expectedFacts: item.facts.length, foundFacts: found,
        allFacts: found === item.facts.length, missingExpected: !!item.missing, missingReported: event.missing.length > 0,
        poolSufficient: m.retrieval.poolSufficientHit, falseSufficient: m.retrieval.poolSufficientHit &&
          (found < item.facts.length || item.missing && !event.missing.length),
        crossProject: event.sources.some(source => source.projectName !== item.project),
        sourceLocationError: event.sources.some(source => !sent.includes(source.text) || !source.path || !source.startLine),
        path: m.retrieval.retrievalPath });
    }
    const facts = rows.reduce((n, row) => n + row.expectedFacts, 0);
    const multi = rows.filter(row => row.expectedFacts > 1), missing = rows.filter(row => row.missingExpected);
    return { enabled, cases: rows.length, factCoverage: rows.reduce((n, row) => n + row.foundFacts, 0) / facts,
      multiQuestionCompleteCoverage: multi.filter(row => row.allFacts).length / multi.length,
      falseSufficientRate: rows.filter(row => row.falseSufficient).length / rows.length,
      missingAccuracy: missing.filter(row => row.missingReported).length / missing.length,
      crossProjectLeaks: rows.filter(row => row.crossProject).length, sourceLocationErrors: rows.filter(row => row.sourceLocationError).length, rows };
  } finally { await t.close(); }
}

async function leadTime(enabled, leadMs) {
  const t = cleanup();
  try {
    const r = await createEvidenceRuntime(t, { settings: { realtimeEvidencePrefetch: enabled }, semanticRetriever: {
      status: () => ({ modelVersion: 'controlled-350ms' }), resetSession() {},
      queryCandidates: async () => { await new Promise(resolve => setTimeout(resolve, 350)); return { rows: [], reason: 'controlled-no-vector' }; }
    } });
    r.final('松塔订单的缓存如何实现？');
    if (leadMs) await new Promise(resolve => setTimeout(resolve, leadMs));
    await r.shortcut('CommandOrControl+Return');
    return { enabled, leadMs, ...record(r.metrics()), exactPrefetchHit: r.metrics().retrieval.exactPrefetchHit };
  } finally { await t.close(); }
}

(async () => {
  const contention = process.argv.includes('--cpu-contention') ? new Worker(`
    const {parentPort}=require('node:worker_threads'); let running=true;
    parentPort.on('message',()=>running=false);
    function burn(){const end=Date.now()+15;let n=0;while(Date.now()<end)n+=Math.sqrt(n+Math.random());if(running)setImmediate(burn);else parentPort.close();} burn();
  `, { eval: true }) : null;
  try {
    const result = { scope: 'Linux offline package-entry fixture. No real ASR, ONNX embedding, cloud LLM, WAN or Windows UI.',
      generatedAt: new Date().toISOString(), baseRef: 'ea1edaa02e72f89c3906af10bd62dc616b3bd43a',
      sourceHashes: Object.fromEntries(['main.js', 'src/project-prefetch-policy.js', 'src/retrieval-coordinator.js',
        'src/active-project-context-cache.js', 'src/project-rag-session.js', 'src/project-knowledge.js', 'src/project-search.js',
        'src/project-embeddings.js', 'src/project-embedding-worker.cjs', 'src/evidence-selector.js',
        'src/interview-context.js', 'scripts/benchmark-realtime-evidence.cjs'].map(file =>
        [file, createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')])),
      node: process.version, platform: process.platform, cpuCount: os.cpus().length, cpuContention: !!contention,
      configuration: { samples, coldSamples }, warm: [], cold: [], quality: [], leadTime: [] };
    for (const size of sizes) {
      const index = await makeSnapshot(size);
      for (const enabled of [false, true]) {
        for (const retrievalPath of ['exact-ready', 'pool-covered', 'pool-partial', 'lexical-fallback']) {
          result.warm.push(await warm(index, enabled, retrievalPath));
          process.stderr.write(`measured ${size} ${enabled ? 'on' : 'off'} ${retrievalPath}\n`);
        }
        result.cold.push(await cold(index, enabled));
      }
    }
    for (const enabled of [false, true]) {
      result.quality.push(await quality(enabled));
      for (const lead of [0, 100, 300, 800]) result.leadTime.push(await leadTime(enabled, lead));
    }
    await fs.promises.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.promises.writeFile(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, warm: result.warm.map(({ samples, ...item }) => item), quality: result.quality.map(({ rows, ...item }) => item) }, null, 2));
  } finally { await contention?.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
