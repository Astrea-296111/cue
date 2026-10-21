'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { createProjectEmbeddings, EmbeddingWorkerQueue, loadVectorStore } = require('../src/project-embeddings');
const { verifyModelDirectory, prepareModel, readSelectedModel, MODEL_FILES } = require('../src/project-embedding-model');

// Deterministic transport vectors exercise persistence/lifecycle, not semantic quality.
class FixtureWorker extends EventEmitter {
  constructor(delay = 0) { super(); this.delay = delay; this.calls = []; this.cancelled = []; this.embeddingIdentities = []; }
  unref() {} ref() {}
  postMessage(message) {
    if (message.op === 'cancel') { this.cancelled.push(message.id); return; }
    this.calls.push(message);
    this.emit('operation-start', message);
    setTimeout(() => {
      if (message.op === 'warm') { this.currentModelIdentity = message.payload.identity; this.emit('message', { id: message.id, result: null }); return; }
      if (message.op === 'clear-index') { this.index = null; this.emit('message', { id: message.id, result: null }); return; }
      if (message.op === 'install-index') { this.index = message.payload; this.emit('message', { id: message.id, result: { rows: this.index.records.length } }); return; }
      if (message.op === 'scan') {
        const { inProjectScope } = require('../src/project-scope');
        const rows = this.index.records.flatMap((record, row) => {
          if (!inProjectScope(record, message.payload.scopes)) return [];
          let similarity = 0;
          for (let col = 0; col < 384; col++) similarity += message.payload.vector[col] * this.index.matrix[row * 384 + col];
          return [{ id: record.id, similarity, score: similarity }];
        }).sort((a, b) => b.similarity - a.similarity).slice(0, message.payload.limit);
        this.emit('message', { id: message.id, result: { rows, revision: this.index.revision, modelVersion: this.index.modelVersion,
          stats: { scanned: rows.length, semanticWorkerMs: 0 } } }); return;
      }
      this.embeddingIdentities.push(this.currentModelIdentity);
      const matrix = new Float32Array(message.payload.texts.length * 384);
      const records = [];
      message.payload.texts.forEach((text, textIndex) => {
        matrix[textIndex * 384 + (/redis/i.test(text) ? 0 : 1)] = 1;
        records.push({ textIndex, tokenStart: 0, tokenEnd: 8 });
      });
      this.emit('message', { id: message.id, result: { matrix, records } });
    }, this.delay);
  }
  async terminate() { this.emit('exit', 0); }
}
const model = { directory: '/fixture', identity: 'fixture-model-q8', manifest: { revision: 'a'.repeat(40) } };
async function fixture(t, delay = 0) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-vectors-'));
  const worker = new FixtureWorker(delay);
  let revision = 'r1';
  const service = createProjectEmbeddings({ directory, workerFactory: () => worker, modelLoader: async () => model, modelPreparer: async () => model, revisionProvider: () => revision });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, worker, service, setRevision: value => { revision = value; } };
}
const snapshot = () => ({ revision: 'r1', chunkerVersion: 4, parserVersion: 'lexical-2', metadataSchemaVersion: 4, projects: [{ id: 'alpha', revision: 'sha1' }, { id: 'beta', revision: 'sha2' }], chunks: [
  { id: 'a-redis', projectId: 'alpha', path: 'alpha/cache.md', text: 'Redis 缓存和版本校验' },
  { id: 'b-agent', projectId: 'beta', path: 'beta/graph.md', text: 'LangGraph agent 状态流转' },
] });

test('unprepared and unscoped semantic paths do not start a worker or download', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-unprepared-'));
  let starts = 0;
  let fetches = 0;
  const service = createProjectEmbeddings({ directory, fetchImpl: () => { fetches++; throw new Error('unexpected download'); }, workerFactory: () => { starts++; throw new Error('unexpected worker'); } });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await service.queryCandidates({ query: '缓存', scopes: ['@project:alpha'] })).reason, 'model-not-prepared');
  assert.equal((await service.queryCandidates({ query: '缓存' })).reason, 'unscoped-disabled');
  assert.equal((await service.warm()).state, 'not-prepared');
  assert.equal(starts, 0);
  assert.equal(fetches, 0);
});

test('scoped Float32 search and cache are bound to the exact snapshot revision', async t => {
  const { service, setRevision } = await fixture(t);
  await service.warm();
  assert.equal((await service.indexSnapshot(snapshot())).ready, true);
  const a = await service.queryCandidates({ query: 'redis', scopes: ['@project:alpha'], deadlineAt: Date.now() + 1000 });
  assert.equal(a.rows[0].id, 'a-redis'); assert.equal(a.rows.length, 1); assert.equal(a.revision, 'r1');
  assert.equal(a.stats.queryCacheHit, false);
  assert.equal((await service.queryCandidates({ query: 'redis', scopes: ['@project:alpha'] })).stats.queryCacheHit, true);
  setRevision('r2');
  assert.equal((await service.queryCandidates({ query: 'redis', scopes: ['@project:alpha'] })).reason, 'revision-mismatch');
  assert.equal(service.status().ready, false);
});

test('many distinct background queries keep the query-vector cache and worker queue bounded', async t => {
  const { service } = await fixture(t);
  await service.warm(); await service.indexSnapshot(snapshot());
  for (let i = 0; i < 90; i++) {
    await service.queryCandidates({ query: 'redis fixture ' + i, scopes: ['@project:alpha'], deadlineAt: Date.now() + 1000 });
    assert.ok(service.queryCache.size <= 64); assert.ok(service.queue.queue.length <= 8);
  }
  assert.equal(service.queryCache.size, 64); assert.equal(service.queue.active, null);
});

test('incremental snapshots reuse unchanged content, remove deleted rows and rebuild corrupt matrices', async t => {
  const { service, setRevision, directory } = await fixture(t);
  await service.warm();
  assert.equal((await service.indexSnapshot(snapshot())).computed, 2);
  setRevision('r2');
  const next = snapshot(); next.revision = 'r2'; next.chunks = [next.chunks[0], { id: 'a-new', projectId: 'alpha', path: 'alpha/new.md', text: '新增 Redis 实现' }];
  const result = await service.indexSnapshot(next);
  assert.equal(result.reused, 1); assert.equal(result.computed, 1);
  assert.deepEqual((await service.queryCandidates({ query: 'agent', scopes: ['@project:beta'] })).rows, []);
  const pointer = JSON.parse(await fs.readFile(path.join(directory, 'vectors/current.json'), 'utf8'));
  await fs.writeFile(path.join(directory, 'vectors', pointer.generation, 'matrix.f32'), Buffer.alloc(8));
  assert.equal(await loadVectorStore(path.join(directory, 'vectors'), model.identity), null);
  setRevision('r3'); next.revision = 'r3';
  assert.equal((await service.indexSnapshot(next)).computed, 2);
});

test('timeout cancels native-result ownership and physically removes queued work', async t => {
  const worker = new FixtureWorker(30), queue = new EmbeddingWorkerQueue({ workerFactory: () => worker });
  t.after(() => queue.close());
  const active = queue.run('embed', { texts: ['redis'], kind: 'query' }, { deadlineAt: Date.now() + 5 });
  const controller = new AbortController();
  const queued = queue.run('embed', { texts: ['never-run'], kind: 'query' }, { signal: controller.signal });
  const rejected = assert.rejects(queued, /cancelled/);
  controller.abort(new Error('cancelled'));
  await assert.rejects(active, /semantic-timeout/); await rejected;
  assert.equal(queue.queue.length, 0); assert.equal(worker.calls.length, 1); assert.equal(worker.cancelled.length, 1);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(queue.active, null);
});

test('import invalidation prevents late query vectors and old texts from becoming current', async t => {
  const { service, worker, setRevision } = await fixture(t, 15);
  await service.warm(); await service.indexSnapshot(snapshot());
  const pending = service.queryCandidates({ query: 'redis', scopes: ['@project:alpha'], deadlineAt: Date.now() + 1000 });
  service.invalidate('new-import'); setRevision('r2');
  assert.equal((await pending).reason, 'stale-result');
  assert.equal(service.queryCache.size, 0); assert.equal(service.status().ready, false);
  assert.ok(worker.calls.length >= 3);
});

test('explicit preparation propagates worker model load failure', async t => {
  const { service, worker } = await fixture(t);
  worker.postMessage = function(message) { this.emit('message', { id: message.id, error: { message: 'missing native model', name: 'Error' } }); };
  await assert.rejects(service.prepare(), /missing native model/);
  assert.equal(service.status().ready, false);
});

test('parser changes rebuild vectors and wrapped knowledge snapshots preserve version metadata', async t => {
  const { service, setRevision } = await fixture(t);
  await service.warm();
  const first = snapshot();
  assert.equal((await service.indexSnapshot({ index: first, chunks: first.chunks, projects: first.projects, revision: first.revision })).computed, 2);
  setRevision('r2');
  const next = snapshot(); next.revision = 'r2'; next.parserVersion = 'lexical-3';
  const result = await service.indexSnapshot({ index: next, chunks: next.chunks, projects: next.projects, revision: next.revision });
  assert.equal(result.computed, 2); assert.equal(result.reused, 0);
});

test('native worker crash invalidates readiness and keeps the base retrieval fallback usable', async t => {
  const { service, worker } = await fixture(t);
  await service.warm(); await service.indexSnapshot(snapshot());
  worker.emit('error', new Error('native-worker-failed'));
  assert.equal(service.status().state, 'failed'); assert.equal(service.status().ready, false);
  const result = await service.queryCandidates({ query: 'redis', scopes: ['@project:alpha'] });
  assert.deepEqual(result.rows, []); assert.equal(result.reason, 'model-not-warm');
});

test('indexing emits bounded batch progress and stops reporting after snapshot invalidation', async t => {
  const { service, worker } = await fixture(t, 10);
  await service.warm();
  const current = snapshot();
  current.chunks = Array.from({ length: 18 }, (_, index) => ({ id: `alpha-${index}`, projectId: 'alpha', path: `alpha/file-${index}.md`, text: `Redis 版本校验 ${index}` }));
  const progress = [];
  assert.equal((await service.indexSnapshot(current, { onProgress: value => progress.push(value) })).ready, true);
  assert.deepEqual(progress.map(value => value.completed), [0, 8, 16, 18]);
  assert.ok(progress.every(value => value.phase === 'indexing' && value.total === 18));
  assert.equal(progress[0].percent, 0); assert.equal(progress.at(-1).percent, 100);
  service.invalidate('new-import');
  const next = snapshot(); next.chunks[0].text = 'Changed Redis source';
  const staleProgress = [];
  const pending = service.indexSnapshot(next, { onProgress: value => staleProgress.push(value) });
  // Let the persisted-cache read finish and the native fixture batch start.
  await new Promise(resolve => setTimeout(resolve, 3));
  service.invalidate('clear-projects');
  assert.equal((await pending).reason, 'index-stale');
  const count = staleProgress.length;
  await new Promise(resolve => setTimeout(resolve, worker.delay + 5));
  assert.equal(staleProgress.length, count);
});

test('selecting a new verified model replaces already warm weights and invalidates old matrices and query cache', async t => {
  const { service, worker } = await fixture(t);
  await service.warm(); await service.indexSnapshot(snapshot());
  await service.queryCandidates({ query: 'Redis', scopes: ['@project:alpha'] });
  assert.ok(service.queryCache.size);
  const next = { directory: '/fixture-v2', identity: 'fixture-model-v2', manifest: { revision: 'c'.repeat(40) } };
  service.modelPreparer = async () => next;
  assert.equal((await service.prepare()).modelReady, true);
  assert.equal(service.warmedModelIdentity, next.identity); assert.equal(worker.currentModelIdentity, next.identity);
  assert.equal(service.vectors, null); assert.equal(service.queryCache.size, 0);
  const indexed = await service.indexSnapshot(snapshot());
  assert.equal(indexed.computed, 2); assert.equal(indexed.reused, 0);
  assert.equal(service.vectors.modelIdentity, next.identity);
  await service.queryCandidates({ query: 'Redis', scopes: ['@project:alpha'] });
  assert.equal(worker.embeddingIdentities.at(-1), next.identity);
  assert.deepEqual(worker.calls.filter(call => call.op === 'warm').map(call => call.payload.identity), [model.identity, next.identity]);
});

test('a pending startup warm cannot mark a newly selected model ready with old weights', async t => {
  const { service, worker } = await fixture(t, 15);
  const firstStarted = new Promise(resolve => worker.once('operation-start', resolve));
  const startup = service.warm();
  await firstStarted;
  const next = { directory: '/fixture-v2', identity: 'fixture-model-v2', manifest: { revision: 'c'.repeat(40) } };
  service.modelPreparer = async () => next;
  const nextStarted = new Promise(resolve => {
    const listener = call => { if (call.op === 'warm' && call.payload.identity === next.identity) { worker.removeListener('operation-start', listener); resolve(); } };
    worker.on('operation-start', listener);
  });
  const preparation = service.prepare();
  await nextStarted;
  assert.equal(service.status().modelReady, false); assert.equal(service.status().ready, false);
  assert.equal((await service.queryCandidates({ query: 'Redis', scopes: ['@project:alpha'] })).reason, 'model-not-warm');
  await startup; await preparation;
  assert.equal(service.status().modelVersion, next.identity); assert.equal(service.warmedModelIdentity, next.identity);
  await service.indexSnapshot(snapshot());
  assert.equal(service.vectors.modelIdentity, next.identity);
  assert.deepEqual(worker.embeddingIdentities, [next.identity]);
});

test('a late startup manifest read cannot overwrite an explicit model selection', async t => {
  const { service, worker } = await fixture(t);
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  service.modelLoader = () => reading;
  const startup = service.warm();
  const next = { directory: '/fixture-v2', identity: 'fixture-model-v2', manifest: { revision: 'c'.repeat(40) } };
  service.modelPreparer = async () => next;
  await service.prepare(); release(model); await startup;
  assert.equal(service.model.identity, next.identity); assert.equal(service.warmedModelIdentity, next.identity);
  assert.deepEqual(worker.calls.filter(call => call.op === 'warm').map(call => call.payload.identity), [next.identity]);
});

test('model directory verifies exact revision, tokenizer and weight checksums', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-model-manifest-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = {};
  for (const name of MODEL_FILES) {
    const bytes = Buffer.from(name === 'config.json' ? '{"hidden_size":384}' : '{}');
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
    files[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await fs.writeFile(path.join(directory, 'cue-model-manifest.json'), JSON.stringify({ schema: 1, model: 'Xenova/multilingual-e5-small', revision: 'a'.repeat(40), dtype: 'q8', files }));
  const verified = await verifyModelDirectory(directory); assert.match(verified.identity, /^[0-9a-f]{64}$/);
  await fs.writeFile(path.join(directory, 'tokenizer.json'), '{"changed":true}');
  await assert.rejects(verifyModelDirectory(directory), /校验失败/);
});

function downloadFixture() {
  const files = new Map(MODEL_FILES.map(name => [name, Buffer.from(name === 'config.json' ? '{"hidden_size":384}' : name === 'onnx/model_quantized.onnx' ? 'fixture-weights-not-a-real-model' : '{}')]));
  const metadata = { sha: 'b'.repeat(40), siblings: [...files].map(([rfilename, bytes]) => ({ rfilename, lfs: { sha256: createHash('sha256').update(bytes).digest('hex') } })) };
  return { files, metadata };
}

test('explicit preparation uses injected transport and pins exact revision plus file checksums; offline warm never fetches', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-explicit-download-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { files, metadata } = downloadFixture(), urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes('/api/models/')) return new Response(JSON.stringify(metadata));
    const prefix = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${metadata.sha}/`;
    assert.ok(url.startsWith(prefix)); return new Response(files.get(url.slice(prefix.length)));
  };
  const prepared = await prepareModel(directory, { fetchImpl });
  assert.equal(urls.length, 5); assert.equal(prepared.manifest.revision, metadata.sha);
  assert.equal(prepared.manifest.dtype, 'q8');
  for (const name of MODEL_FILES) assert.match(prepared.manifest.files[name].sha256, /^[a-f0-9]{64}$/);
  const warm = await readSelectedModel(directory);
  assert.equal(warm.identity, prepared.identity);
  const reused = await prepareModel(directory, { fetchImpl: () => { throw new Error('unexpected network'); } });
  assert.equal(reused.identity, prepared.identity);
});

test('model preparation is singleflight and forwards the constructor network transport only for explicit prepare', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-prepare-singleflight-'));
  const worker = new FixtureWorker(), fetchImpl = async () => { throw new Error('fixture network'); };
  let calls = 0, release;
  const service = createProjectEmbeddings({ directory, workerFactory: () => worker, fetchImpl, modelPreparer: async (_root, options) => {
    calls++; assert.equal(options.fetchImpl, fetchImpl);
    await new Promise(resolve => { release = resolve; }); return model;
  } });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const first = service.prepare(), second = service.prepare();
  assert.equal(first, second); assert.equal(calls, 1); release();
  assert.equal((await first).modelReady, true); assert.equal(service.preparing, null);
});

test('metadata timeout aborts the injected request and leaves no selected-model pointer', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-model-timeout-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let aborted = false;
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  await assert.rejects(prepareModel(directory, { fetchImpl, metadataTimeoutMs: 10 }), /获取模型版本超时/);
  assert.equal(aborted, true); await assert.rejects(fs.stat(path.join(directory, 'selected-model.json')), { code: 'ENOENT' });
});

test('download idle and total deadlines cancel stalled bodies and do not publish partial models', async t => {
  const { metadata } = downloadFixture();
  for (const [label, settings, pattern] of [
    ['idle', { downloadIdleMs: 10, downloadTimeoutMs: 1000 }, /长时间没有进度/],
    ['total', { downloadIdleMs: 1000, downloadTimeoutMs: 10 }, /总时限已到/],
  ]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `cue-model-${label}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let aborted = false;
    const fetchImpl = async (url, { signal }) => {
      if (url.includes('/api/models/')) return new Response(JSON.stringify(metadata));
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(Buffer.from('{'));
        signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason); }, { once: true });
      } }));
    };
    await assert.rejects(prepareModel(directory, { fetchImpl, ...settings }), pattern);
    assert.equal(aborted, true);
    assert.deepEqual(await fs.readdir(directory), []);
  }
});

test('actual Node worker reports not-warm and rejects missing local models without remote inference', { timeout: 30000 }, async t => {
  const worker = new Worker(path.join(__dirname, '../src/project-embedding-worker.cjs'));
  t.after(() => worker.terminate());
  const message = payload => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage(payload); });
  const runtime = await message({ id: 0, op: 'runtime-check', payload: { modelBytes: Buffer.from('CAMSBmNoZW50YTpwChUKAVgKAVcSAVkaBW11bF8xIgNNdWwSCG11bCB0ZXN0KiMIAwgCEAEiGAAAgD8AAABAAABAQAAAgEAAAKBAAADAQEIBV1oTCgFYEg4KDAgBEggKAggDCgIIAmITCgFZEg4KDAgBEggKAggDCgIIAkIECgAQBw==', 'base64') } });
  assert.deepEqual(runtime.result.values, [1, 4, 9, 16, 25, 36]);
  const notWarm = await message({ id: 1, op: 'embed', payload: { texts: ['cache'], kind: 'query' } });
  assert.equal(notWarm.error.message, 'model-not-warm');
  const missing = await message({ id: 2, op: 'warm', payload: { directory: path.join(os.tmpdir(), 'cue-definitely-missing-e5'), identity: 'missing-model' } });
  assert.ok(missing.error); assert.match(missing.error.message, /local_files_only|Local file|not found|Could not locate/i);
  assert.doesNotMatch(missing.error.message, /Cannot find module|NODE_MODULE_VERSION|DLL|wrong ELF/i);
});
