'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { ActiveProjectContextCache } = require('../src/active-project-context-cache');

const source = (text, extra = {}) => ({ sourceType: 'imported', path: 'RepoPilot/cache.js', startLine: 1,
  endLine: 4, text, projectId: 'repo', kind: 'method', topics: ['cache'], ...extra });
const scopes = ['@project:repo'];
const reason = source('选择 Redis 缓存，因为缓存能降低延迟；取舍是需要维护一致性。');
const failure = source('Redis 不可用时 catch(error) 触发 fallback，降级读取数据库，并使用超时与重试。',
  { path: 'RepoPilot/fallback.js', topics: ['cache', 'reliability'] });

test('preloaded seed never skips first search; sufficient source-backed follow-up does', () => {
  const cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r1', [reason], { seed: true });
  assert.equal(cache.lookup(scopes, 'r1', '为什么用 Redis？').hit, false);
  cache.put(scopes, 'r1', [reason]);
  assert.equal(cache.lookup(scopes, 'r1', '那为什么选择 Redis 缓存？').hit, true);
});

test('Redis mention is insufficient for selection rationale, outage response and exact implementation', () => {
  const cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r1', [source('本项目的缓存使用 Redis。', { kind: 'section' })]);
  for (const query of ['为什么选 Redis？', 'Redis 挂了怎么办？', 'Redis 代码在哪实现？']) {
    assert.equal(cache.lookup(scopes, 'r1', query).hit, false, query);
  }
  cache.put(scopes, 'r1', [reason, failure]);
  assert.equal(cache.lookup(scopes, 'r1', 'Redis 挂了怎么办？').hit, true);
});

test('each sub-question requires evidence; unknown symbols force scoped retrieval', () => {
  const cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r1', [reason]);
  const plan = { subQuestions: [{ text: '为什么选择 Redis？' }, { text: 'Redis 挂了怎么办？' }] };
  const miss = cache.lookup(scopes, 'r1', '复合题', plan);
  assert.equal(miss.hit, false);
  assert.deepEqual(miss.missing, ['Redis 挂了怎么办？']);
  cache.put(scopes, 'r1', [failure]);
  assert.equal(cache.lookup(scopes, 'r1', '复合题', plan).hit, true);
  assert.equal(cache.lookup(scopes, 'r1', '源码在哪里实现？', { symbols: ['OrderController'] }).hit, false);
});

test('only imported sources in selected scopes enter cache, never assistant or manual answers', () => {
  const cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r1', [reason, { ...reason, path: 'other.js', projectId: 'tcs' },
    { ...reason, path: 'assistant.txt', sourceType: 'assistant' }, { ...reason, path: 'manual.txt', sourceType: 'manual' },
    { ...reason, path: 'summary.txt', startLine: undefined }]);
  assert.equal(cache.get(scopes, 'r1').evidence.length, 1);
  assert.equal(cache.lookup(['@project:tcs'], 'r1', '为什么用 Redis？').hit, false);
});

test('project comparison cannot claim coverage using one project source', () => {
  const cache = new ActiveProjectContextCache();
  const both = ['@project:repo', '@project:tcs'];
  cache.put(both, 'r1', [reason]);
  assert.equal(cache.lookup(both, 'r1', '为什么用 Redis？').hit, false);
  cache.put(both, 'r1', [{ ...reason, projectId: 'tcs', path: 'TCS/cache.js' }]);
  assert.equal(cache.lookup(both, 'r1', '为什么用 Redis？').hit, true);
});

test('revision/schema changes and TTL invalidate; LRU and evidence budgets remain bounded', () => {
  let now = 0;
  const cache = new ActiveProjectContextCache({ maxEntries: 2, maxEvidence: 2, maxChars: 200, ttlMs: 100, now: () => now });
  cache.put(scopes, 'r1', [reason, failure, source('x'.repeat(300), { path: 'large.js' })]);
  assert.ok(cache.get(scopes, 'r1').evidence.length <= 2);
  assert.ok(cache.get(scopes, 'r1').evidence.reduce((n, item) => n + item.text.length, 0) <= 200);
  cache.put(scopes, 'r2', [failure]);
  assert.equal(cache.get(scopes, 'r1'), null);
  cache.put(['@project:a'], 'r2', [source('source a', { projectId: 'a' })]);
  cache.get(scopes, 'r2');
  cache.put(['@project:b'], 'r2', [source('source b', { projectId: 'b' })]);
  assert.equal(cache.get(['@project:a'], 'r2'), null);
  cache.schemaVersion++;
  assert.equal(cache.get(scopes, 'r2'), null);
  cache.put(scopes, 'r2', [reason]); now = 101;
  assert.equal(cache.get(scopes, 'r2'), null);
});

function runtime(t, initial) {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-evidence-cache-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const indexFile = path.join(temp, 'cue-project-index-v1.json');
  fs.writeFileSync(indexFile, JSON.stringify(initial));
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const native = createRequire(file);
    const requireLocal = id => id === 'electron' ? { app: { getPath: () => temp } } :
      id.startsWith('.') ? load(native.resolve(id)) : native(id);
    const context = vm.createContext({ module, exports: module.exports, require: requireLocal, Buffer, process,
      __dirname: path.dirname(file), __filename: file, setImmediate, setTimeout, clearTimeout,
      console: { log() {}, warn() {} } });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return module.exports;
  }
  const knowledge = load(path.join(root, 'src/project-knowledge.js'));
  const searches = [];
  const original = knowledge.searchProjectKnowledge;
  knowledge.searchProjectKnowledge = (query, options) => { searches.push({ query, ...options }); return original(query, options); };
  return { temp, indexFile, knowledge, searches,
    context: load(path.join(root, 'src/project-context.js')),
    interview: load(path.join(root, 'src/interview-context.js')) };
}

const index = { version: 1, sourceName: 'projects', chunks: [
  { ...reason, sourceType: undefined, path: 'RepoPilot/README.md', symbol: '', kind: 'section' },
  { ...failure, sourceType: undefined, path: 'RepoPilot/src/CacheService.java', symbol: 'CacheService', kind: 'method' },
  { path: 'TCS/README.md', startLine: 1, endLine: 1, text: 'TCS JPEG 平台压缩 TCS_ONLY', kind: 'section' }
] };
const projectPlan = query => ({ retrieve: true, scopes: ['RepoPilot/'], query, projectLabel: 'RepoPilot', reason: 'fixture', overview: false });

test('real project context searches once when cold, zero on adequate follow-up, once for missing evidence', t => {
  const app = runtime(t, index);
  const first = app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('为什么选 Redis 缓存？') });
  assert.equal(first.stats.searchCalls, 1);
  assert.equal(app.searches.length, 1);
  const next = app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('那为什么选择 Redis？') });
  assert.equal(next.stats.evidenceCacheHit, true);
  assert.equal(app.searches.length, 1);
  assert.match(next.context, /选择 Redis 缓存/);
  const missing = app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('ZooKeeper 代码在哪实现？') });
  assert.equal(missing.stats.evidenceCacheHit, false);
  assert.equal(app.searches.length, 2);
  assert.ok(app.searches.every(call => call.scopes.length === 1 && call.scopes[0] === 'RepoPilot/'));
  assert.doesNotMatch(next.context, /JPEG|TCS_ONLY/);
});

test('generic questions inject no cache/state or retrieval and bundles retain old string interface', t => {
  const app = runtime(t, index);
  const settings = { projectKnowledge: '# TCS\nTCS_MANUAL JPEG 压缩\n# RepoPilot\nRedis 选择是为了缓存读取，手工项目事实。' };
  const plan = projectPlan('为什么选择 Redis？');
  const bundle = app.interview.buildInterviewContextBundle(settings, 'say', [], { projectPlan: plan });
  assert.match(bundle.context, /手工项目事实/);
  assert.ok(bundle.evidence.every(item => item.revision && item.scopeKey === 'RepoPilot/'));
  assert.ok(bundle.evidence.some(item => item.sourceType === 'manual' && item.path === 'settings.projectKnowledge'));
  assert.doesNotMatch(JSON.stringify(bundle.evidence), /TCS_MANUAL/);
  assert.equal(typeof app.interview.buildInterviewContext(settings, 'say', [], { projectPlan: plan }), 'string');
  const count = app.searches.length;
  const generic = app.interview.buildInterviewContextBundle(settings, 'say', [{ channel: 'them', text: 'Redis 为什么快？' }],
    { projectPlan: { retrieve: false, query: 'Redis 为什么快？', scopes: [], activeProject: { scopes: ['RepoPilot/'] } } });
  assert.equal(generic.evidence.length, 0);
  assert.equal(app.searches.length, count);
  assert.doesNotMatch(generic.context, /手工项目事实|选择 Redis 缓存/);
});

test('index revision changes on disk content replacement, clear and re-import; v1/v2 missing metadata remain readable', async t => {
  const app = runtime(t, index);
  const before = app.knowledge.getProjectIndexRevision();
  app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('为什么选择 Redis？') });
  const changed = JSON.parse(JSON.stringify(index)); changed.chunks[0].text = '选择 Redis 是因为新版缓存吞吐量，NEW_SOURCE。';
  fs.writeFileSync(app.indexFile, JSON.stringify(changed));
  assert.notEqual(app.knowledge.getProjectIndexRevision(), before);
  const result = app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('为什么选择 Redis？') });
  assert.equal(result.stats.searchCalls, 1);
  assert.match(result.context, /NEW_SOURCE/);
  const loaded = app.knowledge.getProjectIndexRevision();
  await app.knowledge.clearProjectIndex();
  assert.notEqual(app.knowledge.getProjectIndexRevision(), loaded);
  assert.equal(app.knowledge.getProjectSeedEvidence({ scopes: ['RepoPilot/'] }).length, 0);
  const fixture = path.join(app.temp, 'Fresh'); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'README.md'), 'Fresh 项目选择 Redis 因为缓存，重新导入。\n这是本地项目导入、索引 revision 和新元数据兼容性测试的真实说明资料。\n资料明确了缓存选型的原因和架构边界。');
  await app.knowledge.importProjectFolder(fixture);
  const imported = app.knowledge.getProjectIndexRevision();
  await app.knowledge.importProjectFolder(fixture);
  assert.notEqual(app.knowledge.getProjectIndexRevision(), imported);
  const persisted = JSON.parse(fs.readFileSync(path.join(app.temp, 'cue-project-index-v2.json'), 'utf8'));
  assert.equal(persisted.version, 2); assert.equal(persisted.metadataSchemaVersion, 3);
  const legacy = { version: 2, projects: [{ id: 'old', name: 'Old', stats: {} }], chunks: [
    { projectId: 'old', path: 'README.md', startLine: 1, endLine: 1, text: 'Old Redis 缓存旧版源码证据。' }] };
  fs.writeFileSync(path.join(app.temp, 'cue-project-index-v2.json'), JSON.stringify(legacy));
  assert.equal(app.knowledge.getProjectIndexState().ready, true);
  assert.ok(app.knowledge.getProjectProfileEvidence('Redis 缓存', { scopes: ['@project:old'] }).length > 0);
});

test('all existing per-mode project context budgets remain capped, including complex and smart', t => {
  const large = { version: 1, sourceName: 'RepoPilot', chunks: Array.from({ length: 12 }, (_, i) => ({
    path: `RepoPilot/architecture${i}.md`, startLine: 1, endLine: 20,
    text: ('Redis 缓存架构，选择 Redis 因为缓存降低延迟。\n').repeat(100), kind: 'section' })) };
  const app = runtime(t, large);
  for (const [mode, options, budget] of [['say', {}, 3000], ['answerThis', { answerComplexity: 'complex' }, 4000],
    ['assist', {}, 5000], ['say', { smart: true }, 6200]]) {
    const result = app.context.buildProjectContext([], mode, { projectPlan: projectPlan('为什么选择 Redis 缓存架构？'), ...options });
    assert.ok(result.context.length <= budget, `${mode} ${result.context.length}/${budget}`);
  }
});

test('source and candidate facts share the final system budget and hidden manual tails are not recorded', t => {
  const app = runtime(t, index);
  const settings = { projectKnowledge: '# RepoPilot\n' + '这是用户提供的 Redis 缓存项目事实与个人职责。'.repeat(100),
    resumeText: '候选人的简历资料。'.repeat(300) };
  for (const budget of [1200, 3600, 4800]) {
    const bundle = app.interview.buildInterviewContextBundle(settings, 'say', [], {
      projectPlan: projectPlan('为什么选择 Redis？'), contextBudget: budget, answerComplexity: 'complex'
    });
    assert.ok(bundle.context.length <= budget);
    for (const item of bundle.evidence) assert.ok(bundle.context.includes(item.text), 'state only records visible source text');
  }
});

test('cached tail evidence cut by the prompt budget cannot skip authoritative retrieval', t => {
  const text = '项目的其他背景说明。'.repeat(800) + '\n选择 Redis 是因为降低数据库压力。';
  const app = runtime(t, { version: 1, sourceName: 'RepoPilot', chunks: [
    { path: 'RepoPilot/README.md', startLine: 1, endLine: 2, text, kind: 'section' }
  ] });
  const revision = app.knowledge.getProjectIndexRevision();
  const cache = new ActiveProjectContextCache();
  cache.put(['RepoPilot/'], revision, [{ sourceType: 'imported', path: 'RepoPilot/README.md', startLine: 1, endLine: 2, text, topics: ['cache'] }]);
  assert.equal(cache.lookup(['RepoPilot/'], revision, '为什么选择 Redis？').hit, true);
  const result = app.context.buildProjectContext([], 'say', { projectPlan: projectPlan('为什么选择 Redis？'),
    projectContextCache: cache, projectContextBudget: 1200 });
  assert.equal(result.stats.evidenceCacheHit, false);
  assert.equal(result.stats.searchCalls, 1);
  assert.ok(result.context.length <= 1200);
});

test('an arbitrary cached method cannot answer an unlocated business flow', () => {
  const cache = new ActiveProjectContextCache();
  cache.put(scopes, 'r1', [{ sourceType: 'imported', projectId: 'repo', path: 'AnyService.java',
    startLine: 1, endLine: 2, kind: 'method', symbol: 'AnyService#handle', topics: ['architecture'], text: 'public void handle() { otherService.run(); }' }]);
  assert.equal(cache.lookup(scopes, 'r1', '订单创建流程代码在哪里实现？').hit, false);
});
