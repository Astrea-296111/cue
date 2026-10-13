const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('provider fallback budgets remain available', () => {
  const code = read('src/llm.js');
  assert.match(code, /FAST_MAX_TOKENS = 2048/);
  assert.match(code, /SMART_MAX_TOKENS = 4096/);
  assert.match(code, /SCREEN_MAX_TOKENS = 4096/);
  assert.match(code, /TECH_SCREEN_MAX_TOKENS = 6144/);
});

test('live bootstrap preserves bounded multi-question and code budgets in final SDK requests', async t => {
  const runtime = createInterviewRuntime(t);
  await runtime.ask('say', '什么是Redis？');
  const simple = runtime.calls.at(-1).max_tokens;
  await runtime.ask('say', '假设订单系统QPS提升10倍，你怎么优化？为什么不用分库分表？Redis挂了怎么办？');
  const complex = runtime.calls.at(-1).max_tokens;
  assert.ok(simple > 0 && simple <= 1800);
  assert.ok(complex > simple && complex <= 1800, 'The legacy hook must not cut a multi-question response to a single-point budget');
  await runtime.ask('assist', '把屏幕上的二叉树递归遍历改成迭代实现');
  assert.equal(runtime.calls.at(-1).max_tokens, 4096, 'Code tasks need their screen budget through the bootstrap');
});

test('screenshot capture is resized and JPEG-compressed for latency', () => {
  const code = read('src/screen.js');
  assert.match(code, /MAX_CAPTURE_WIDTH = 1600/);
  assert.match(code, /MAX_CAPTURE_HEIGHT = 1000/);
  assert.match(code, /JPEG_QUALITY = 80/);
  assert.match(code, /toJPEG/);
  assert.match(code, /data:image\/jpeg;base64/);
});

test('truncation is surfaced instead of looking like a silent UI stop', () => {
  const code = read('src/llm.js');
  assert.match(code, /finishReason === 'length'/);
  assert.match(code, /stopReason === 'max_tokens'/);
  assert.match(code, /MAX_TOKENS/);
  assert.match(code, /输出达到模型长度上限/);
});
