'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { existsSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { inProjectScope } = require('./project-scope');
const { MODEL_CONFIG, prepareModel, readSelectedModel } = require('./project-embedding-model');
const { RETRIEVAL_POLICY } = require('./project-prefetch-policy');
const DIMENSIONS = 384;
const digest = value => createHash('sha256').update(value).digest('hex');
const abortError = reason => reason instanceof Error ? reason : Object.assign(new Error(String(reason || '任务已取消')), { name: 'AbortError' });

function defaultWorkerFactory() {
  const packaged = path.join(__dirname, 'project-embedding-worker.cjs');
  const unpacked = packaged.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return new Worker(existsSync(unpacked) ? unpacked : packaged);
}
class EmbeddingWorkerQueue {
  constructor({ workerFactory = defaultWorkerFactory, maxQueue = 8, onFailure, recoveryMs = RETRIEVAL_POLICY.workerRecoveryMs } = {}) {
    this.workerFactory = workerFactory; this.maxQueue = maxQueue;
    this.onFailure = onFailure;
    this.worker = null; this.active = null; this.queue = []; this.nextId = 0; this.closed = false;
    this.recoveryMs = recoveryMs;
  }
  start() {
    if (this.worker) return;
    if (this.closed) throw new Error('worker-closed');
    if (this.termination) {
      this.termination.then(() => { if (!this.closed) { this.start(); this.drain(); } }).catch(error => this.fail(error));
      return;
    }
    const worker = this.worker = this.workerFactory();
    worker.on('message', message => {
      if (this.worker !== worker) return;
      if (this.active?.id !== message.id) return;
      clearTimeout(this.recoveryTimer); this.recoveryTimer = null;
      const job = this.active; this.active = null;
      job.cleanup();
      if (!job.settled) {
        job.settled = true;
        if (message.error) job.reject(Object.assign(new Error(message.error.message), { name: message.error.name }));
        else job.resolve(message.result);
      }
      this.drain();
    });
    worker.on('error', error => { if (this.worker === worker) this.fail(error); });
    worker.on('exit', code => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (!this.closed) this.fail(new Error(`embedding-worker-exited:${code}`));
    });
    this.worker.unref?.();
  }
  fail(error) {
    clearTimeout(this.recoveryTimer); this.recoveryTimer = null;
    const failed = this.worker; this.worker = null;
    if (failed) {
      const barrier = Promise.resolve(failed.terminate()).catch(() => {}).finally(() => {
        if (this.termination === barrier) this.termination = null;
      });
      this.termination = barrier;
    }
    for (const job of [this.active, ...this.queue].filter(Boolean)) {
      job.cleanup(); if (!job.settled) { job.settled = true; job.reject(error); }
    }
    this.active = null; this.queue = [];
    if (!this.closed) this.onFailure?.(error);
  }
  run(op, payload, { signal, deadlineAt, priority = 0 } = {}) {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    if (this.closed) return Promise.reject(new Error('worker-closed'));
    if (this.queue.length >= this.maxQueue) return Promise.reject(new Error('semantic-queue-full'));
    return new Promise((resolve, reject) => {
      const job = { id: ++this.nextId, op, payload, resolve, reject, priority, settled: false };
      let timer;
      const cancel = reason => {
        if (job.settled) return;
        job.settled = true; job.cleanup(); job.reject(abortError(reason));
        const queued = this.queue.indexOf(job);
        if (queued >= 0) this.queue.splice(queued, 1);
        if (this.active === job) {
          this.worker?.postMessage({ op: 'cancel', id: job.id });
          // Native inference may finish normally after cancellation. A hung
          // worker gets one bounded recovery, not a restart on each ASR word.
          this.recoveryTimer = setTimeout(() => {
            if (this.active === job) this.fail(new Error('semantic-worker-unresponsive'));
          }, this.recoveryMs);
        }
      };
      const onAbort = () => cancel(signal.reason);
      job.cleanup = () => {
        clearTimeout(timer);
        if (this.active === job) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
        signal?.removeEventListener('abort', onAbort);
      };
      deadlineAt = Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + 30000;
      if (Number.isFinite(deadlineAt)) {
        if (deadlineAt <= Date.now()) { cancel('semantic-timeout'); return; }
        timer = setTimeout(() => cancel('semantic-timeout'), deadlineAt - Date.now());
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(job); this.queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
      try { this.start(); this.drain(); } catch (error) { cancel(error); }
    });
  }
  drain() {
    if (this.active || !this.worker || this.closed) return;
    const job = this.queue.shift();
    if (!job) { this.worker.unref?.(); return; }
    this.active = job; this.worker.ref?.();
    this.worker.postMessage({ id: job.id, op: job.op, payload: job.payload });
  }
  close() {
    this.closed = true;
    this.fail(new Error('worker-closed'));
    return this.termination;
  }
}

async function loadVectorStore(directory, identity) {
  try {
    const pointer = JSON.parse(await fs.readFile(path.join(directory, 'current.json'), 'utf8'));
    if (!/^[a-zA-Z0-9-]+$/.test(pointer.generation || '')) return null;
    const generation = path.join(directory, pointer.generation);
    const metadata = JSON.parse(await fs.readFile(path.join(generation, 'metadata.json'), 'utf8'));
    if (metadata.schema !== 1 || metadata.modelIdentity !== identity || metadata.dimensions !== DIMENSIONS || !Array.isArray(metadata.records)) return null;
    const buffer = await fs.readFile(path.join(generation, 'matrix.f32'));
    if (buffer.length !== metadata.records.length * DIMENSIONS * 4 || digest(buffer) !== metadata.matrixHash) return null;
    const matrix = new Float32Array(metadata.records.length * DIMENSIONS);
    for (let i = 0; i < matrix.length; i++) matrix[i] = buffer.readFloatLE(i * 4);
    return { metadata, matrix };
  } catch { return null; }
}

async function saveVectorStore(directory, metadata, matrix, signal) {
  await fs.mkdir(directory, { recursive: true });
  const name = `vectors-${randomUUID()}`;
  const temporary = path.join(directory, `temporary-${randomUUID()}`);
  await fs.mkdir(temporary);
  try {
    const buffer = Buffer.allocUnsafe(matrix.length * 4);
    for (let i = 0; i < matrix.length; i++) buffer.writeFloatLE(matrix[i], i * 4);
    await fs.writeFile(path.join(temporary, 'matrix.f32'), buffer);
    await fs.writeFile(path.join(temporary, 'metadata.json'), JSON.stringify({ ...metadata, matrixHash: digest(buffer) }));
    if (signal?.aborted) throw abortError(signal.reason);
    await fs.rename(temporary, path.join(directory, name));
    const pointerTemporary = path.join(directory, `pointer-${randomUUID()}.json`);
    await fs.writeFile(pointerTemporary, JSON.stringify({ generation: name }));
    if (signal?.aborted) { await fs.rm(pointerTemporary, { force: true }); throw abortError(signal.reason); }
    await fs.rename(pointerTemporary, path.join(directory, 'current.json'));
    // Retain the previous complete generation for recovery; never remove a live matrix.
    const generations = (await fs.readdir(directory)).filter(entry => entry.startsWith('vectors-'));
    if (generations.length > 2) {
      const sorted = await Promise.all(generations.map(async entry => ({ entry, stamp: (await fs.stat(path.join(directory, entry))).mtimeMs })));
      for (const item of sorted.sort((a, b) => b.stamp - a.stamp).slice(2)) await fs.rm(path.join(directory, item.entry), { recursive: true, force: true });
    }
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}

function snapshotIdentity(snapshot, identity) {
  // Source content and all parsing/model settings are bound to the vector generation.
  return digest(JSON.stringify({ model: identity, chunker: snapshot.chunkerVersion, parser: snapshot.parserVersion, metadata: snapshot.metadataSchemaVersion, projects: (snapshot.projects || []).map(project => ({ id: project.id, revision: project.revision || project.sourceRevision })), hashes: snapshot.chunks.map(contentHash) }));
}
function contentHash(chunk) {
  return digest(JSON.stringify({ text: chunk.retrievalText || chunk.text, path: chunk.path, projectId: chunk.projectId, symbol: chunk.symbol, headingPath: chunk.headingPath, parserKind: chunk.parserKind, parserVersion: chunk.parserVersion, metadataSchemaVersion: chunk.metadataSchemaVersion }));
}

class ProjectEmbeddings {
  constructor({ directory, snapshotProvider, revisionProvider, workerFactory, modelLoader = readSelectedModel, modelPreparer = prepareModel, fetchImpl } = {}) {
    if (!directory) throw new Error('本地语义检索需要数据目录');
    this.directory = directory; this.snapshotProvider = snapshotProvider; this.revisionProvider = revisionProvider;
    this.modelLoader = modelLoader; this.modelPreparer = modelPreparer;
    this.fetchImpl = fetchImpl;
    this.queue = new EmbeddingWorkerQueue({ workerFactory, onFailure: error => {
      this.modelReady = false; this.warmedModelIdentity = null; this.invalidate('worker-failed'); this.phase = 'failed'; this.error = error.message;
    } });
    this.model = null; this.modelReady = false; this.warmedModelIdentity = null; this.modelSelectionGeneration = 0;
    this.snapshot = null; this.vectors = null;
    this.phase = 'not-prepared'; this.error = ''; this.generation = 0; this.queryCache = new Map();
    this.warming = null; this.warmingIdentity = null; this.modelLoading = null; this.preparing = null;
    this.indexing = null; this.indexController = null; this.progress = null;
  }
  status() {
    const revision = this.revisionProvider?.();
    const modelReady = !!(this.modelReady && this.warmedModelIdentity === this.model?.identity);
    const ready = !!(modelReady && this.vectors && this.vectors.modelIdentity === this.warmedModelIdentity && (!revision || this.vectors.revision === revision));
    return { state: ready && this.phase !== 'indexing' ? 'ready' : this.phase, ready, modelReady, indexRevision: this.vectors?.revision || null, modelRevision: this.model?.manifest?.revision || null, modelVersion: this.model?.identity || null, model: MODEL_CONFIG.model, dtype: MODEL_CONFIG.dtype, dimensions: DIMENSIONS, error: this.error || null, progress: this.progress };
  }
  prepare(options = {}) {
    if (this.preparing) return this.preparing;
    const job = this.prepareOnce(options).finally(() => { if (this.preparing === job) this.preparing = null; });
    this.preparing = job;
    return job;
  }
  async prepareOnce(options = {}) {
    this.phase = 'preparing'; this.error = '';
    try {
      const next = await this.modelPreparer(path.join(this.directory, 'models'), { ...options, fetchImpl: options.fetchImpl || this.fetchImpl, onProgress: progress => { this.progress = progress; options.onProgress?.(progress); } });
      if (this.model?.identity !== next.identity) { this.modelSelectionGeneration++; this.invalidate('model-changed'); this.modelReady = false; }
      this.model = next;
      await this.warm({ signal: options.signal });
      if (!this.status().modelReady || this.warmedModelIdentity !== next.identity) throw new Error(this.error || '本地模型未能加载，请继续使用基础检索');
      return this.status();
    } catch (error) { this.phase = 'failed'; this.error = error.message; throw error; }
  }
  async warm({ signal } = {}) {
    if (!this.model) {
      const selection = this.modelSelectionGeneration;
      let loading = this.modelLoading;
      if (!loading) loading = this.modelLoading = Promise.resolve().then(() => this.modelLoader(path.join(this.directory, 'models'), { signal }));
      try {
        const loaded = await loading;
        // A late startup disk read cannot replace a user's new model selection.
        if (!this.model && selection === this.modelSelectionGeneration) { this.model = loaded; this.modelSelectionGeneration++; }
      } catch (error) {
        if (!this.model) {
          this.modelReady = false; this.phase = error.code === 'ENOENT' ? 'not-prepared' : 'failed';
          this.error = error.code === 'ENOENT' ? '' : error.message; return this.status();
        }
      } finally { if (this.modelLoading === loading) this.modelLoading = null; }
    }
    const model = this.model;
    if (!model) return this.status();
    if (this.modelReady && this.warmedModelIdentity === model.identity) return this.status();
    if (this.warming) {
      if (this.warmingIdentity === model.identity) return this.warming;
      // Native inference remains on the same worker. Wait for the old load,
      // then load the current selection; never label old weights as the new model.
      await this.warming;
      return this.warm({ signal });
    }
    const selection = this.modelSelectionGeneration;
    this.modelReady = false;
    const job = (async () => {
      try {
        this.phase = 'loading';
        await this.queue.run('warm', { directory: model.directory, identity: model.identity }, { signal });
        this.warmedModelIdentity = model.identity;
        if (selection === this.modelSelectionGeneration && this.model?.identity === model.identity) {
          this.modelReady = true; this.phase = 'model-ready'; this.error = '';
        }
        return this.status();
      } catch (error) {
        this.modelReady = false; this.warmedModelIdentity = null;
        if (selection === this.modelSelectionGeneration) { this.phase = error.code === 'ENOENT' ? 'not-prepared' : 'failed'; this.error = error.code === 'ENOENT' ? '' : error.message; }
        return this.status();
      } finally { if (this.warming === job) { this.warming = null; this.warmingIdentity = null; } }
    })();
    this.warming = job; this.warmingIdentity = model.identity;
    return job;
  }
  invalidate(reason = 'index-changed') {
    this.generation++; this.indexController?.abort(reason); this.vectors = null; this.snapshot = null; this.queryCache.clear();
    this.phase = this.modelReady ? 'model-ready' : 'not-prepared';
    if (this.queue.worker && !this.queue.closed) this.queue.run('clear-index', {}, { priority: 2,
      deadlineAt: Date.now() + 1000 }).catch(() => {});
  }
  resetSession() { this.queryCache.clear(); }
  async indexSnapshot(snapshot, { revision, onProgress } = {}) {
    if (!this.status().modelReady || !this.model) return { ready: false, reason: 'model-not-warm' };
    const modelIdentity = this.model.identity;
    snapshot ||= this.snapshotProvider?.();
    if (snapshot?.index) snapshot = { ...snapshot.index, ...snapshot };
    if (!Array.isArray(snapshot?.chunks)) return { ready: false, reason: 'index-not-ready' };
    revision ||= snapshot.revision || this.revisionProvider?.() || snapshotIdentity(snapshot, this.model.identity);
    if (this.vectors?.revision === revision && this.vectors.modelIdentity === modelIdentity) return this.status();
    this.invalidate();
    const generation = this.generation, controller = new AbortController(); this.indexController = controller;
    const identity = snapshotIdentity(snapshot, this.model.identity);
    const reportProgress = completed => {
      if (generation !== this.generation || controller.signal.aborted) return;
      const total = snapshot.chunks.length;
      this.progress = { phase: 'indexing', completed, total, percent: total ? Math.floor(completed * 100 / total) : 100 };
      onProgress?.({ ...this.progress });
    };
    this.phase = 'indexing'; reportProgress(0);
    const job = (async () => {
      try {
        const cached = await loadVectorStore(path.join(this.directory, 'vectors'), this.model.identity);
        const reusable = new Map();
        const parserCompatible = cached?.metadata.chunkerVersion === snapshot.chunkerVersion && cached?.metadata.parserVersion === snapshot.parserVersion && cached?.metadata.metadataSchemaVersion === snapshot.metadataSchemaVersion;
        for (let row = 0; row < (parserCompatible ? cached?.metadata.records.length || 0 : 0); row++) {
          const record = cached.metadata.records[row];
          if (!reusable.has(record.hash)) reusable.set(record.hash, []);
          reusable.get(record.hash).push({ ...record, vector: cached.matrix.subarray(row * DIMENSIONS, (row + 1) * DIMENSIONS) });
        }
        const records = [], values = [];
        let reused = 0, computed = 0;
        for (let start = 0; start < snapshot.chunks.length; start += 8) {
          if (controller.signal.aborted || generation !== this.generation) throw abortError('index-stale');
          const misses = [];
          for (let index = start; index < Math.min(snapshot.chunks.length, start + 8); index++) {
            const chunk = snapshot.chunks[index], hash = contentHash(chunk), id = chunk.id ?? index;
            const found = reusable.get(hash);
            if (found) for (const previous of found) { records.push({ id, index, hash, tokenStart: previous.tokenStart, tokenEnd: previous.tokenEnd }); values.push(previous.vector); reused++; }
            else misses.push({ index, id, hash, text: chunk.retrievalText || chunk.text || '' });
          }
          if (misses.length) {
            const result = await this.queue.run('embed', { texts: misses.map(item => item.text), kind: 'passage' }, { signal: controller.signal, priority: -1 });
            for (let row = 0; row < result.records.length; row++) {
              const segment = result.records[row], item = misses[segment.textIndex];
              records.push({ id: item.id, index: item.index, hash: item.hash, tokenStart: segment.tokenStart, tokenEnd: segment.tokenEnd });
              values.push(result.matrix.subarray(row * DIMENSIONS, (row + 1) * DIMENSIONS)); computed++;
            }
          }
          if (controller.signal.aborted || generation !== this.generation) throw abortError('index-stale');
          reportProgress(Math.min(snapshot.chunks.length, start + 8));
          await new Promise(resolve => setImmediate(resolve));
        }
        const matrix = new Float32Array(records.length * DIMENSIONS);
        values.forEach((value, row) => matrix.set(value, row * DIMENSIONS));
        if (generation !== this.generation || controller.signal.aborted) throw abortError('index-stale');
        const metadata = { schema: 1, dimensions: DIMENSIONS, modelIdentity: this.model.identity, configuration: MODEL_CONFIG, identity, revision, records, chunkerVersion: snapshot.chunkerVersion, parserVersion: snapshot.parserVersion, metadataSchemaVersion: snapshot.metadataSchemaVersion };
        await saveVectorStore(path.join(this.directory, 'vectors'), metadata, matrix, controller.signal);
        if (generation !== this.generation || (this.revisionProvider?.() && this.revisionProvider() !== revision)) throw abortError('index-stale');
        // Install once per immutable revision. Structured clone keeps the main
        // matrix usable for persistence/incremental indexing; queries only send
        // 384 floats and compact options, never the full source corpus.
        await this.queue.run('install-index', { revision, modelVersion: modelIdentity, matrix,
          records: records.map(record => ({ ...record, projectId: snapshot.chunks[record.index]?.projectId,
            path: snapshot.chunks[record.index]?.path })) }, { signal: controller.signal, priority: -1 });
        if (generation !== this.generation || controller.signal.aborted) throw abortError('index-stale');
        this.snapshot = snapshot; this.vectors = { records, matrix, revision, identity, modelIdentity }; this.phase = 'ready'; this.error = '';
        return { ...this.status(), reused, computed, segments: records.length };
      } catch (error) {
        if (generation === this.generation) { this.phase = this.modelReady ? 'model-ready' : 'failed'; this.error = error.name === 'AbortError' ? '' : error.message; }
        return { ready: false, reason: error.name === 'AbortError' ? 'index-stale' : 'index-failed', error: error.message };
      } finally { if (this.indexing === job) this.indexing = null; }
    })();
    this.indexing = job;
    return job;
  }
  async queryCandidates({ query, scopes = [], signal, deadlineAt = Date.now() + 100, limit = 30 } = {}) {
    const started = performance.now(), generation = this.generation;
    const empty = reason => ({ rows: [], revision: this.vectors?.revision || null, modelVersion: this.model?.identity || null, reason, stats: { semanticMs: performance.now() - started } });
    if (!scopes.length) return empty('unscoped-disabled');
    if (!this.status().modelReady) return empty(this.phase === 'not-prepared' ? 'model-not-prepared' : 'model-not-warm');
    if (!this.vectors || !this.snapshot) return empty('index-not-ready');
    if (this.revisionProvider?.() && this.revisionProvider() !== this.vectors.revision) return empty('revision-mismatch');
    if (!String(query || '').trim()) return empty('empty-query');
    const key = digest(`${this.model.identity}\n${query}`);
    try {
      let vector = this.queryCache.get(key);
      const queryCacheHit = !!vector;
      if (!vector) {
        const result = await this.queue.run('embed', { texts: [String(query)], kind: 'query' }, { signal, deadlineAt, priority: 1 });
        vector = result.matrix;
        if (generation !== this.generation || signal?.aborted) return empty('stale-result');
        this.queryCache.set(key, vector);
        while (this.queryCache.size > 64) this.queryCache.delete(this.queryCache.keys().next().value);
      }
      if (generation !== this.generation || signal?.aborted) return empty('stale-result');
      if (Date.now() >= deadlineAt) return empty('semantic-timeout');
      const result = await this.queue.run('scan', { vector, scopes, limit, revision: this.vectors.revision,
        modelVersion: this.model.identity, deadlineAt }, { signal, deadlineAt, priority: 1 });
      if (generation !== this.generation || signal?.aborted || result.revision !== this.vectors?.revision ||
        result.modelVersion !== this.model.identity) return empty('stale-result');
      return { ...result, stats: { ...result.stats, semanticMs: performance.now() - started, queryCacheHit } };
    } catch (error) {
      const reason = signal?.aborted ? 'aborted' : /semantic-timeout/.test(error.message) ? 'semantic-timeout' : /semantic-queue-full/.test(error.message) ? 'semantic-queue-full' : 'semantic-failed';
      return { ...empty(reason), error: error.message };
    }
  }
  async prefetchQuery(options) { return this.queryCandidates({ ...options, deadlineAt: options.deadlineAt || Date.now() + 500 }); }
  async close() { this.invalidate('closed'); await this.queue.close(); }
}

let singleton;
const createProjectEmbeddings = options => new ProjectEmbeddings(options);
function getProjectEmbeddings(options) { if (!singleton) singleton = createProjectEmbeddings(options); return singleton; }
module.exports = { createProjectEmbeddings, getProjectEmbeddings, ProjectEmbeddings, EmbeddingWorkerQueue, loadVectorStore, saveVectorStore, snapshotIdentity, MODEL_CONFIG };
