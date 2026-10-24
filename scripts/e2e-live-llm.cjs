#!/usr/bin/env node
'use strict';

// This runner does not build prompts. The package entry and root main own
// transcript resolution, ConversationMemory, material selection and LLM calls.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createInterviewRuntime } = require('../test/helpers/interview-agent-runtime');
const { writeReports, sanitizeText } = require('./lib/live-evaluation-report.cjs');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'evaluation/cue-live');
const DEFAULTS = Object.freeze({ mode: 'smoke', provider: 'all', mock: false,
  outputDir: path.join(ROOT, 'artifacts/llm-live'), maxCalls: 60, maxCallsPerProvider: 30,
  maxOutputTokens: 1800, firstContentTimeoutMs: 10000, totalTimeoutMs: 30000 });
const usageKeys = ['actualInputTokens', 'actualOutputTokens', 'actualTotalTokens', 'cachedInputTokens', 'actualReasoningTokens'];

function parseArgs(args) {
  const options = { ...DEFAULTS };
  const values = { '--mode': 'mode', '--provider': 'provider', '--output-dir': 'outputDir', '--max-calls': 'maxCalls',
    '--max-calls-per-provider': 'maxCallsPerProvider', '--max-output-tokens': 'maxOutputTokens',
    '--first-content-timeout-ms': 'firstContentTimeoutMs', '--total-timeout-ms': 'totalTimeoutMs' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--mock') options.mock = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (values[argument] && args[index + 1] && !args[index + 1].startsWith('--')) options[values[argument]] = args[++index];
    else throw new Error('Unknown argument or missing argument value. Use --help.');
  }
  if (!['smoke', 'full'].includes(options.mode) || !['qwen', 'deepseek', 'all'].includes(options.provider)) throw new Error('Invalid mode or provider.');
  for (const [key, ceiling] of Object.entries({ maxCalls: 20000, maxCallsPerProvider: 10000, maxOutputTokens: 16384,
    firstContentTimeoutMs: 120000, totalTimeoutMs: 120000 })) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > ceiling) throw new Error(`Invalid ${key}; hard limit is ${ceiling}.`);
  }
  if (options.firstContentTimeoutMs > options.totalTimeoutMs) throw new Error('First-content timeout cannot exceed total timeout.');
  options.outputDir = path.resolve(options.outputDir);
  return options;
}

function help() {
  return `CUE production-chain LLM evaluation\n\n` +
    `node scripts/e2e-live-llm.cjs [--mode smoke|full] [--provider all|qwen|deepseek]\n` +
    `  --output-dir DIR                 report.json + report.md (default artifacts/llm-live)\n` +
    `  --mock                           explicit offline transport; never a live quality result\n` +
    `  --max-calls N                     default 60; ceiling 20000; includes failed attempts\n` +
    `  --max-calls-per-provider N        default 30; ceiling 10000\n` +
    `  --max-output-tokens N             default 1800; ceiling 16384; production request unchanged\n` +
    `  --first-content-timeout-ms N      default 10000; ceiling 120000; reasoning is not content\n` +
    `  --total-timeout-ms N              default 30000; ceiling 120000\n\n` +
    `Live configuration (all selected provider values required):\n` +
    `QWEN_API_KEY, QWEN_MODEL, QWEN_BASE_URL\nDEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL\n` +
    `Keys come only from environment and stay in memory. HTTPS endpoints only.\n` +
    `Smoke: 6 questions/provider. Full: 24/provider. Serial execution; SDK retries=0.\n` +
    `Only hash-approved evaluation/cue-live inputs are accepted. Missing config/network fails.\n` +
    `Partial reports are saved after every question; GitHub Job Summary is written on exit.\n`;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function fixtureFile(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Invalid approved fixture path.');
  const full = path.join(FIXTURES, relative);
  if (!fs.realpathSync(full).startsWith(fs.realpathSync(FIXTURES) + path.sep) || fs.lstatSync(full).isSymbolicLink()) throw new Error('Approved fixture escapes fixture directory.');
  return full;
}
function loadFixtures() {
  const approval = readJson(path.join(FIXTURES, 'approval.json'));
  if (approval.ciApproved !== true || approval.allowAnswerArtifacts !== true || !Array.isArray(approval.inputFiles)) throw new Error('Fixture approval must explicitly allow CI and answer artifacts.');
  const approved = new Set();
  for (const record of approval.inputFiles) {
    const full = fixtureFile(record.path);
    if (!/^[a-f0-9]{64}$/.test(record.sha256) || createHash('sha256').update(fs.readFileSync(full)).digest('hex') !== record.sha256) throw new Error('Approved fixture digest mismatch.');
    approved.add(record.path);
  }
  for (const required of ['cases.json', 'materials/facts.json', 'materials/profile.json']) if (!approved.has(required)) throw new Error('Required fixture is not approved.');
  // Folder imports must not discover additional unapproved files, including
  // symlinks or files hidden from the source indexer's normal extension filter.
  for (const project of ['cae', 'arclight']) {
    const folder = 'materials/sources/' + project;
    const visit = relative => {
      for (const entry of fs.readdirSync(fixtureFile(relative), { withFileTypes: true })) {
        const name = relative + '/' + entry.name;
        if (entry.isSymbolicLink()) throw new Error('Unapproved fixture symlink.');
        if (entry.isDirectory()) visit(name);
        else if (!entry.isFile() || !approved.has(name)) throw new Error('Unapproved source fixture file.');
      }
    };
    visit(folder);
  }
  const suite = readJson(fixtureFile('cases.json'));
  if (suite.schemaVersion !== 1 || !Array.isArray(suite.cases) || suite.cases.length < 20 || suite.cases.length > 30 || !Array.isArray(suite.smokeCaseIds)) throw new Error('Evaluation suite must contain 20–30 cases and an explicit smoke selection.');
  const ids = new Set();
  for (const item of suite.cases) {
    if (!item.id || ids.has(item.id) || typeof item.question !== 'string' || !item.question.trim() || !['instant', 'standard'].includes(item.mode) || !['off', 'ready-only', 'standard'].includes(item.sourcePolicy)) throw new Error('Invalid evaluation case.');
    ids.add(item.id);
  }
  if (suite.smokeCaseIds.length < 5 || suite.smokeCaseIds.length > 8 || new Set(suite.smokeCaseIds).size !== suite.smokeCaseIds.length || suite.smokeCaseIds.some(id => !ids.has(id))) throw new Error('Smoke selection must contain 5–8 distinct approved cases.');
  const profile = readJson(fixtureFile('materials/profile.json'));
  if (Object.keys(profile).some(key => !['resumeText', 'projectKnowledge', 'starStories', 'aiRules'].includes(key)) || Object.values(profile).some(value => typeof value !== 'string')) throw new Error('Profile contains unsupported settings.');
  return { approval, suite, profile };
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
  }
  return net.isIP(host) === 6 && (/^(?:0*:)*0*1$/.test(host) || host === '::' || /^(?:fc|fd|fe[89ab])/i.test(host) || host.startsWith('::ffff:'));
}
function providerConfig(id, env, mock) {
  if (mock) return { id, model: 'mock-' + id, baseURL: 'https://mock.invalid/v1', hostname: 'mock.invalid', apiKey: 'mock-only-no-external-api' };
  const prefix = id.toUpperCase();
  const missing = ['API_KEY', 'MODEL', 'BASE_URL'].map(suffix => prefix + '_' + suffix).filter(name => !String(env[name] || '').trim());
  if (missing.length) return { id, error: { code: 'configuration', message: 'Missing environment configuration: ' + missing.join(', ') } };
  const apiKey = env[prefix + '_API_KEY'];
  const model = env[prefix + '_MODEL'].trim();
  if (model.length > 256 || /[\r\n]/.test(model) || /[\r\n]/.test(apiKey)) return { id, error: { code: 'configuration', message: 'Invalid provider configuration value.' } };
  let endpoint;
  try { endpoint = new URL(env[prefix + '_BASE_URL']); } catch { /* safe static failure below */ }
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || isPrivateHost(endpoint.hostname)) return { id, model, error: { code: 'configuration', message: 'API base URL must be public HTTPS without credentials, query or fragment.' } };
  return { id, apiKey, model, baseURL: endpoint.href.replace(/\/$/, ''), hostname: endpoint.hostname };
}

function createBudget(options, providerIds) {
  for(const [key,ceiling] of Object.entries({maxCalls:20000,maxCallsPerProvider:10000,maxOutputTokens:16384,firstContentTimeoutMs:120000,totalTimeoutMs:120000})) {
    if(!Number.isInteger(options[key])||options[key]<1||options[key]>ceiling) throw new Error('Invalid live evaluation '+key+'; split large suites into bounded shards.');
  }
  let total = 0;
  const byProvider = Object.fromEntries(providerIds.map(id => [id, 0]));
  return { attempt(provider) {
    if(!Object.hasOwn(byProvider,provider))throw new Error('Provider is outside the evaluation request budget.');
    if (total >= options.maxCalls || byProvider[provider] >= options.maxCallsPerProvider) throw new Error('Live evaluation request budget exceeded.');
    total++; byProvider[provider]++;
  }, snapshot: () => ({ maxCalls: options.maxCalls, maxCallsPerProvider: options.maxCallsPerProvider,
    maxOutputTokens: options.maxOutputTokens, firstContentTimeoutMs: options.firstContentTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs, attemptedCalls: total, callsByProvider: { ...byProvider },
    concurrency: 1, sdkMaxRetries: 0 }) };
}
function codePositions() {
  const definitions = [['src/custom-main.js', 'installShortcutOverrides', 'package entry / Electron boundary'],
    ['main.js', 'async function runFeature', 'production question orchestration'],
    ['src/conversation-memory.js', 'class ConversationMemory', 'session/project memory'],
    ['src/project-material-service.js', 'async prepareImport', 'material preview and atomic commit'],
    ['src/project-evidence-policy.js', 'function sentEvidenceDiagnostics', 'IDs in the actual serialized request'],
    ['src/project-knowledge.js', 'function searchProjectKnowledge', 'scoped source retrieval'],
    ['src/llm.js', 'async function streamOpenAI', 'production provider stream'],
    ['src/live-evaluation-quality.js', 'function evaluateCase', 'deterministic fact assertions']];
  return definitions.map(([file, needle, role]) => ({ path: file, role,
    line: fs.existsSync(path.join(ROOT, file)) ? Math.max(1, fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').findIndex(line => line.includes(needle)) + 1) : null }));
}
function buildIdentity(env) {
  let commit = env.GITHUB_SHA || '';
  if (!commit) try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { commit = 'unknown'; }
  return { commit, node: process.version };
}
function safeError(code, message) { return { code, message }; }

async function importFixtures(runtime, profile, dialogPaths) {
  const imports = [];
  for (const [kind, relative] of [['json', 'materials/facts.json'], ['folder', 'materials/sources/cae'], ['folder', 'materials/sources/arclight']]) {
    dialogPaths.push(fixtureFile(relative));
    const preview = await runtime.invoke('materials:prepare', { kind, ...(kind === 'json' ? { mode: 'replace-all' } : {}) });
    if (preview.canceled || preview.conflicts?.length || preview.packConflicts?.length) throw new Error('Approved material import requires unresolved choices.');
    const state = await runtime.invoke('materials:commit', preview);
    imports.push({ kind, fixture: relative, generation: state.generation, counts: state.counts });
  }
  const state = await runtime.invoke('materials:state');
  if (!state.counts.facts || state.counts.sourceProjects !== 2 || !state.counts.sourceChunks) throw new Error('Imported material index is incomplete.');
  if (state.projects.some(project => !['cae', 'arclight'].includes(project.id))) throw new Error('Non-approved project remains in the material index.');
  await runtime.invoke('settings:set', { ...profile, currentProjectId: '', projectFactsEnabled: true, manualProjectKnowledgeEnabled: true });
  await runtime.exports('src/project-knowledge.js').warmProjectIndex();
  return { imports, projects: state.projects.map(project => ({ id: project.id, sourceChunks: project.sourceChunks, factCount: project.factCount })) };
}

function lastEvent(events, channel) { return events.filter(event => event.channel === channel).at(-1); }
function latencyMetrics(runtime, eventStart, logStart) {
  const metrics = { ...(lastEvent(runtime.events.slice(eventStart), 'llm:metrics') || {}) };
  delete metrics.channel;
  for (const entry of runtime.logs.slice(logStart)) for (const item of entry) {
    if (typeof item !== 'string' || !item.startsWith('[latency][reply] ')) continue;
    try { const value = JSON.parse(item.slice('[latency][reply] '.length)); if (value.event === 'finished' && value.requestId === metrics.requestId) Object.assign(metrics, value); } catch { /* no raw log output */ }
  }
  delete metrics.event;
  return metrics;
}
function completionMetadata(runtime, commitStart) {
  const commit = runtime.commits.slice(commitStart).at(-1);
  return commit?.config?.completion || { complete: false, finishReason: null, truncated: false };
}

async function runCase(runtime, item, provider, options, budget, evaluateCase) {
  const eventStart = runtime.events.length, callStart = runtime.calls.length, commitStart = runtime.commits.length,
    logStart = runtime.logs.length, transportStart = runtime.transportEvents.length,
    attemptStart = budget.snapshot().callsByProvider[provider.id];
  await runtime.invoke('settings:set', { realtimeAnswerMode: item.mode,
    sourceRagPolicies: { instant: item.sourcePolicy, standard: item.sourcePolicy }, firstContentDeadlineMs: options.firstContentTimeoutMs,
    projectFactsEnabled: item.factsEnabled !== false });
  if (options.mock) runtime.behavior(async () => {
    budget.attempt(provider.id);
    return (async function* () {
      yield { choices: [{ delta: { content: '【MOCK 离线传输】此正文仅验证 CUE 的材料、会话与文本流链路，不能用于判断真实模型质量。' } }] };
      yield { choices: [{ delta: { content: '\n当前获批问题：' + item.question }, finish_reason: 'stop' }] };
    })();
  });
  if (!item.eventAlreadyPublished) runtime.final(item.question, { sourceId: 'approved-ci-text', utteranceKey: item.id });
  const started = performance.now();
  let outerTimeout = false, timer;
  try {
    // Explicit text is the production manual-question IPC path. ASR fragment
    // merging depends on real speech pauses and is covered by separate tests.
    await Promise.race([runtime.ask('say', item.question), new Promise((resolve, reject) => {
      timer = setTimeout(() => { outerTimeout = true; if(runtime.hasHandler('llm:cancel')) void runtime.invoke('llm:cancel'); else runtime.clear(); reject(new Error('Evaluation total timeout.')); }, options.totalTimeoutMs + 1000);
    })]);
  } catch { /* runtime and sanitized transport state supply a bounded diagnostic */ }
  finally { clearTimeout(timer); }
  const events = runtime.events.slice(eventStart), materials = lastEvent(events, 'llm:materials') || {};
  const answer = events.filter(event => event.channel === 'llm:token').map(event => event.text || '').join('');
  const request = runtime.requests.at(-1), actualCalls = runtime.calls.length - callStart;
  const attempted = budget.snapshot().callsByProvider[provider.id] > attemptStart;
  const projectIds = request?.plan?.projectIds || [];
  // onRequest runs before transport budget validation. A serialized candidate
  // rejected there must not be reported as evidence sent to the external SDK.
  const sentFactIds = attempted ? materials.sentFactIds || [] : [], sentSourceIds = attempted ? materials.sentSourceIds || [] : [];
  const evidence = runtime.commits.slice(commitStart).at(-1)?.config?.evidence || [];
  const chunks = runtime.snapshot('materialService.snapshot.sources.chunks');
  const sentSources = sentSourceIds.map(id => evidence.find(source => source.id === id) || chunks.find(source => source.id === id))
    .filter(Boolean).map(source => ({ id: source.id, projectId: source.projectId, path: source.path,
      ...(source.sourceType ? {sourceType:source.sourceType,implementation:source.implementation,provenance:source.provenance,truthScope:source.truthScope} : {}) }));
  const metrics = latencyMetrics(runtime, eventStart, logStart);
  if (metrics.doneMs == null) metrics.doneMs = +(performance.now() - started).toFixed(2);
  const observed = runtime.observedTimes || [];
  const requestAt = observed.find(item=>item.type==='request')?.at;
  const firstSentence = observed.find(item=>item.type==='first-sentence')?.at;
  const rendererDelivery = observed.find(item=>item.type==='renderer-delivery')?.at;
  metrics.firstSentenceMs = Number.isFinite(firstSentence) ? +(firstSentence-started).toFixed(2) : null;
  metrics.rendererDeliveryMs = Number.isFinite(rendererDelivery) ? +(rendererDelivery-started).toFixed(2) : null;
  metrics.renderConfirmedMs = null; // OS/window are virtual; IPC delivery is not painted pixels.
  metrics.audioEndToFinalMs = null; // Text replay cannot measure ASR.
  metrics.requestDispatchMs = Number.isFinite(requestAt) ? +(requestAt-started).toFixed(2) : null;
  const completion = completionMetadata(runtime, commitStart);
  const transportErrors = runtime.transportEvents.slice(transportStart);
  const providerError = lastEvent(events, 'llm:error');
  let error = null;
  if (outerTimeout) error = safeError('total-timeout', 'The production request exceeded the evaluation total timeout.');
  else if (transportErrors.some(event => event.code === 'first-content-timeout') || providerError?.timeout) error = safeError('first-content-timeout', 'No nonblank answer content arrived before the deadline.');
  else if (transportErrors.some(event => event.code === 'total-timeout')) error = safeError('total-timeout', 'The provider stream exceeded the total timeout.');
  else if (transportErrors.some(event => event.code === 'output-token-budget')) error = safeError('output-token-budget', 'The production output token request exceeds the configured hard cap.');
  else if (transportErrors.some(event => event.code === 'request-budget')) error = safeError('request-budget', 'The evaluation request budget was exhausted before the external call.');
  else if (providerError) {
    const failure = transportErrors.find(event => event.status);
    error = safeError(failure?.status ? 'provider-http-' + failure.status : 'provider-error',
      failure?.status ? 'Provider returned HTTP ' + failure.status + '.' : 'Provider or network failed; inspect endpoint configuration and service availability.');
  } else if (actualCalls !== 1 || !answer.trim()) error = safeError('pipeline', 'Expected exactly one production SDK request and a nonblank streamed answer.');
  else if (!completion.complete) error = safeError('incomplete-answer', 'Provider did not finish with a complete answer.');
  const quality = evaluateCase({ testCase: item, answer, projectIds, sentFactIds, sentSourceIds, sentSources,
    status: error ? 'failed' : 'passed', error });
  if (options.mock) Object.assign(quality, { scored: false, blocking: false, reason: 'Mock transport verifies wiring only; model quality is not scored.' });
  const pipelineFailures = (quality.deterministic?.checks || []).filter(check => !check.passed &&
    /^(?:project-routing|fact-project-isolation|generic-without-project-facts|required-fact-evidence|source-policy-off|source-evidence-present|source-project-isolation|source-project-provenance|required-source-path)$/.test(check.id)).map(check => check.id);
  if (item.expectedProjectIds && JSON.stringify([...projectIds].sort()) !== JSON.stringify([...item.expectedProjectIds].sort())) pipelineFailures.push('project-selection');
  if (item.sourcePolicy === 'off' && sentSourceIds.length) pipelineFailures.push('source-policy-off');
  if (item.factsEnabled === false && sentFactIds.length) pipelineFailures.push('facts-disabled');
  if (item.requireSource && !sentSourceIds.length) pipelineFailures.push('source-missing');
  if (!error && pipelineFailures.length) error = safeError('pipeline', 'Production evidence invariant failed: ' + pipelineFailures.join(', ') + '.');
  if (!error && !options.mock && !quality.passed) error = safeError('quality', 'Deterministic approved-fact checks failed; see quality.deterministic.');
  return { id: item.id, sessionId: item.sessionId, mode: item.mode, question: item.question, category: item.category,
    sourcePolicy: item.sourcePolicy, factsEnabled: item.factsEnabled !== false, attempted, sdkRequestCount: actualCalls,
    status: error ? 'failed' : 'passed', transportStatus: !attempted ? 'not-attempted' : providerError || outerTimeout ||
      transportErrors.some(event => ['first-content-timeout', 'total-timeout', 'aborted', 'provider-error'].includes(event.code)) || !answer.trim() || !completion.complete ? 'failed' : 'passed',
    answer, projectIds, sentFactIds, sentSourceIds, sentSources, metrics,
    routing: { kind: request?.plan?.kind, reason: request?.plan?.reason, scopes: request?.plan?.scopes, intent: request?.plan?.intent },
    evidenceDiagnostics: Object.fromEntries(['selectedFactIds', 'selectedSourceIds', 'contextFactIds', 'contextSourceIds', 'dropped', 'reasons']
      .map(key => [key, materials[key] || []]).concat([['serializedFactIds', materials.sentFactIds || []], ['serializedSourceIds', materials.sentSourceIds || []]])),
    usage: Object.fromEntries(usageKeys.map(key => [key, typeof metrics[key] === 'number' ? metrics[key] : null])),
    actualMessages: attempted ? runtime.calls.slice(callStart).map(call=>({model:call.model,messages:call.messages,max_tokens:call.max_tokens,max_completion_tokens:call.max_completion_tokens,thinking:call.thinking,enable_thinking:call.enable_thinking})) : [],
    frozenState: request ? { spokenContext:request.spokenContext || '', dialogueRevision:request.dialogueRevision ?? null, evidenceRevision:request.evidenceRevision ?? null, questionSnapshot:request.questionSnapshot ?? null } : null,
    completion, quality, pipelineFailures, ...(error ? { error } : {}) };
}

function createProviderRuntime({ id, config, options, budget, provider, cleanups, dialogPaths = [] }) {
  const actualProvider = id === 'qwen' ? 'custom' : 'deepseek';
  return createInterviewRuntime({ after: cleanup => cleanups.push(cleanup) }, {
    indexSnapshot: { version: 2, projects: [], chunks: [], stats: { fileCount: 0, chunkCount: 0 } },
    dialogPaths, inMemorySettings: true, realTime: true, targetRoot: options.targetRoot,
    settings: { provider: actualProvider, apiKeys: { [actualProvider]: config.apiKey }, smart: false,
      models: { [actualProvider]: { fast: config.model, smart: config.model } },
      ...(id === 'qwen' ? { baseUrl: config.baseURL, providerProtocolPresets: { custom: 'dashscope' },
        providerOptions: { custom: { enable_thinking: false } }, instantProviderOptions: { custom: { enable_thinking: false } } }
        : { deepseekBaseUrl: config.baseURL, providerProtocolPresets: { deepseek: 'deepseek' },
          providerOptions: { deepseek: { thinking: { type: 'disabled' } } }, instantProviderOptions: { deepseek: { thinking: { type: 'disabled' } } } }),
      resumeText: '', projectKnowledge: '', currentProjectId: '', firstContentDeadlineMs: options.firstContentTimeoutMs },
    ...(!options.mock ? { liveTransport: { maxOutputTokens: options.maxOutputTokens, firstContentTimeoutMs: options.firstContentTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs, onAttempt: () => { budget.attempt(id); provider.attemptedCalls++; } } } : {})
  });
}

async function run(options, env = process.env) {
  const providerIds = options.provider === 'all' ? ['qwen', 'deepseek'] : [options.provider];
  const budget = createBudget(options, providerIds);
  const secrets = [env.QWEN_API_KEY, env.DEEPSEEK_API_KEY].filter(Boolean);
  const report = { schemaVersion: 1, kind: options.mock ? 'mock' : 'live', status: 'running', mode: options.mode,
    startedAt: new Date().toISOString(), finishedAt: null, build: buildIdentity(env), budget: budget.snapshot(),
    approval: {}, providers: [], failures: [], codePositions: codePositions() };
  const temporaryPaths = [];
  const save = final => {
    report.budget = budget.snapshot();
    return writeReports(report, { outputDir: options.outputDir, ...(final && env.GITHUB_STEP_SUMMARY ? { summaryPath: env.GITHUB_STEP_SUMMARY } : {}),
      sanitize: { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths } });
  };
  save(false);
  try {
    const fixtures = loadFixtures();
    report.approval = { id: fixtures.approval.id || fixtures.approval.approvalId,
      ciApproved: true, allowAnswerArtifacts: true, manifest: 'evaluation/cue-live/approval.json' };
    const cases = options.mode === 'full' ? fixtures.suite.cases : fixtures.suite.smokeCaseIds.map(id => fixtures.suite.cases.find(item => item.id === id));
    if (cases.length * providerIds.length > options.maxCalls || cases.length > options.maxCallsPerProvider) throw new Error('Selected suite exceeds request budget; no calls made.');
    const { evaluateCase } = require('../src/live-evaluation-quality');
    for (const id of providerIds) {
      const config = providerConfig(id, env, options.mock);
      const provider = { id, model: config.model || null, endpointHostname: config.hostname || null,
        status: 'pending', attemptedCalls: 0, cases: cases.map(item => ({ id: item.id, sessionId: item.sessionId, mode: item.mode,
          question: item.question, status: 'pending', attempted: false, transportStatus: 'not-attempted', answer: '',
          projectIds: [], sentFactIds: [], sentSourceIds: [] })) };
      report.providers.push(provider);
      if (config.error) {
        provider.status = 'failed'; provider.error = config.error;
        report.failures.push({ provider: id, caseId: null, ...config.error });
        save(false); continue;
      }
      provider.status = 'running';
      let runtime;
      const cleanups = [], dialogPaths = [];
      try {
        runtime = createProviderRuntime({ id, config, options, budget, provider, cleanups, dialogPaths });
        temporaryPaths.push(runtime.temp);
        provider.materialImport = await importFixtures(runtime, fixtures.profile, dialogPaths);
        let session = null;
        for (let index = 0; index < cases.length; index++) {
          const item = cases[index];
          if (item.resetSession || session !== item.sessionId) runtime.clear();
          session = item.sessionId;
          const result = await runCase(runtime, item, provider, options, budget, evaluateCase);
          if (options.mock && result.attempted) provider.attemptedCalls++;
          provider.cases[index] = result;
          if (result.error) report.failures.push({ provider: id, caseId: result.id, ...result.error });
          save(false);
          // A broken endpoint should not consume the remaining question budget.
          if (result.error && (['provider-error', 'first-content-timeout', 'total-timeout', 'output-token-budget', 'request-budget'].includes(result.error.code) || result.error.code.startsWith('provider-http-'))) break;
        }
        provider.status = provider.cases.length === cases.length && provider.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
      } catch (error) {
        provider.status = 'failed';
        provider.error = safeError('material-or-runner', 'Production material import or evaluation runner failed: ' +
          sanitizeText(error?.message || 'unknown error', { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths }));
        report.failures.push({ provider: id, caseId: null, ...provider.error });
      } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
      save(false);
    }
    report.status = report.providers.length === providerIds.length && report.providers.every(provider => provider.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.failures.push({ provider: null, caseId: null, code: 'evaluation-configuration',
      message: sanitizeText(error?.message || 'Evaluation setup failed.', { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths }) });
  } finally {
    report.finishedAt = new Date().toISOString();
    save(true);
  }
  return report;
}

async function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(args); } catch (error) {
    // Parse failures still create reports in the default safe output directory.
    const report = { schemaVersion: 1, kind: args.includes('--mock') ? 'mock' : 'live', status: 'failed', mode: 'invalid',
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), providers: [], failures: [{ code: 'cli-configuration', message: error.message }] };
    writeReports(report, { outputDir: DEFAULTS.outputDir, summaryPath: process.env.GITHUB_STEP_SUMMARY,
      sanitize: { secrets: [process.env.QWEN_API_KEY, process.env.DEEPSEEK_API_KEY], workspaceRoot: ROOT } });
    process.stderr.write('CUE evaluation failed: invalid CLI configuration. Use --help.\n'); return 1;
  }
  if (options.help) { process.stdout.write(help()); return 0; }
  const report = await run(options);
  process.stdout.write(`CUE ${report.kind.toUpperCase()} ${report.mode}: ${report.status}; attempted calls ${report.budget.attemptedCalls}. Reports: report.json / report.md\n`);
  return report.status === 'passed' ? 0 : 1;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('CUE evaluation could not write its report.\n'); process.exitCode = 1;
});
module.exports = { parseArgs, providerConfig, createBudget, loadFixtures, createProviderRuntime, codePositions, buildIdentity, runCase, run, main };
