'use strict';

const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
let extractor = null;
let modelIdentity = '';
const cancelled = new Set();
const check = id => { if (cancelled.has(id)) throw Object.assign(new Error('任务已取消'), { name: 'AbortError' }); };

function normalize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(vector, value => value / norm);
}

async function warm({ directory, identity }) {
  if (extractor && modelIdentity === identity) return;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  // Keep CPU pressure bounded when speech recognition runs at the same time.
  env.backends.onnx.wasm.numThreads = 1;
  const previous = extractor;
  extractor = null; modelIdentity = '';
  await previous?.dispose();
  extractor = await pipeline('feature-extraction', directory, {
    local_files_only: true, device: 'cpu', dtype: 'q8',
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential' },
  });
  modelIdentity = identity;
  // A successful load includes an actual inference, so ready is not just a file check.
  const output = await extractor('query: 本地模型预热', { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
  if (output.data.length !== 384) throw new Error('模型输出维度错误');
}

async function embed(id, { texts, kind }) {
  if (!extractor) throw new Error('model-not-warm');
  const vectors = [], records = [];
  const prefix = kind === 'query' ? 'query: ' : 'passage: ';
  for (let textIndex = 0; textIndex < texts.length; textIndex++) {
    check(id);
    const encoded = extractor.tokenizer(String(texts[textIndex] || ''), { add_special_tokens: false, return_tensor: false, truncation: false });
    const ids = Array.isArray(encoded.input_ids[0]) ? encoded.input_ids[0] : encoded.input_ids;
    // Each retrieval segment has <=300 body tokens plus the E5 prefix/special tokens.
    const windows = Math.max(1, Math.ceil(ids.length / 300));
    const queryVectors = [];
    for (let segment = 0; segment < windows; segment++) {
      check(id);
      const tokenStart = segment * 300, tokenEnd = Math.min(ids.length, tokenStart + 300);
      const body = extractor.tokenizer.decode(ids.slice(tokenStart, tokenEnd), { skip_special_tokens: true });
      const output = await extractor(prefix + body, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
      check(id);
      if (output.data.length !== 384) throw new Error('模型输出维度错误');
      const vector = Float32Array.from(output.data);
      if (kind === 'query') queryVectors.push(vector);
      else { vectors.push(vector); records.push({ textIndex, tokenStart, tokenEnd }); }
      // Process cancellations between native ONNX calls.
      await new Promise(resolve => setImmediate(resolve));
    }
    if (kind === 'query') {
      const mean = new Float32Array(384);
      for (const vector of queryVectors) for (let i = 0; i < 384; i++) mean[i] += vector[i] / queryVectors.length;
      vectors.push(normalize(mean)); records.push({ textIndex });
    }
  }
  const matrix = new Float32Array(vectors.length * 384);
  vectors.forEach((vector, index) => matrix.set(vector, index * 384));
  return { matrix, records };
}

async function checkRuntime({ modelBytes }) {
  // Bounded diagnostic fixture only; this operation is not exposed through IPC.
  const bytes = Buffer.from(modelBytes || []);
  if (bytes.length !== 130 || createHash('sha256').update(bytes).digest('hex') !== '71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10') throw new Error('invalid-runtime-fixture');
  const ort = require('onnxruntime-node');
  const { env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  const session = await ort.InferenceSession.create(bytes, { intraOpNumThreads: 1, interOpNumThreads: 1 });
  try {
    const output = await session.run({ X: new ort.Tensor('float32', Float32Array.from([1, 2, 3, 4, 5, 6]), [3, 2]) });
    return { values: Array.from(output.Y.data), node: process.versions.node, electron: process.versions.electron || null, transformers: env.version };
  } finally { await session.release(); }
}

parentPort.on('message', async message => {
  if (message.op === 'cancel') { cancelled.add(message.id); return; }
  try {
    check(message.id);
    const result = message.op === 'warm' ? await warm(message.payload) : message.op === 'runtime-check' ? await checkRuntime(message.payload) : await embed(message.id, message.payload);
    check(message.id);
    parentPort.postMessage({ id: message.id, result }, result?.matrix ? [result.matrix.buffer] : []);
  } catch (error) { parentPort.postMessage({ id: message.id, error: { message: error.message, name: error.name } }); }
  finally { cancelled.delete(message.id); }
});
