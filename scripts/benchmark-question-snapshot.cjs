'use strict';
// Local parser/snapshot timing, separate from SDK transport and UI measurements.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { QuestionResolver } = require('../src/question-resolver');
const arg = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const count = Number(arg('samples', 300));
if (!Number.isInteger(count) || count < 30 || count > 10000) throw new Error('samples must be 30..10000');
const event = (r, text, key, final = true, extra = {}) => r.observe({ channel: 'them', text,
  sourceId: 'fixture', utteranceKey: key, ...extra }, final);
const cases = [
  ['independent', r => {
    event(r, 'Redis的持久化机制是什么？', 'a'); event(r, '你在CAE项目具体负责什么？', 'b');
  }, s => s.text.includes('CAE') && !s.text.includes('Redis')],
  ['correction-final', r => {
    event(r, 'Redis如何持久化？', 'a'); event(r, '不是缓存，我问的是团队分工。', 'b');
  }, s => s.text.includes('团队分工') && !s.text.includes('Redis')],
  ['correction-interim', r => {
    event(r, 'Redis如何持久化？', 'a'); event(r, '现在我问的是你在CAE的分工', 'b', false);
  }, s => s.text.includes('CAE') && !s.text.includes('Redis')],
  ['conditions', r => {
    event(r, '在库存不能超卖，数据库不能扩容的条件下，', 'a');
    event(r, '流量增加10倍，怎么设计？为什么？失败如何恢复？', 'b');
  }, s => ['不能超卖', '不能扩容', '10倍', '怎么设计', '为什么', '如何恢复'].every(t => s.text.includes(t))],
  ['ordered-late-final', r => {
    event(r, '数据库如何设计？', 'b', true, { sourceSessionId: 'one', utteranceOrder: 2 });
    event(r, 'Redis如何持久化？', 'a', true, { sourceSessionId: 'one', utteranceOrder: 1 });
  }, s => s.text.includes('数据库') && !s.text.includes('Redis')],
  ['new-incomplete', r => {
    event(r, '缓存怎么失效？', 'a');
    r.speechState({ channel: 'them', speaking: false }); r.speechState({ channel: 'them', speaking: true });
    event(r, '另外一个问题……', 'b', false);
  }, s => !s.text && s.awaitingNewQuestion],
  ['unfinished-example', r => {
    event(r, '缓存怎么失效？', 'a'); event(r, '比如……', 'b', false);
  }, s => s.text.includes('缓存怎么失效') && !s.text.includes('比如')]
];
function summary(values) {
  values = [...values].sort((a, b) => a - b);
  return { n: values.length, p50: values[Math.ceil(values.length * .5) - 1],
    p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) };
}
const result = { scope: 'Offline resolver construction + observe + immutable snapshot + claim. Warm module, fresh resolver per sample. No ASR inference/model/UI.',
  samplesPerCase: count, generatedAt: new Date().toISOString(), node: process.version,
  sourceHashes: Object.fromEntries(['src/question-resolver.js', 'scripts/benchmark-question-snapshot.cjs'].map(file =>
    [file, createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])), cases: [] };
for (const [id, setup, check] of cases) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const r = new QuestionResolver(); setup(r);
    const snapshot = r.resolveForSubmit({ allowPartial: true });
    if (snapshot.text) r.claim(snapshot, 'benchmark');
    samples.push({ ms: performance.now() - start, correct: !!check(snapshot) });
  }
  result.cases.push({ id, latencyMs: summary(samples.map(s => s.ms)),
    correct: samples.filter(s => s.correct).length, samples });
}
result.overall = summary(result.cases.flatMap(c => c.samples.map(s => s.ms)));
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'cue-question-snapshot.json')));
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ out, overall: result.overall, correct: result.cases.reduce((n, c) => n + c.correct, 0) }));
if (result.cases.some(c => c.correct !== count)) process.exitCode = 1;
