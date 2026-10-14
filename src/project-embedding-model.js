'use strict';

// Only an explicit preparation action reaches the network. Inference always
// uses the immutable, checksum-verified local directory returned here.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MODEL_ID = 'Xenova/multilingual-e5-small';
const MODEL_CONFIG = Object.freeze({ model: MODEL_ID, transformers: '3.8.1', runtime: '1.21.0', dtype: 'q8', dimensions: 384, pooling: 'mean', normalize: true, tokenizer: 'model-tokenizer', maxTokens: 512, segmentTokens: 300 });
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MANIFEST_FILE = 'cue-model-manifest.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const METADATA_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const DOWNLOAD_IDLE_MS = 30_000;

function abortCheck(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('准备已取消'), { name: 'AbortError' });
}

function networkDeadline(signal, timeoutMs, message) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(new Error(message), { name: 'TimeoutError' })), timeoutMs);
  return { controller, signal: controller.signal, cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}

async function publishSelection(rootDirectory, selected, signal) {
  abortCheck(signal);
  const temporary = path.join(rootDirectory, `selected-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(selected), { flag: 'wx' });
    abortCheck(signal);
    await fs.rename(temporary, path.join(rootDirectory, 'selected-model.json'));
  } finally { await fs.rm(temporary, { force: true }); }
}

async function readMetadata(fetchImpl, url, { signal, metadataTimeoutMs = METADATA_TIMEOUT_MS } = {}) {
  const deadline = networkDeadline(signal, metadataTimeoutMs, '获取模型版本超时，请检查网络后重试');
  try {
    const response = await fetchImpl(url, { signal: deadline.signal });
    if (!response.ok) throw new Error(`无法获取模型版本（HTTP ${response.status}）；可继续使用基础检索`);
    let bytes = 0; const pieces = [];
    for await (const piece of response.body) {
      abortCheck(deadline.signal); bytes += piece.length;
      if (bytes > 2 * 1024 * 1024) throw new Error('模型版本清单过大');
      pieces.push(Buffer.from(piece));
    }
    abortCheck(deadline.signal);
    return JSON.parse(Buffer.concat(pieces).toString('utf8'));
  } catch (error) { if (deadline.signal.aborted) abortCheck(deadline.signal); throw error; }
  finally { deadline.cleanup(); }
}

async function hashFile(file, signal) {
  const handle = await fs.open(file, 'r');
  const digest = createHash('sha256');
  let size = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      abortCheck(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_FILE_BYTES) throw new Error('本地模型文件超过大小限制');
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
  return { sha256: digest.digest('hex'), size };
}

async function verifyModelDirectory(directory, { signal } = {}) {
  const manifestPath = path.join(directory, MANIFEST_FILE);
  const manifestStat = await fs.stat(manifestPath);
  if (manifestStat.size > 64 * 1024) throw new Error('模型校验清单过大');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.schema !== 1 || manifest.model !== MODEL_ID || !/^[a-f0-9]{40}$/.test(manifest.revision || '') || manifest.dtype !== 'q8') throw new Error('模型清单必须指定 multilingual-e5-small 的确切版本和 q8 权重');
  for (const name of MODEL_FILES) {
    const expected = manifest.files?.[name];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.size)) throw new Error(`模型清单缺少文件校验：${name}`);
    const resolved = path.join(directory, name);
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`模型文件不能是链接或目录：${name}`);
    const actual = await hashFile(resolved, signal);
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) throw new Error(`模型文件校验失败：${name}`);
  }
  const config = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8'));
  if (config.hidden_size !== 384) throw new Error('本地模型维度不是 384');
  // Bind the tokenizer checksum into every vector/cache identity as well.
  const identity = hash(JSON.stringify({ ...MODEL_CONFIG, revision: manifest.revision, files: manifest.files }));
  return { directory: path.resolve(directory), manifest, identity, config: MODEL_CONFIG };
}

async function downloadFile(url, destination, { signal, expectedHash, onProgress, name, fetchImpl, downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS, downloadIdleMs = DOWNLOAD_IDLE_MS }) {
  abortCheck(signal);
  const deadline = networkDeadline(signal, downloadTimeoutMs, `模型下载总时限已到：${name}`);
  let idleTimer, handle;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => deadline.controller.abort(Object.assign(new Error(`模型下载长时间没有进度：${name}`), { name: 'TimeoutError' })), downloadIdleMs);
  };
  resetIdle();
  try {
    const response = await fetchImpl(url, { signal: deadline.signal });
    if (!response.ok) throw new Error(`本地模型下载失败（HTTP ${response.status}）：${name}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_FILE_BYTES) throw new Error(`模型文件过大：${name}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    handle = await fs.open(destination, 'wx');
    const digest = createHash('sha256');
    let received = 0;
    for await (const value of response.body) {
      abortCheck(deadline.signal); resetIdle();
      received += value.length;
      if (received > MAX_FILE_BYTES) throw new Error(`模型文件过大：${name}`);
      digest.update(value);
      // FileHandle.write may write fewer bytes than requested.
      let offset = 0;
      while (offset < value.length) offset += (await handle.write(value, offset, value.length - offset)).bytesWritten;
      onProgress?.({ phase: 'download', file: name, received, total: declared || null });
    }
    abortCheck(deadline.signal);
    const sha256 = digest.digest('hex');
    if (expectedHash && sha256 !== expectedHash) throw new Error(`模型下载校验失败：${name}`);
    return { sha256, size: received };
  } catch (error) { if (deadline.signal.aborted) abortCheck(deadline.signal); throw error; }
  finally { clearTimeout(idleTimer); deadline.cleanup(); await handle?.close(); }
}

async function prepareModel(rootDirectory, { directory, signal, onProgress, fetchImpl = fetch, metadataTimeoutMs, downloadTimeoutMs, downloadIdleMs } = {}) {
  await fs.mkdir(rootDirectory, { recursive: true });
  if (directory) {
    onProgress?.({ phase: 'verify', file: '本地模型' });
    const verified = await verifyModelDirectory(directory, { signal });
    // Do not copy hundreds of MB synchronously or silently change the selected model.
    await publishSelection(rootDirectory, { directory: verified.directory, identity: verified.identity }, signal);
    return verified;
  }
  // Existing pin is reused. Refreshing dependencies must not silently change it.
  const selected = await readSelectedModel(rootDirectory, { signal }).catch(() => null);
  if (selected) return selected;
  onProgress?.({ phase: 'resolve', file: MODEL_ID });
  const metadata = await readMetadata(fetchImpl, `https://huggingface.co/api/models/${MODEL_ID}?blobs=true`, { signal, metadataTimeoutMs });
  const revision = metadata.sha;
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('模型服务没有返回可固定的版本');
  const entries = new Map((metadata.siblings || []).map(entry => [entry.rfilename, entry]));
  for (const name of MODEL_FILES) if (!entries.has(name)) throw new Error(`此版本缺少模型文件：${name}`);
  const weightHash = entries.get('onnx/model_quantized.onnx')?.lfs?.sha256;
  if (!/^[a-f0-9]{64}$/.test(weightHash || '')) throw new Error('模型服务没有提供 q8 权重的 SHA256；拒绝未校验下载');
  const temporary = path.join(rootDirectory, `.preparing-${randomUUID()}`);
  await fs.mkdir(temporary);
  try {
    const files = {};
    for (const name of MODEL_FILES) {
      files[name] = await downloadFile(`https://huggingface.co/${MODEL_ID}/resolve/${revision}/${name}`, path.join(temporary, name), {
        signal, name, expectedHash: entries.get(name)?.lfs?.sha256, onProgress, fetchImpl, downloadTimeoutMs, downloadIdleMs,
      });
    }
    await fs.writeFile(path.join(temporary, MANIFEST_FILE), JSON.stringify({ schema: 1, model: MODEL_ID, revision, dtype: 'q8', files }, null, 2));
    const verified = await verifyModelDirectory(temporary, { signal });
    const destination = path.join(rootDirectory, `e5-${revision}-q8`);
    // A preparation only publishes a complete model. A previous ready model stays usable.
    await fs.rename(temporary, destination).catch(async error => {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      await verifyModelDirectory(destination, { signal });
      await fs.rm(temporary, { recursive: true, force: true });
    });
    await publishSelection(rootDirectory, { directory: destination, identity: verified.identity }, signal);
    return { ...verified, directory: destination };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}

async function readSelectedModel(rootDirectory, options) {
  const selected = JSON.parse(await fs.readFile(path.join(rootDirectory, 'selected-model.json'), 'utf8'));
  const verified = await verifyModelDirectory(selected.directory, options);
  if (selected.identity !== verified.identity) throw new Error('本地模型身份已改变，请重新准备');
  return verified;
}

module.exports = { MODEL_CONFIG, MODEL_FILES, MANIFEST_FILE, prepareModel, readSelectedModel, verifyModelDirectory, hashFile };
