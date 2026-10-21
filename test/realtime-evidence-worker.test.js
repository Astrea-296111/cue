'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const { EmbeddingWorkerQueue } = require('../src/project-embeddings');
const { ProjectRagSession } = require('../src/project-rag-session');
const { RETRIEVAL_POLICY } = require('../src/project-prefetch-policy');
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (question, extras = {}) => ({ question, epoch: 1, projectRevision: 'r1', modelVersion: 'm1',
  sourceKey: 'meeting:one', questionVersion: question, contextBudget: 3600, hashFallback: false,
  projectPlan: { retrieve: true, scopes: ['@project:a'] }, ...extras });

test('actual worker scans installed scoped vectors, returns only IDs and leaves persistence matrix attached', async t => {
  const queue = new EmbeddingWorkerQueue(); t.after(() => queue.close());
  const records = Array.from({ length: 14000 }, (_, id) => ({ id, projectId: id % 2 ? 'b' : 'a', path: `src/file${id}.java` }));
  const matrix = new Float32Array(records.length * 384);
  for (let i = 0; i < records.length; i++) matrix[i * 384 + i % 2] = 1;
  const installed = await queue.run('install-index', { records, matrix, revision: 'r1', modelVersion: 'm1' });
  assert.equal(installed.rows, 14000); assert.equal(matrix.length, 14000 * 384);
  const vector = new Float32Array(384); vector[0] = 1;
  const result = await queue.run('scan', { vector, scopes: ['@project:a'], limit: 8,
    revision: 'r1', modelVersion: 'm1', deadlineAt: Date.now() + 2000 });
  assert.equal(result.rows.length, 8); assert.equal(result.stats.scanned, 7000);
  assert.ok(result.rows.every(row => row.id % 2 === 0 && row.similarity === 1 && !('chunk' in row) && !('text' in row)));
  await queue.run('clear-index', {});
  await assert.rejects(queue.run('scan', { vector, scopes: ['@project:a'], revision: 'r1', modelVersion: 'm1' }), /stale/);
});

test('unresponsive native worker has bounded recovery and cannot retain the active queue forever', async t => {
  class HungWorker extends EventEmitter { postMessage() {} ref() {} unref() {} async terminate() { this.terminated = true; } }
  const worker = new HungWorker(); let failures = 0;
  const queue = new EmbeddingWorkerQueue({ workerFactory: () => worker, recoveryMs: 20, onFailure: () => failures++ });
  t.after(() => queue.close());
  await assert.rejects(queue.run('embed', { texts: ['fixture'] }, { deadlineAt: Date.now() + 5 }), /semantic-timeout/);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(queue.active, null); assert.equal(queue.queue.length, 0); assert.equal(failures, 1); assert.equal(worker.terminated, true);
});

test('explicit recovery waits for old native worker termination before starting a replacement', async t => {
  let finishTermination, created = 0;
  class Fixture extends EventEmitter {
    postMessage(message) { if (message.op !== 'cancel' && created > 1) queueMicrotask(() => this.emit('message', { id: message.id, result: null })); }
    ref() {} unref() {}
    terminate() { return created === 1 ? new Promise(resolve => { finishTermination = resolve; }) : Promise.resolve(); }
  }
  const queue = new EmbeddingWorkerQueue({ workerFactory: () => { created++; return new Fixture(); } });
  t.after(() => queue.close());
  const first = queue.run('warm', {}), rejected = assert.rejects(first, /failed/);
  queue.fail(new Error('failed')); await rejected;
  const replacement = queue.run('warm', {});
  assert.equal(created, 1); finishTermination(); await replacement; assert.equal(created, 2);
});

test('continuous 100ms interim extensions start bounded work and eventually process latest text', async () => {
  const starts = [];
  const session = new ProjectRagSession({ retrieve: async request => { starts.push(request.question); return { evidence: [] }; } });
  let latest;
  for (let i = 0; i < 15; i++) {
    latest = input('项目缓存如何实现？' + '补充条件'.repeat(i));
    session.schedule(latest);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(starts.length >= 2 && starts.length <= 6, String(starts.length));
  assert.equal(starts.at(-1), latest.question); assert.ok(session.take(latest)); session.reset();
});

test('global pending/final priority supersedes predictions and project corrections without unbounded slots', async () => {
  const started = [], finish = [];
  const session = new ProjectRagSession({ retrieve: request => { started.push(request); return new Promise(resolve => finish.push(resolve)); } });
  session.schedule(input('Redis 如何实现？'), { immediate: true });
  session.schedule(input('Redis 如何实现？补充 TTL'), { origin: 'interim' });
  assert.equal(started[0].signal.aborted, false, 'ordinary extension does not starve active work');
  session.schedulePrediction(input('缓存的选型理由'));
  session.schedulePrediction(input('缓存的边界'));
  assert.equal(session.schedulePrediction(input('第三个猜测')), false);
  session.schedule(input('改为 MySQL 如何实现？'), { immediate: true });
  assert.equal(started[0].signal.aborted, true); assert.equal(session.predictions.length, 0);
  finish.shift()({ evidence: [] });
  for (let i = 0; i < 4 && started.length < 2; i++) await tick();
  assert.equal(started.length, 2); assert.equal(started[1].question, '改为 MySQL 如何实现？');
  session.reset(); finish.shift()({ evidence: ['late'] }); await tick();
  assert.equal(session.results.size, 0); assert.equal(session.slots.size, 0);
});

test('hung background retrieval frees its logical slot and clear rejects every late result', async () => {
  let runs = 0, late;
  const policy = { ...RETRIEVAL_POLICY, background: { budgetMs: 30 }, interim: { debounceMs: 1, minIntervalMs: 1, maxWaitMs: 2 } };
  const session = new ProjectRagSession({ policy, retrieve: async () => { runs++; if (runs === 1) return new Promise(resolve => { late = resolve; }); return { evidence: ['current'] }; } });
  session.schedule(input('first'), { immediate: true }); session.schedule(input('next'), { immediate: true });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(runs, 2); assert.ok(session.metrics.timedOut >= 1); assert.ok(session.take(input('next')));
  session.reset(); late({ evidence: ['old'] }); await tick(); assert.equal(session.results.size, 0);
});

test('30-minute virtual session bounds exact results, pending work and predictions', async () => {
  let now = 0;
  const session = new ProjectRagSession({ now: () => now, retrieve: async () => ({ candidates: [] }) });
  for (let i = 0; i < 1800; i++) {
    now += 1000; session.schedule(input('question-' + i), { immediate: true }); await tick();
    assert.ok(session.results.size <= 12); assert.ok(session.predictions.length <= 2); assert.ok(session.slots.size <= 1);
  }
  session.reset();
});

test('worker queue overflow rejects additional work and closes without unhandled promises', async () => {
  class HungWorker extends EventEmitter { postMessage() {} ref() {} unref() {} async terminate() {} }
  const queue = new EmbeddingWorkerQueue({ workerFactory: () => new HungWorker(), maxQueue: 1 });
  const active = queue.run('embed', { texts: ['active'] });
  const queued = queue.run('embed', { texts: ['queued'] });
  const activeRejected = assert.rejects(active, /closed/), queuedRejected = assert.rejects(queued, /closed/);
  await assert.rejects(queue.run('embed', { texts: ['overflow'] }), /queue-full/);
  await queue.close(); await activeRejected; await queuedRejected;
  assert.equal(queue.active, null); assert.equal(queue.queue.length, 0);
});

test('actual ASAR unpack rules include the scan worker relative dependency', async t => {
  const asar = require('@electron/asar');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-packaged-scan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'app'); await fs.mkdir(path.join(source, 'src'), { recursive: true });
  for (const file of ['project-embedding-worker.cjs', 'project-scope.js']) await fs.copyFile(path.resolve(__dirname, '../src', file), path.join(source, 'src', file));
  const patterns = require('../electron-builder.cjs').asarUnpack.filter(pattern => pattern.startsWith('src/'));
  const archive = path.join(directory, 'app.asar');
  await asar.createPackageWithOptions(source, archive, { unpack: '{' + patterns.map(pattern => '**/' + pattern).join(',') + '}' });
  const queue = new EmbeddingWorkerQueue({ workerFactory: () => new Worker(path.join(archive + '.unpacked', 'src/project-embedding-worker.cjs')) });
  t.after(() => queue.close());
  const matrix = new Float32Array(384); matrix[0] = 1;
  await queue.run('install-index', { revision: 'packaged', modelVersion: 'fixture', matrix,
    records: [{ id: 'source', projectId: 'a', path: 'src/Code.java' }] });
  const result = await queue.run('scan', { revision: 'packaged', modelVersion: 'fixture', vector: matrix,
    scopes: ['@project:a'], deadlineAt: Date.now() + 1000 });
  assert.equal(result.rows[0].id, 'source');
});
