'use strict';

// Offline by default. --prepare is the only option allowed to fetch model files.
// The runtime check uses Microsoft's 130-byte multiply fixture, not an embedding model.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { createProjectEmbeddings, EmbeddingWorkerQueue } = require('../src/project-embeddings');

const args = process.argv.slice(2);
const option = name => args.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const FIXTURE_BASE64 = 'CAMSBmNoZW50YTpwChUKAVgKAVcSAVkaBW11bF8xIgNNdWwSCG11bCB0ZXN0KiMIAwgCEAEiGAAAgD8AAABAAABAQAAAgEAAAKBAAADAQEIBV1oTCgFYEg4KDAgBEggKAggDCgIIAmITCgFZEg4KDAgBEggKAggDCgIIAkIECgAQBw==';

async function runtimeCheck() {
  const sourceDirectory = option('app-dir') || path.join(__dirname, '..');
  const workerFile = path.join(sourceDirectory, 'src/project-embedding-worker.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const queue = new EmbeddingWorkerQueue({ workerFactory: () => new Worker(workerFile) });
  try {
    const native = await queue.run('runtime-check', { modelBytes: Buffer.from(FIXTURE_BASE64, 'base64') }, { deadlineAt: Date.now() + 30000 });
    if (JSON.stringify(native.values) !== '[1,4,9,16,25,36]') throw new Error('ONNX 推理结果错误');
    console.log(JSON.stringify({ check: 'native-runtime', ...native, fixtureSha256: '71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10', runtime: '1.21.0' }));
    const result = await queue.run('warm', { directory: path.join(os.tmpdir(), 'cue-no-model-runtime-check'), identity: 'runtime-check' }, { deadlineAt: Date.now() + 30000 });
    throw new Error(`不存在的模型意外加载：${result}`);
  } catch (error) {
    if (!/local_files_only|Local file|not found|Could not locate/i.test(error.message) || /Cannot find module|NODE_MODULE_VERSION|DLL|wrong ELF/i.test(error.message)) throw error;
  } finally { await queue.close(); }
}

async function modelCheck() {
  const modelDirectory = option('model-dir');
  if (!modelDirectory && !args.includes('--prepare')) throw new Error('请显式指定 --model-dir=已准备目录；下载须单独使用 --prepare');
  const directory = option('data-dir') || await fs.mkdtemp(path.join(os.tmpdir(), 'cue-semantic-smoke-'));
  const service = createProjectEmbeddings({ directory, revisionProvider: () => 'semantic-smoke-v1' });
  try {
    const coldStarted = performance.now();
    await service.prepare({ directory: modelDirectory, onProgress: progress => {
      if (progress.phase !== 'download' || progress.received === progress.total) console.error(JSON.stringify(progress));
    } });
    const coldMs = performance.now() - coldStarted;
    const snapshot = { revision: 'semantic-smoke-v1', chunkerVersion: 4, parserVersion: 'smoke', metadataSchemaVersion: 4, projects: [{ id: 'cache' }, { id: 'agent' }], chunks: [
      { id: 'cache-version', projectId: 'cache', path: 'cache/cache.md', text: '每次缓存读取时比较 MySQL 中的版本，版本不一致则丢弃旧缓存并从数据库加载。' },
      { id: 'agent-state', projectId: 'agent', path: 'agent/graph.md', text: 'LangGraph 保存多步骤工具调用的状态，并通过条件边决定下一节点。' },
    ] };
    const indexed = await service.indexSnapshot(snapshot);
    if (!indexed.ready) throw new Error(`向量索引不可用：${indexed.reason}`);
    const latencies = [], queries = ['缓存里的旧数据怎么失效？', 'How do outdated cached values become invalid?', '为什么需要有状态的工作流？'];
    for (let iteration = 0; iteration < 5; iteration++) for (const query of queries) {
      const scopes = query.includes('工作流') ? ['@project:agent'] : ['@project:cache'];
      const started = performance.now();
      const result = await service.queryCandidates({ query, scopes, deadlineAt: Date.now() + 1000 });
      latencies.push(performance.now() - started);
      if (result.rows.length !== 1 || result.rows[0].chunk.projectId !== scopes[0].slice(9)) throw new Error(`模型候选缺失或越界：${result.reason}`);
    }
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ check: 'real-multilingual-e5', status: service.status(), coldWarmMs: coldMs, indexed, sampleCount: latencies.length, p50Ms: latencies[Math.floor(latencies.length / 2)], p95Ms: latencies[Math.ceil(latencies.length * .95) - 1], note: '小样本离线推理与作用域验证；不是准确率或跨硬件延迟保证' }, null, 2));
  } finally { await service.close(); }
}

(async () => {
  if (args.includes('--runtime-only')) await runtimeCheck();
  else await modelCheck();
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => { if (process.versions.electron) require('electron').app.exit(Number(process.exitCode) || 0); });
