'use strict';

// Sequential real-package-entry replay. The default transport is deterministic
// and offline; --live is required before any provider request can be sent.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const { createInterviewRuntime, currentText } = require('../test/helpers/interview-agent-runtime');
const { createEvidenceRuntime } = require('../test/helpers/realtime-evidence-runtime');
const root = path.resolve(__dirname, '..');
const BASE_REF = 'd6dab06009ce9a79c41e9e3782438c3265cd89dd';
const SOURCE_FILES = [
  'main.js', 'src/custom-main.js', 'src/build-info.js', 'src/store.js',
  'src/stt.js', 'src/stt-streaming.js', 'src/stt-providers/qwen.js', 'src/local-whisper-transcriber.js',
  'src/question-resolver.js', 'src/conversation-memory.js',
  'src/instant-answer-policy.js', 'src/instant-answer-context.js',
  'src/instant-ready-evidence.js', 'src/project-rag-session.js',
  'src/active-project-context-cache.js', 'src/llm.js', 'src/model-latency-policy.js',
  'src/openai-compatible.js', 'src/reply-latency.js',
  'scripts/benchmark-instant-answer.cjs', 'test/helpers/interview-agent-runtime.js'
];
const CONFIGURATIONS = [
  { id: 'A', label: 'standard policy control', settings: { realtimeAnswerMode: 'standard', instantExperiment: '' } },
  { id: 'B', label: 'standard prompt/model, foreground RAG off only', settings: { realtimeAnswerMode: 'standard', instantExperiment: 'rag-off' } },
  { id: 'C', label: 'instant current-only context, standard execution profile', settings: { realtimeAnswerMode: 'instant', instantExperiment: 'context-only' } },
  { id: 'D', label: 'instant current-only context, request-level fast profile', settings: { realtimeAnswerMode: 'instant', instantExperiment: '' } }
];
const QUESTIONS = [
  { id: 'implementation', text: '松塔订单的缓存如何实现？', project: '松塔订单' },
  { id: 'decision', text: '松塔订单的缓存为什么这样选？有哪些代价？', project: '松塔订单' },
  { id: 'ownership', text: '松塔订单的缓存这部分你具体负责什么？', project: '松塔订单' },
  { id: 'generic', text: 'Redis 的持久化机制是什么？' },
  { id: 'constraints', text: '在库存不能超卖、数据库不能扩容且 P95 不超过 80ms 的条件下，怎么设计？为什么？失败如何恢复？' }
];
const OLD_QUESTION = 'Redis 的持久化机制是什么？';
const SYNTHETIC_ANSWER = '我会先明确一致性边界，再用版本校验与幂等重试实现缓存读取。选型时同时核对失效代价和故障恢复路径。';
const tick = () => new Promise(resolve => setImmediate(resolve));
const digest = value => createHash('sha256').update(value).digest('hex');
const normalizeQuestion = value => String(value || '').normalize('NFKC').replace(/[ \t]+/g, ' ').replace(/\s+([，。！？；：,.!?;:])/g, '$1').trim();
const cleanup = () => { const callbacks = []; return { after: fn => callbacks.push(fn), close: async () => { for (const fn of callbacks.reverse()) await fn(); } }; };
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const distribution = values => {
  values = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null };
};
function argument(args, name, fallback) {
  const at = args.indexOf('--' + name);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error('Missing value for --' + name);
  return args[at + 1];
}
function parseArguments(args = process.argv.slice(2)) {
  const live = args.includes('--live');
  const parsed = {
    live,
    samples: Number(argument(args, 'samples', 30)),
    coldSamples: Number(argument(args, 'cold-samples', 30)),
    sizes: String(argument(args, 'sizes', live ? 'small' : 'small,4000,14000')).split(','),
    scenarios: String(argument(args, 'scenarios', live ? 'no-doc' : 'no-doc,cold,warm-ready,no-match,hung-prefetch')).split(','),
    triggers: String(argument(args, 'triggers', live ? 'text' : 'text,asr-replay')).split(','),
    settingsPath: argument(args, 'settings', ''),
    out: path.resolve(argument(args, 'out', path.join(os.tmpdir(), live ? 'cue-instant-live.json' : 'cue-instant-offline.json'))),
    transportMs: Number(argument(args, 'transport-ms', 5)),
    cpuContention: args.includes('--cpu-contention'),
    maxAttempts: Number(argument(args, 'max-attempts', 0))
  };
  for (const [name, value] of [['samples', parsed.samples], ['cold-samples', parsed.coldSamples]]) {
    if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('Invalid --' + name + ' (1..1000)');
  }
  if (!Number.isInteger(parsed.maxAttempts) || parsed.maxAttempts < 0 || parsed.maxAttempts > 3000) throw new Error('Invalid --max-attempts');
  if (!Number.isFinite(parsed.transportMs) || parsed.transportMs < 0 || parsed.transportMs > 1000) throw new Error('Invalid --transport-ms');
  if (parsed.sizes.some(size => !['small', '4000', '14000'].includes(size))) throw new Error('Unsupported --sizes');
  if (parsed.scenarios.some(scenario => !['no-doc', 'cold', 'warm-ready', 'no-match', 'hung-prefetch'].includes(scenario))) throw new Error('Unsupported --scenarios');
  if (parsed.triggers.some(trigger => !['text', 'asr-replay'].includes(trigger))) throw new Error('Unsupported --triggers');
  if (live && !parsed.settingsPath) throw new Error('--live requires --settings pointing to an existing cue-data.json. No provider call was sent.');
  return parsed;
}
function sourceHashes() {
  return Object.fromEntries(SOURCE_FILES.filter(file => fs.existsSync(path.join(root, file)))
    .map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
}
function parseLogs(runtime, prefix, after = 0) {
  return runtime.logs.slice(after).flatMap(args => {
    const line = String(args[0]);
    if (!line.startsWith(prefix)) return [];
    try { return [JSON.parse(line.slice(prefix.length))]; } catch (_) { return []; }
  });
}
function latestLog(runtime, prefix, after = 0) { return parseLogs(runtime, prefix, after).at(-1) || {}; }
function safeErrorCode(error) {
  const message = String(error?.message || error || '');
  if (/abort|取消/i.test(message)) return 'aborted';
  if (/timeout|timed out|超时/i.test(message)) return 'timeout';
  if (/429|频率|额度/.test(message)) return 'rate-limited';
  if (/401|403|密钥|认证/.test(message)) return 'authentication-or-permission';
  return 'request-failed';
}
function selectLiveConfiguration(settings) {
  const provider = settings.provider;
  const allowed = ['provider', 'baseUrl', 'smart', 'minimaxRegion', 'azureEndpoint', 'contextWindowTokens'];
  const selected = Object.fromEntries(allowed.filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]]));
  for (const key of ['apiKeys', 'models', 'providerOptions', 'instantProviderOptions']) {
    if (settings[key] && Object.hasOwn(settings[key], provider)) selected[key] = { [provider]: settings[key][provider] };
  }
  return selected;
}
function readLiveSettings(file) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (_) { throw new Error('Cannot read --settings as cue-data JSON. No provider call was sent.'); }
  if (!['openai', 'custom', 'groq', 'minimax'].includes(settings.provider)) {
    throw new Error('This diagnostic live bridge supports openai/custom/groq/minimax only. Use the app timing logs for other adapters. No provider call was sent.');
  }
  // Use the existing application's own configuration validation. Never print
  // the settings object, API key, endpoint, request messages or provider errors.
  settings = selectLiveConfiguration(settings);
  const { createLLM } = require('../src/llm');
  for (const executionProfile of ['standard', 'instant']) {
    const llm = createLLM(settings, { executionProfile });
    if (!llm.ready) throw new Error('Existing provider/model settings are not ready for ' + executionProfile + '. No provider call was sent.');
  }
  return settings;
}
async function makeSnapshot(size) {
  const t = cleanup();
  try {
    const r = await createEvidenceRuntime(t, { settings: { realtimeAnswerMode: 'standard' } });
    const index = JSON.parse(JSON.stringify(r.exports('src/project-knowledge.js').getProjectIndexSnapshot().index));
    const target = size === 'small' ? index.chunks.length : Number(size);
    const own = Object.fromEntries(index.projects.map(project => [project.id, index.chunks.filter(chunk => chunk.projectId === project.id).length]));
    for (let i = index.chunks.length; i < target; i++) {
      const project = index.projects[i % index.projects.length], n = own[project.id]++;
      index.chunks.push({ id: project.id + ':instant-noise-' + n, projectId: project.id, projectName: project.name,
        path: `src/Noise${Math.floor(n / 4)}.java`, kind: 'method', symbol: `Noise${Math.floor(n / 4)}#method${n % 4}`,
        startLine: n % 4 * 8 + 1, endLine: n % 4 * 8 + 5,
        docType: 'implementation', truthScope: 'implemented', status: 'confirmed',
        text: `public String method${n % 4}() { return catalog.lookup("noise-${n}"); }`,
        retrievalText: `${project.name}\n无关目录条目 ${n} public String method${n % 4}() { return catalog.lookup("noise-${n}"); }` });
    }
    for (const project of index.projects) {
      project.stats.chunkCount = own[project.id];
      project.stats.fileCount = Math.ceil(own[project.id] / 4) + 12;
      if (project.stats.chunkCount > 7000 || project.stats.fileCount > 1800) throw new Error('Synthetic fixture exceeds per-project import limits');
    }
    return index;
  } finally { await t.close(); }
}
const emptyIndex = () => ({ version: 2, chunkerVersion: 4, metadataSchemaVersion: 3, projects: [], chunks: [], stats: {} });
function installTransport(runtime, options) {
  if (options.live) {
    const OpenAI = require('openai');
    const clients = new Map();
    runtime.behavior((body, sdkOptions, _index, config) => {
      if (!config || typeof config !== 'object') throw new Error('Diagnostic live bridge needs SDK constructor configuration support; no provider request was sent.');
      // Credentials stay only inside this closure and the real SDK. No config
      // serialization is emitted to stdout or persisted in benchmark results.
      const identity = digest(JSON.stringify([config.apiKey, config.baseURL, config.maxRetries, config.timeout]));
      let client = clients.get(identity);
      if (!client) { client = new OpenAI(config); clients.set(identity, client); }
      return client.chat.completions.create(body, sdkOptions);
    });
  } else {
    runtime.behavior(async () => {
      if (options.transportMs) await new Promise(resolve => setTimeout(resolve, options.transportMs));
      return (async function* () {
        yield { choices: [{ delta: {} }] };
        yield { choices: [{ delta: { reasoning_content: 'SYNTHETIC_REASONING_EVENT' } }] };
        yield { choices: [{ delta: { content: ' ' } }] };
        await tick();
        yield { choices: [{ delta: { content: SYNTHETIC_ANSWER.slice(0, SYNTHETIC_ANSWER.indexOf('。') + 1) } }] };
        await tick();
        yield { choices: [{ delta: { content: SYNTHETIC_ANSWER.slice(SYNTHETIC_ANSWER.indexOf('。') + 1) }, finish_reason: 'stop' }] };
      })();
    });
  }
}
async function waitForBackground(runtime) {
  const until = performance.now() + 1500;
  while (performance.now() < until) {
    if (!runtime.value('!!ragSession.running || !!ragSession.pending')) return true;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  return false;
}
function setupRuntime(t, index, scenario, configuration, options, liveSettings) {
  const runtime = createInterviewRuntime(t, {
    indexSnapshot: scenario === 'no-doc' ? emptyIndex() : index,
    coldIndex: scenario === 'cold',
    settings: {
      provider: 'custom', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKeys: { custom: 'test-transport-only' }, smart: true,
      models: { custom: { fast: 'qwen-flash', smart: 'qwen-flash' } },
      ...liveSettings, ...configuration.settings
    },
    ...(scenario === 'hung-prefetch' ? { semanticRetriever: {
      status: () => ({ modelVersion: 'synthetic-never-completes', modelReady: true }),
      resetSession() {}, invalidate() {}, indexSnapshot: async () => {},
      queryCandidates: () => new Promise(() => {})
    } } : {})
  });
  installTransport(runtime, options);
  return runtime;
}
function sampleQuestion(index, scenario) {
  if (scenario === 'no-match') return { id: 'unmatched-symbol', text: '松塔订单的 UnknownLedgerService 事务补偿在哪里实现？', project: '松塔订单' };
  if (scenario === 'warm-ready') return QUESTIONS[index % 3];
  return QUESTIONS[index % QUESTIONS.length];
}
async function prepareWarm(runtime, scenario, trigger, question) {
  if (scenario !== 'warm-ready') return null;
  runtime.final(question.text);
  await waitForBackground(runtime);
  return null;
}
function valueOrNull(...values) { return values.find(value => value !== null && value !== undefined) ?? null; }
async function runSample(runtime, options, configuration, scenario, trigger, item, index) {
  const callStart = runtime.calls.length, commitStart = runtime.commits.length, logStart = runtime.logs.length, eventStart = runtime.events.length;
  const before = performance.now();
  let thrown = null;
  try {
    if (trigger === 'asr-replay') {
      runtime.final(OLD_QUESTION);
      runtime.advance(500);
      runtime.value("send('vad:state', {channel:'them', speaking:false})");
      runtime.final(item.text);
      await runtime.shortcut('CommandOrControl+Return');
    } else {
      await runtime.ask('say', item.text);
    }
  } catch (error) { thrown = safeErrorCode(error); }
  const wallRoundTripMs = +(performance.now() - before).toFixed(3);
  const prompt = latestLog(runtime, '[latency][prompt] ', logStart);
  const replies = parseLogs(runtime, '[latency][reply] ', logStart);
  const firstReply = replies.find(row => row.triggerToFirstContentMs != null || row.llmFirstTokenMs != null || row.firstContentMs != null) || {};
  const endReply = replies.at(-1) || {};
  const metricsEvent = runtime.events.slice(eventStart).findLast(event => event.channel === 'llm:metrics') || {};
  const profile = runtime.events.slice(eventStart).findLast(event => event.channel === 'llm:profile') || {};
  const lastCall = runtime.calls.length > callStart ? runtime.calls.at(-1) : null;
  const request = runtime.requests.at(-1);
  const errorEvent = runtime.events.slice(eventStart).find(event => event.channel === 'llm:error');
  const outcome = thrown || (errorEvent ? safeErrorCode(errorEvent.message) : !lastCall ? 'no-sdk-call' : 'success');
  const sentText = lastCall ? currentText(lastCall) : '';
  const selected = runtime.events.slice(eventStart).findLast(event => event.channel === 'llm:evidence');
  const timing = { ...firstReply, ...endReply, ...metricsEvent };
  const sourceList = selected?.sources || [];
  const completion = runtime.commits.length > commitStart ? runtime.commits.at(-1)?.config?.completion || {} : {};
  return {
    configuration: configuration.id, scenario, sample: index,
    questionKey: item.id, questionHash: digest(item.text), normalizedQuestionHash: digest(normalizeQuestion(item.text)),
    actualQuestionHash: digest(normalizeQuestion(request?.question)), trigger, outcome,
    sdkCalls: runtime.calls.length - callStart,
    providerComplete: typeof completion.complete === 'boolean' ? completion.complete : null,
    truncated: completion.truncated === true,
    refused: completion.refused === true,
    questionCorrect: !!lastCall && normalizeQuestion(request?.question) === normalizeQuestion(item.text) && normalizeQuestion(sentText).includes(normalizeQuestion(item.text)),
    oldTargetInCurrentUserMessage: normalizeQuestion(item.text) !== normalizeQuestion(OLD_QUESTION) && normalizeQuestion(sentText).includes(normalizeQuestion(OLD_QUESTION)),
    historyMessageCount: lastCall ? lastCall.messages.slice(1, -1).filter(message => ['user', 'assistant'].includes(message.role)).length : null,
    requestId: valueOrNull(prompt.requestId, timing.requestId),
    epoch: valueOrNull(prompt.epoch, timing.epoch),
    questionId: valueOrNull(prompt.questionId, timing.questionId),
    questionRevision: valueOrNull(prompt.questionRevision, timing.questionRevision),
    executionProfile: valueOrNull(profile.executionProfile, timing.executionProfile, prompt.executionProfile),
    modelProfile: valueOrNull(prompt.modelProfile, profile.modelProfile),
    buildCommit: valueOrNull(profile.buildCommit, timing.buildCommit, prompt.buildCommit),
    sourceDirty: valueOrNull(profile.sourceDirty, timing.sourceDirty, prompt.sourceDirty),
    endpointClass: valueOrNull(profile.endpointClass, profile.diagnostics?.endpointClass, prompt.endpointClass),
    provider: valueOrNull(profile.provider, timing.provider, prompt.provider),
    model: valueOrNull(profile.model, timing.model, prompt.model, lastCall?.model),
    thinkingStatus: valueOrNull(profile.thinkingStatus, profile.thinking?.status),
    effectiveThinkingParameters: lastCall ? Object.fromEntries(['enable_thinking', 'reasoning_effort'].filter(key => Object.hasOwn(lastCall, key)).map(key => [key, lastCall[key]])) : {},
    maxOutputTokens: valueOrNull(lastCall?.max_tokens, lastCall?.max_completion_tokens),
    ragPolicy: valueOrNull(prompt.ragPolicy, timing.ragPolicy, prompt.retrieval?.ragPolicy),
    readyEvidenceHit: valueOrNull(prompt.readyEvidenceHit, timing.readyEvidenceHit, prompt.retrieval?.readyEvidenceHit),
    skippedReason: valueOrNull(prompt.skippedReason, timing.skippedReason, prompt.retrieval?.skippedReason),
    sourceCount: sourceList.length,
    sourceChars: sourceList.reduce((count, source) => count + String(source.text || '').length, 0),
    inputTokensEstimate: valueOrNull(prompt.finalBudget?.estimatedInputTokens, prompt.inputTokensEstimate),
    actualInputTokens: valueOrNull(timing.actualInputTokens),
    optionalContextTokensEstimate: valueOrNull(prompt.optionalContextTokensEstimate, timing.optionalContextTokensEstimate),
    triggerToDispatchMs: valueOrNull(timing.triggerToDispatchMs, prompt.triggerToDispatchMs, prompt.prepareMs),
    firstReasoningMs: valueOrNull(timing.firstReasoningMs, timing.reasoningStartedMs),
    providerResponseMs: valueOrNull(timing.providerResponseMs),
    firstContentMs: valueOrNull(timing.firstContentMs, timing.llmFirstTokenMs),
    triggerToFirstContentMs: valueOrNull(timing.triggerToFirstContentMs, timing.requestToFirstTokenMs),
    triggerToFirstUsefulSentenceMs: valueOrNull(timing.triggerToFirstUsefulSentenceMs),
    questionAgeMs: valueOrNull(timing.questionAgeMs, timing.finalAgeAtRequestMs),
    questionSource: valueOrNull(timing.questionSource, timing.input),
    queueDelayMs: valueOrNull(timing.queueDelayMs),
    aborted: outcome === 'aborted',
    asrLagMs: valueOrNull(timing.asrLagMs),
    localEndpointLagMs: valueOrNull(timing.vadEndToFinalMs),
    readyEvidenceReadMs: valueOrNull(prompt.retrieval?.readyEvidenceReadMs, prompt.retrieval?.readyEvidenceMs, prompt.retrieval?.peekMs, timing.readyEvidenceReadMs),
    renderAckMs: null, paintApproxMs: null,
    frontendSearchCalls: prompt.retrieval?.searchCalls ?? null,
    wallRoundTripMs
  };
}
function summarizeRecords(records) {
  const ok = records.filter(record => record.outcome === 'success');
  const count = outcome => records.filter(record => record.outcome === outcome).length;
  const metrics = ['triggerToDispatchMs', 'firstContentMs', 'triggerToFirstContentMs',
    'triggerToFirstUsefulSentenceMs', 'providerResponseMs', 'firstReasoningMs',
    'optionalContextTokensEstimate', 'inputTokensEstimate', 'readyEvidenceReadMs', 'wallRoundTripMs'];
  return {
    attempts: records.length, validSamples: ok.length,
    failureRate: records.length ? (records.length - ok.length) / records.length : null,
    timeoutRate: records.length ? count('timeout') / records.length : null,
    cancellationRate: records.length ? count('aborted') / records.length : null,
    questionCorrect: ok.filter(row => row.questionCorrect).length,
    questionIncorrect: ok.filter(row => !row.questionCorrect).length,
    oldTargetInCurrentUserMessage: ok.filter(row => row.oldTargetInCurrentUserMessage).length,
    multipleSdkRequests: records.filter(row => row.sdkCalls > 1).length,
    truncatedResponses: records.filter(row => row.truncated).length,
    refusedResponses: records.filter(row => row.refused).length,
    readyEvidenceHits: ok.filter(row => row.readyEvidenceHit === true).length,
    sourceCountMax: ok.length ? Math.max(...ok.map(row => row.sourceCount)) : null,
    sourceCharsMax: ok.length ? Math.max(...ok.map(row => row.sourceChars)) : null,
    metrics: Object.fromEntries(metrics.map(metric => [metric, distribution(ok.map(row => row[metric]))]))
  };
}
async function runGroup(index, scenario, trigger, options, liveSettings) {
  const rows = Object.fromEntries(CONFIGURATIONS.map(configuration => [configuration.id, []]));
  const holders = new Map(), delay = monitorEventLoopDelay({ resolution: 1 });
  const samples = scenario === 'cold' ? options.coldSamples : options.samples;
  const attemptsLimit = options.maxAttempts || (options.live ? samples * 3 : samples);
  try {
    if (scenario !== 'cold') {
      for (const configuration of CONFIGURATIONS) {
        const t = cleanup(), runtime = setupRuntime(t, index, scenario, configuration, options, liveSettings);
        holders.set(configuration.id, { t, runtime });
        await runtime.ready;
      }
    }
    delay.enable();
    for (let i = 0; i < attemptsLimit; i++) {
      // Rotate sequential order to reduce a fixed A-first warmup bias. There is
      // never a burst of simultaneous provider calls in --live mode.
      const order = CONFIGURATIONS.map((_, offset) => CONFIGURATIONS[(i + offset) % CONFIGURATIONS.length]);
      for (const configuration of order) {
        if (rows[configuration.id].filter(row => row.outcome === 'success').length >= samples) continue;
        const holder = scenario === 'cold' ? { t: cleanup() } : holders.get(configuration.id);
        if (scenario === 'cold') holder.runtime = setupRuntime(holder.t, index, scenario, configuration, options, liveSettings);
        const { runtime } = holder;
        try {
          await runtime.ready;
          const item = sampleQuestion(i, scenario);
          await prepareWarm(runtime, scenario, trigger, item);
          rows[configuration.id].push(await runSample(runtime, options, configuration, scenario, trigger, item, i));
          await tick();
        } finally { if (scenario === 'cold') await holder.t.close(); }
      }
    }
    return {
      scenario, trigger, chunks: scenario === 'no-doc' ? 0 : index.chunks.length,
      projectCount: scenario === 'no-doc' ? 0 : index.projects.length,
      requestedValidSamplesPerConfiguration: samples,
      eventLoopMs: { p50: delay.percentile(50) / 1e6, p95: delay.percentile(95) / 1e6, max: delay.max / 1e6,
        boundary: 'whole interleaved group, includes benchmark setup/seed work; not isolated trigger latency' },
      configurations: CONFIGURATIONS.map(configuration => ({ id: configuration.id, label: configuration.label,
        summary: summarizeRecords(rows[configuration.id]), samples: rows[configuration.id] }))
    };
  } finally {
    delay.disable();
    for (const holder of holders.values()) await holder.t.close();
  }
}
async function main(options = parseArguments()) {
  const liveSettings = options.live ? readLiveSettings(options.settingsPath) : {};
  const hashesAtStart = sourceHashes();
  const contention = options.cpuContention ? new Worker(`
    const {parentPort}=require('node:worker_threads');let running=true;
    parentPort.on('message',()=>running=false);
    function work(){const end=Date.now()+15;let n=0;while(Date.now()<end)n+=Math.sqrt(n+Math.random());if(running)setImmediate(work);else parentPort.close();}work();
  `, { eval: true }) : null;
  try {
    const result = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), baseRef: BASE_REF,
      scope: options.live ? 'Text/ASR-event-replay through actual package entry and live OpenAI-compatible SDK bridge; no physical ASR or renderer.'
        : 'Offline actual package-entry replay with synthetic SDK response. No online model, real ASR, E5 inference, WAN or renderer.',
      live: options.live, syntheticTransportMs: options.live ? null : options.transportMs,
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpuModel: os.cpus()[0]?.model, cpuCount: os.cpus().length },
      cpuContention: options.cpuContention,
      measurementNotes: [
        'All four policies include the final shared QuestionResolver bugfix; A is not an archived old commit.',
        'B changes foreground RAG only; C adds instant context but keeps standard model profile; D requests the configured fast tier. Actual model/options are recorded per sample.',
        'One provider request at a time, rotating A/B/C/D order; percentile samples exclude failed/canceled requests, rates retain every attempt.',
        'asr-replay means accepted synthetic ASR/VAD events plus the real shortcut. It does not measure real microphone/remote audio, recognition or physical speech end.',
        'first useful sentence uses a sentence-end heuristic, not semantic quality grading. The offline response text is fixed and does not prove generated answer correctness.',
        'No renderer runs in this harness, so renderAckMs/paintApproxMs are null.',
        'Offline first-content values include an intentionally synthetic provider delay; they are never claims about online TTFT.',
        'Pressure snapshots start from real imported fixtures; noise is synthetic and stays within 7000 chunks/1800 files per project.',
        'Warm-ready seeds run outside per-request timing. Whole-group event-loop statistics include seed and setup work.',
        'Live settings import is limited to current-provider credentials/model/transport/window configuration; private resume/stories/project material/style/history and stale experiment settings are never imported.',
        'Live 30-sample P95 is exploratory; use more samples for confirmation, record rates and compare actual provider/model/endpoint class.'
      ],
      configuration: { samples: options.samples, coldSamples: options.coldSamples, sizes: options.sizes,
        scenarios: options.scenarios, triggers: options.triggers, requestedSettingsFile: options.live ? 'explicit existing cue-data.json (path omitted)' : null },
      sourceHashesAtStart: hashesAtStart, groups: []
    };
    for (const size of options.sizes) {
      const index = await makeSnapshot(size);
      for (const scenario of options.scenarios) {
        if (scenario === 'no-doc' && size !== options.sizes[0]) continue;
        for (const trigger of options.triggers) {
          const group = await runGroup(index, scenario, trigger, options, liveSettings);
          result.groups.push(group);
          process.stderr.write(`measured ${scenario} ${index.chunks.length} ${trigger}\n`);
        }
      }
    }
    result.sourceHashesAtEnd = sourceHashes();
    result.sourceChangedDuringRun = JSON.stringify(result.sourceHashesAtStart) !== JSON.stringify(result.sourceHashesAtEnd);
    result.liveTargets = options.live ? { realAudio: 'unmeasured', physicalUI: 'unmeasured',
      note: 'Read reply/UI timing logs in the actual Windows app for real ASR and DOM/paint-approximate checks.' } : null;
    await fs.promises.mkdir(path.dirname(options.out), { recursive: true });
    await fs.promises.writeFile(options.out, JSON.stringify(result, null, 2) + '\n');
    const failures = result.groups.flatMap(group => group.configurations.filter(configuration => configuration.summary.validSamples < group.requestedValidSamplesPerConfiguration));
    const incorrectInstant = result.groups.flatMap(group => group.configurations.filter(configuration => ['C', 'D'].includes(configuration.id) && configuration.summary.questionIncorrect > 0));
    console.log(JSON.stringify({ output: options.out, sourceChangedDuringRun: result.sourceChangedDuringRun,
      groups: result.groups.map(group => ({ scenario: group.scenario, chunks: group.chunks, trigger: group.trigger,
        configurations: group.configurations.map(({ id, summary }) => ({ id, validSamples: summary.validSamples,
          failures: summary.attempts - summary.validSamples, incorrect: summary.questionIncorrect,
          dispatchP95: summary.metrics.triggerToDispatchMs.p95, contentP95: summary.metrics.triggerToFirstContentMs.p95 })) })) }, null, 2));
    if (result.sourceChangedDuringRun) process.exitCode = 2;
    else if (failures.length) process.exitCode = 3;
    else if (incorrectInstant.length) process.exitCode = 4;
    return result;
  } finally { await contention?.terminate(); }
}
if (require.main === module) {
  if (process.argv.includes('--help')) {
    process.stdout.write('Offline: node scripts/benchmark-instant-answer.cjs --samples 30 --cold-samples 30 --out /tmp/cue-instant.json\n' +
      'CPU: add --cpu-contention; narrow runs with --sizes small,4000,14000 --scenarios no-doc,cold,warm-ready,no-match,hung-prefetch --triggers text,asr-replay\n' +
      'Live (explicit provider use): node scripts/benchmark-instant-answer.cjs --live --settings <existing-cue-data.json> --samples 30 --out <result.json>\n' +
      'Live bridge supports configured OpenAI-compatible adapters only. Actual audio and renderer timing require the running app. Keys, endpoints, raw prompts and answers are omitted from result files.\n');
  } else {
    main().catch(error => { console.error(error?.message || 'Benchmark failed'); process.exitCode = 1; });
  }
}
module.exports = { parseArguments, normalizeQuestion, selectLiveConfiguration, distribution, summarizeRecords, main, CONFIGURATIONS };
