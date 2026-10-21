#!/usr/bin/env node
'use strict';

// This command imports only the two synthetic fixtures into isolated temporary
// userData. It does not download models or invoke a cloud LLM.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createHash } = require('crypto');
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');
const { evaluateCase, summarize, percentile } = require('./lib/rag-eval-metrics');

const FIXTURE_ROOT = path.resolve(__dirname, '../test/fixtures/rag-evaluation');
function options(argv) {
  const result = { split: 'all', iterations: 3 };
  const values = new Set(['split', 'out', 'model-dir', 'data-dir', 'iterations', 'samples', 'semantic-threshold']);
  const flags = new Set(['semantic', 'benchmark', 'cpu-contention', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`不支持的参数：${token}`);
    const [key, inline] = token.slice(2).split('=', 2);
    if (flags.has(key)) result[key] = true;
    else if (values.has(key)) {
      result[key] = inline ?? argv[++i];
      if (!result[key] || result[key].startsWith('--')) throw new Error(`--${key} 缺少参数`);
    }
    else throw new Error(`不支持的参数：--${key}`);
  }
  if (!['all', 'development', 'heldout'].includes(result.split)) throw new Error('--split 仅支持 all/development/heldout');
  result.iterations = Number(result.iterations);
  if (!Number.isInteger(result.iterations) || result.iterations < 1 || result.iterations > 100) throw new Error('--iterations 必须是 1–100');
  result.semanticThreshold = result['semantic-threshold'] == null ? .70 : Number(result['semantic-threshold']);
  if (!Number.isFinite(result.semanticThreshold) || result.semanticThreshold < 0 || result.semanticThreshold > 1) throw new Error('--semantic-threshold 必须在 0–1 之间');
  if (result.semantic && !result['model-dir']) throw new Error('--semantic 需要 --model-dir 指向已经准备且有校验清单的本地模型；评测不会下载模型');
  return result;
}

function validateGold(gold, projects) {
  if (!gold.synthetic || gold.schemaVersion !== 1) throw new Error('评测只接受当前版本的合成 gold');
  const projectIds = new Set(projects.map(project => project.id));
  const ids = new Set();
  for (const item of gold.cases) {
    if (ids.has(item.id) || !projectIds.has(item.projectId) || !item.question || !['development', 'heldout'].includes(item.split)) throw new Error('gold 身份或分组无效');
    ids.add(item.id);
    const project = projects.find(project => project.id === item.projectId);
    for (const need of item.needs) for (const source of need.anyOf || []) {
      const sourcePath = path.resolve(FIXTURE_ROOT, 'projects', project.directory, source.path);
      const projectRoot = path.resolve(FIXTURE_ROOT, 'projects', project.directory) + path.sep;
      if (!sourcePath.startsWith(projectRoot) || !fs.existsSync(sourcePath)) throw new Error(`gold 引用了不存在的来源：${item.id}`);
      const text = fs.readFileSync(sourcePath, 'utf8');
      if ((source.contains || []).some(marker => !text.includes(marker))) throw new Error(`gold 标注与来源不一致：${item.id} ${source.path}`);
    }
  }
  for (const project of projects) {
    const rows = gold.cases.filter(item => item.projectId === project.id);
    if (rows.length !== 30 || rows.filter(item => item.split === 'heldout').length !== 10) throw new Error('每项目必须有 30 问，其中 10 问为保留集');
    const manifest = fs.readFileSync(path.join(FIXTURE_ROOT, 'projects', project.directory, 'interview/project.md'), 'utf8');
    if (rows.some(item => manifest.includes(item.question))) throw new Error('评测问题不得复制成索引别名');
  }
}

function clock() { return performance.now(); }
const rounded = value => Number.isFinite(value) ? +value.toFixed(3) : null;
function latencySummary(values) { return { p50: rounded(percentile(values, .5)), p95: rounded(percentile(values, .95)), samples: values.length }; }
function productionSourceHash() {
  const repo = path.resolve(__dirname, '..');
  const files = ['main.js', 'test/helpers/interview-agent-runtime.js', 'scripts/evaluate-rag.js', 'scripts/lib/rag-eval-metrics.js',
    ...fs.readdirSync(path.join(repo, 'src')).filter(name => /\.(?:js|cjs)$/.test(name)).map(name => 'src/' + name)].sort();
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update(fs.readFileSync(path.join(repo, file))); }
  return hash.digest('hex');
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    console.log('用法：npm run eval:rag -- [--split heldout] [--out /tmp/cue-rag.json]\n延迟：npm run benchmark:rag -- [--iterations 5] [--cpu-contention]\n真实语义：npm run eval:rag:semantic -- --model-dir /已准备模型 --out /tmp/cue-rag-semantic.json\n可选 --samples /已人工审阅样本.json；默认不生成或评判模型答案。');
    return;
  }
  const projects = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'project-list.json'), 'utf8'));
  const gold = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'gold.json'), 'utf8'));
  validateGold(gold, projects);
  const sourceHashAtStart = productionSourceHash();
  const goldHash = createHash('sha256').update(JSON.stringify(gold)).digest('hex');
  const cases = gold.cases.filter(item => opts.split === 'all' || item.split === opts.split);
  const tempParent = opts['data-dir'] ? path.resolve(opts['data-dir']) : os.tmpdir();
  fs.mkdirSync(tempParent, { recursive: true });
  const userData = fs.mkdtempSync(path.join(tempParent, 'cue-rag-evaluation-'));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  let semantic, loadError = null, contentionWorkers = [];
  try {
    let knowledge = require('../src/project-knowledge');
    const importAt = clock();
    // Deliberately import resume #2 before resume #1.
    for (const project of projects) await knowledge.importProjectFolder(path.join(FIXTURE_ROOT, 'projects', project.directory));
    const coldImportAndIndexWarmMs = rounded(clock() - importAt);
    // A fresh module represents a cold process reading the persisted snapshot;
    // the first answer must rebuild local postings, subsequent answers reuse it.
    delete require.cache[require.resolve('../src/project-knowledge')];
    knowledge = require('../src/project-knowledge');
    const { planProjectRetrieval } = require('../src/project-query');
    const { planInterviewQuestion } = require('../src/interview-question-planner');
    const { MODES, getAnswerPlan, contextCharsFor } = require('../src/prompts');
    const { ConversationMemory } = require('../src/conversation-memory');
    const context = require('../src/interview-context');
    const { retrieveProjectEvidenceAsync } = require('../src/retrieval-coordinator');
    if (typeof context.buildInterviewContextBundleAsync !== 'function') throw new Error('异步正式上下文入口尚未导出，不能将新纯函数结果当成正式 typed 评测');
    const catalog = knowledge.getProjectCatalog();
    const missingIds = projects.filter(project => !catalog.some(item => item.projectId === project.id));
    if (missingIds.length) throw new Error('导入清单身份未生效：' + missingIds.map(item => item.id).join(', '));
    if (opts.semantic) {
      semantic = require('../src/project-embeddings').createProjectEmbeddings({
        directory: path.join(userData, 'project-semantic'),
        revisionProvider: knowledge.getProjectIndexRevision
      });
      try {
        await semantic.prepare({ directory: path.resolve(opts['model-dir']) });
        await semantic.indexSnapshot(knowledge.getProjectIndexSnapshot(), { revision: knowledge.getProjectIndexRevision() });
        if (!semantic.status().ready) throw new Error('模型或向量索引未 ready');
      } catch (error) { loadError = { code: error.code || error.name, message: error.message }; }
    }
    const modelStatus = semantic?.status() || { ready: false, reason: 'not-requested' };
    const modes = ['baseline', 'typed', 'fast', 'realtime', ...(semantic && !loadError ? ['semantic'] : [])];
    const settings = {}, reports = [], firstLocalPrepareMs = {};
    const { ActiveProjectContextCache } = require('../src/active-project-context-cache');
    const contextCaches = new Map(modes.map(mode => [mode, new ActiveProjectContextCache()]));

    async function runCase(item, mode, extra = {}) {
      const at = clock(), planAt = clock();
      const interviewPlan = planInterviewQuestion({ text: item.question, mode: 'say', sourceKey: 'eval-' + item.id });
      const planMs = clock() - planAt, routeAt = clock();
      const projectPlan = extra.projectPlan || planProjectRetrieval([{ channel: 'them', text: item.question }], 'say', { catalog, interviewPlan });
      const routeMs = clock() - routeAt;
      const answerPlan = getAnswerPlan(item.question, interviewPlan), contextBudget = contextCharsFor('say', answerPlan);
      const request = { question: item.question, requestId: item.id, epoch: 1, questionVersion: 1,
        sourceKey: 'eval-' + item.id, projectPlan, interviewPlan, contextBudget,
        answerComplexity: answerPlan.level, includeCandidates: true,
        projectContextCache: contextCaches.get(mode),
        semanticRetriever: mode === 'semantic' ? semantic : null, semanticThreshold: opts.semanticThreshold,
        ...(mode === 'fast' ? { hashFallback: false, semanticWaitMs: 0 } : {}), ...extra };
      if (mode === 'realtime') Object.assign(request, { hashFallback: false, semanticWaitMs: 0,
        execution: 'fast', realtimeEvidencePrefetch: true });
      const transcript = [{ channel: 'them', text: item.question }];
      const bundle = mode === 'baseline'
        ? context.buildInterviewContextBundle(settings, 'say', transcript, request)
        : await context.buildInterviewContextBundleAsync(settings, 'say', transcript, request);
      const promptAt = clock();
      const system = MODES.say.buildSystem(bundle.context || '', '', { answerPlan, projectPlan });
      const user = MODES.say.build({ transcript, userText: item.question, answerPlan });
      const prompt = system + '\n' + user;
      const promptPrepareMs = clock() - promptAt;
      const localPrepareMs = clock() - at;
      // The baseline compatibility API returns already selected excerpts. Its
      // candidate pass is reported as compatibility-selected recall, not as
      // access to neural or hidden candidates.
      const candidates = mode === 'baseline'
        ? knowledge.searchProjectKnowledge(projectPlan.query || item.question, { scopes: projectPlan.scopes, limit: 25, maxChars: 9000, minConfidence: 0 })
        : bundle.candidates || [];
      return { ...evaluateCase(item, { evidence: bundle.evidence, candidates, prompt, missing: bundle.missing }),
        latencyMs: rounded(localPrepareMs), routeMs: rounded(routeMs), planMs: rounded(planMs),
        promptPrepareMs: rounded(promptPrepareMs), scopes: projectPlan.scopes || [],
        stats: bundle.stats || {}, estimatedPromptChars: prompt.length,
        sources: (bundle.evidence || []).map(source => ({ id: source.id || null, projectId: source.projectId,
          path: source.path, startLine: source.startLine, endLine: source.endLine,
          docType: source.docType || null, truthScope: source.truthScope || null,
          status: source.status || null, promptVisible: !!source.text && prompt.includes(source.text) })),
        candidateMeasurement: mode === 'baseline' ? 'legacy compatibility selected candidates' : 'pre-selection candidates',
        revision: bundle.revision || knowledge.getProjectIndexRevision() };
    }

    for (const mode of modes) {
      const rows = [];
      for (const item of cases) {
        const row = await runCase(item, mode);
        if (rows.length === 0) firstLocalPrepareMs[mode] = row.latencyMs;
        rows.push(row);
      }
      reports.push({ mode, summary: summarize(rows), development: summarize(rows.filter(row => row.split === 'development')),
        heldout: summarize(rows.filter(row => row.split === 'heldout')), rows });
    }

    const replay = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'replay.json'), 'utf8'));
    const replayResults = [];
    let memory, sequence;
    for (const step of replay.steps) {
      if (sequence !== step.sequence) { memory = new ConversationMemory(); sequence = step.sequence; }
      const interviewPlan = planInterviewQuestion({ text: step.question, mode: 'say', sourceKey: step.id });
      const request = memory.begin({ mode: 'say', question: step.question, catalog, settings, interviewPlan,
        evidenceRevision: knowledge.getProjectIndexRevision() });
      const got = (request.plan.scopes || []).filter(scope => scope.startsWith('@project:')).map(scope => scope.slice(9)).sort();
      const expected = [...step.expectedProjectIds].sort();
      const result = await retrieveProjectEvidenceAsync({ question: step.question, interviewPlan,
        projectPlan: request.plan, contextBudget: 3600, includeCandidates: true, semanticRetriever: null });
      const foreign = result.evidence.filter(item => !expected.includes(item.projectId));
      replayResults.push({ id: step.id, expectedProjectIds: expected, actualProjectIds: got,
        routeMatches: JSON.stringify(got) === JSON.stringify(expected), crossProjectLeaks: foreign.length,
        policy: request.policy, assistantHistoryTurns: (request.turns || []).filter(turn => turn.role === 'assistant').length });
      // No generated facts: a fixed simulation commits only routing/history,
      // while the formal integration suite tests real SDK completion handling.
      memory.commit(request, '这是合成回放的旧建议，不能当成项目事实。', { completion: { complete: true, finishReason: 'stop' }, evidence: result.evidence });
    }

    const { createInterviewRuntime } = require('../test/helpers/interview-agent-runtime');
    const currentSnapshot = knowledge.getProjectIndexSnapshot();
    const importedSnapshot = currentSnapshot.index || currentSnapshot;
    const sdkReplayRows = [], runtimeCleanup = [];
    let runtime;
    sequence = null;
    try {
      for (const step of replay.steps) {
        if (sequence !== step.sequence) {
          if (runtime) { while (runtimeCleanup.length) await runtimeCleanup.pop()(); }
          runtime = createInterviewRuntime({ after: callback => runtimeCleanup.push(callback) }, { indexSnapshot: importedSnapshot });
          sequence = step.sequence;
        }
        const callIndex = runtime.calls.length, eventIndex = runtime.events.length, logIndex = runtime.logs.length;
        runtime.answer('EVAL_HISTORY_' + step.expectedProjectIds.join('_') + '：这是确定性传输模拟的旧建议，不能当项目事实。');
        runtime.final(step.question);
        await runtime.shortcut('CommandOrControl+Return');
        const sdkCall = runtime.calls[callIndex];
        if (!sdkCall) throw new Error('真实 Ctrl+Enter 未发送 SDK 请求：' + step.id);
        const prompt = sdkCall.messages.map(message => typeof message.content === 'string' ? message.content :
          (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
        const request = runtime.requests.at(-1);
        const got = (request.plan.scopes || []).filter(scope => scope.startsWith('@project:')).map(scope => scope.slice(9)).sort();
        const expected = [...step.expectedProjectIds].sort();
        const evidenceEvent = runtime.events.slice(eventIndex).findLast(event => event.channel === 'llm:evidence');
        const sources = evidenceEvent?.sources || [];
        const committedEvidence = runtime.commits.at(-1)?.config?.evidence || [];
        const hiddenSources = sources.filter(source => !prompt.includes(source.text));
        const leakedSources = committedEvidence.filter(source => !expected.includes(source.projectId));
        const foreignAdvice = projects.filter(project => !expected.includes(project.id)).filter(project => prompt.includes('EVAL_HISTORY_' + project.id));
        const promptLog = runtime.logs.slice(logIndex).find(log => String(log[0]).startsWith('[latency][prompt] '));
        const timing = promptLog ? JSON.parse(String(promptLog[0]).slice('[latency][prompt] '.length)) : null;
        sdkReplayRows.push({ id: step.id, expectedProjectIds: expected, actualProjectIds: got,
          routeMatches: JSON.stringify(got) === JSON.stringify(expected), crossProjectLeaks: leakedSources.length,
          foreignAssistantHistory: foreignAdvice.length, sdkVisibleSources: sources.length - hiddenSources.length,
          sourcesHiddenInSdkMessages: hiddenSources.length, maxTokens: sdkCall.max_tokens || sdkCall.max_completion_tokens,
          localPrepareMs: timing?.prepareMs ?? null, promptChars: prompt.length,
          startupChainVerified: ['src/custom-main.js', 'src/bugfix-main.js', 'main.js'].every(file => runtime.loaded.includes(file)) });
      }
    } finally { while (runtimeCleanup.length) await runtimeCleanup.pop()(); }

    let benchmark = null;
    if (opts.benchmark) {
      if (opts['cpu-contention']) {
        const workerCount = Math.min(2, Math.max(1, os.cpus().length - 1));
        contentionWorkers = Array.from({ length: workerCount }, () => new Worker('while (true) { Math.sqrt(Math.random()); }', { eval: true }));
      }
      const latencies = { withoutPrefetch: [], withExactPrefetch: [], workerFailureFallback: [], basicRetrievalWarm: [] };
      for (let iteration = 0; iteration < opts.iterations; iteration++) for (const item of cases) {
        const plain = await runCase(item, 'typed'); latencies.withoutPrefetch.push(plain.latencyMs);
        if (Number.isFinite(plain.stats.retrievalMs)) latencies.basicRetrievalWarm.push(plain.stats.retrievalMs);
        const interviewPlan = planInterviewQuestion({ text: item.question, mode: 'say', sourceKey: 'eval-' + item.id });
        const projectPlan = planProjectRetrieval([{ channel: 'them', text: item.question }], 'say', { catalog, interviewPlan });
        const prefetched = await retrieveProjectEvidenceAsync({ question: item.question, interviewPlan, projectPlan,
          requestId: item.id, epoch: 1, questionVersion: 1, sourceKey: 'eval-' + item.id,
          contextBudget: contextCharsFor('say', getAnswerPlan(item.question, interviewPlan)), includeCandidates: true });
        latencies.withExactPrefetch.push((await runCase(item, 'typed', { prefetchedRetrieval: prefetched })).latencyMs);
        const failing = { modelVersion: 'controlled-unavailable-worker', async queryCandidates() { throw new Error('controlled-worker-failure'); } };
        latencies.workerFailureFallback.push((await runCase(item, 'typed', { semanticRetriever: failing })).latencyMs);
      }
      benchmark = { iterations: opts.iterations, cpuContention: contentionWorkers.length ? 'two or fewer synthetic busy workers; not actual Whisper' : 'none requested',
        measurements: Object.fromEntries(Object.entries(latencies).map(([key, values]) => [key, latencySummary(values)])),
        networkAndModelTTFT: 'not measured: no cloud LLM call', sttToKeyHumanWait: 'not measured: scripted trigger' };
    }
    let generationReview = { status: 'not-run', unsupportedFactRate: null, reason: '没有调用真实 LLM；检索覆盖不能代替回答真实性。' };
    if (opts.samples) {
      const samples = JSON.parse(fs.readFileSync(path.resolve(opts.samples), 'utf8'));
      if (!Array.isArray(samples) || samples.some(sample => !gold.cases.some(item => item.id === sample.caseId) || !Array.isArray(sample.claims) || sample.claims.some(claim => typeof claim.supported !== 'boolean' || !claim.reviewNote))) throw new Error('人工审阅样本需 caseId 与 claims[{supported:boolean,reviewNote}]');
      const claims = samples.flatMap(sample => sample.claims);
      generationReview = { status: 'human-reviewed-external-samples', samples: samples.length, claims: claims.length,
        unsupportedFactRate: claims.length ? claims.filter(claim => !claim.supported).length / claims.length : null };
    }
    const sourceHashAtEnd = productionSourceHash();
    const report = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), synthetic: true,
      reproducibility: { sourceHashAtStart, sourceHashAtEnd, sourceChangedDuringRun: sourceHashAtStart !== sourceHashAtEnd, goldHash },
      environment: { node: process.version, platform: process.platform, arch: process.arch,
        cpuModel: os.cpus()[0]?.model || '', cpuCount: os.cpus().length, memoryGiB: rounded(os.totalmem() / 1024 ** 3) },
      measurementBoundary: '60-case comparison uses real imports/routing/retrieval/context bundle and MODES final message construction. SDK replay runs the real package-entry/runFeature/OpenAI adapter and captures actual outgoing SDK messages; only OS/hardware and SDK streaming transport are controlled. No real cloud LLM or Electron display.',
      input: { split: opts.split, projects: projects.map(project => ({ id: project.id, resumeOrder: project.order })), cases: cases.length },
      model: { requested: !!opts.semantic, ready: !!modelStatus.ready, modelVersion: modelStatus.modelVersion || null,
        semanticAdmissionThreshold: opts.semanticThreshold, thresholdCalibrated: false, error: loadError },
      coldImportAndIndexWarmMs, firstLocalPrepareMs,
      firstRequestBoundary: 'baseline runs first in a fresh index module; later typed/semantic modes reuse postings. Only baseline first request is a cold retrieval process.',
      comparisons: reports,
      replay: { steps: replayResults.length, routeMatches: replayResults.filter(row => row.routeMatches).length,
        crossProjectLeaks: replayResults.reduce((sum, row) => sum + row.crossProjectLeaks, 0), rows: replayResults },
      sdkReplay: { steps: sdkReplayRows.length, routeMatches: sdkReplayRows.filter(row => row.routeMatches).length,
        crossProjectLeaks: sdkReplayRows.reduce((sum, row) => sum + row.crossProjectLeaks, 0),
        foreignAssistantHistory: sdkReplayRows.reduce((sum, row) => sum + row.foreignAssistantHistory, 0),
        sourcesHiddenInSdkMessages: sdkReplayRows.reduce((sum, row) => sum + row.sourcesHiddenInSdkMessages, 0),
        localPrepareMs: latencySummary(sdkReplayRows.map(row => row.localPrepareMs)), rows: sdkReplayRows },
      benchmark, generationReview,
      limitations: ['Static public heldout set is not a future independent blind test.', 'Candidate source recall permits equivalent source paths; final prompt coverage additionally requires critical exact fact markers.',
        'Latency is machine-specific local preparation; it does not measure network/model/UI first-token delay.', 'Missing types are aggregated per question; entity-specific missing correctness needs human review.']
    };
    if (opts.out) { fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true }); fs.writeFileSync(path.resolve(opts.out), JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify({ comparisons: reports.map(({ mode, summary }) => ({ mode, ...summary })), replay: { routeMatches: report.replay.routeMatches, steps: report.replay.steps, crossProjectLeaks: report.replay.crossProjectLeaks },
      sdkReplay: { routeMatches: report.sdkReplay.routeMatches, steps: report.sdkReplay.steps, crossProjectLeaks: report.sdkReplay.crossProjectLeaks,
        foreignAssistantHistory: report.sdkReplay.foreignAssistantHistory, sourcesHiddenInSdkMessages: report.sdkReplay.sourcesHiddenInSdkMessages, localPrepareMs: report.sdkReplay.localPrepareMs },
      coldImportAndIndexWarmMs, firstLocalPrepareMs, model: report.model, benchmark, generationReview,
      reportFile: opts.out ? path.resolve(opts.out) : null }, null, 2));
    if (loadError) process.exitCode = 2;
  } finally {
    for (const worker of contentionWorkers) await worker.terminate();
    await semantic?.close();
    Module._load = originalLoad;
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(`[rag-eval] ${error.message}`); process.exitCode = 1; });
