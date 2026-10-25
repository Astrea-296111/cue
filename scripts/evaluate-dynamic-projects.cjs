#!/usr/bin/env node
'use strict';

const path = require('node:path'), { createHash } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { resolveProfile } = require('./lib/evaluation-profiles.cjs');
const { validateDynamic, familyIds, dynamicMaterialPayload, runDynamicSession, BEHAVIORS } = require('./lib/dynamic-interview.cjs');
const { applicationRoot, importMaterials, deliverEvent, validateScenarios, validateEvaluation } = require('./evaluate-multiturn-projects.cjs');
const { providerConfig, createBudget, createProviderRuntime, runCase, buildIdentity, codePositions } = require('./e2e-live-llm.cjs');
const { evaluateMultiturnCase } = require('./lib/multiturn-quality.cjs');
const { writeReports, sanitizeText } = require('./lib/live-evaluation-report.cjs');
const { usageSummary } = require('./judge-private-projects.cjs');
const ROOT = path.resolve(__dirname, '..');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function observedProductionAttempts(sessions) {
  return sessions.flatMap(session => session.turns.flatMap(turn => (turn.cueAttempts || []).filter(a => a.status === 'completed' && a.result)
    .flatMap(a => (a.result.attempts?.length ? a.result.attempts : [a.result]).map(result => ({ provider: session.provider, ...result })))));
}

async function evaluateDynamic({ payload, outputDir, env = process.env, provider = 'all', providers, mock = false }) {
  const evaluation = validateEvaluation(payload.evaluation || {}), configuration = validateDynamic(evaluation.dynamic || true);
  const suite = validateScenarios(payload.scenarios), providerIds = (providers || provider) === 'all' ? ['qwen', 'deepseek'] : [providers || provider];
  if (providerIds.some(id => !['qwen', 'deepseek'].includes(id))) throw new Error('Invalid dynamic provider selection.');
  const profile = resolveProfile(evaluation, providerIds.length), app = applicationRoot(evaluation, env);
  const selectedIds = configuration.sessionIds || evaluation.sessionIds;
  // The default is a small development wiring run. A final heldout claim always
  // requires explicit session IDs and disjoint mechanism/fault family metadata.
  if (configuration.split === 'heldout' && !selectedIds) throw new Error('Heldout dynamic evaluation requires explicit session IDs.');
  const sessions = selectedIds ? suite.sessions.filter(s => selectedIds.includes(s.id)) :
    [suite.sessions.find(s => s.events.some(e => e.evaluation?.expected_route === 'cae')),
      suite.sessions.find(s => s.events.some(e => e.evaluation?.expected_route === 'arclight'))].filter(Boolean);
  if (!sessions.length || (selectedIds && sessions.length !== selectedIds.length)) throw new Error('Unknown or empty dynamic session selection.');
  for (const session of sessions) familyIds(session, configuration);
  const tasks = [];
  let ordinal = 0;
  for (const id of providerIds) for (let repeat = 1; repeat <= configuration.repeats; repeat++) for (const session of sessions) {
    if (ordinal++ % profile.shardCount === profile.shardIndex) tasks.push({ id, repeat, session });
  }
  const expected = tasks.length * (configuration.turns + 1);
  if (!expected || expected > 10000) throw new Error('Invalid dynamic question budget.');
  const options = { mock, outputDir, targetRoot: app.root, maxCalls: expected * (1 + profile.retryLimit),
    maxCallsPerProvider: expected * (1 + profile.retryLimit), maxOutputTokens: profile.outputCeiling,
    firstContentTimeoutMs: profile.timeoutMs, totalTimeoutMs: profile.timeoutMs };
  const budget = createBudget(options, providerIds), tempRoots = [], secrets = [env.QWEN_API_KEY, env.DEEPSEEK_API_KEY].filter(Boolean);
  const { loadTrustedSources } = require('./evaluate-private-projects.cjs');
  const sourceRoot = evaluation.sourceSnapshot === 'baseline' ? applicationRoot({ applicationCommit: 'baseline' }, env).root : ROOT;
  const bundle = loadTrustedSources(sourceRoot), materialInput = dynamicMaterialPayload(payload);
  const report = { schemaVersion: 2, kind: mock ? 'mock' : 'live', mode: 'dynamic', status: 'running', startedAt: new Date().toISOString(),
    build: buildIdentity(env), application: { commit: app.commit, kind: app.kind }, codePositions: codePositions(),
    evaluation: { ...profile, dynamic: configuration, expectedQuestionCount: expected, label: evaluation.label || null },
    inputs: { factsSha256: sha(materialInput.facts), originalFactsSha256: sha(payload.facts), profileSha256: sha(payload.profile),
      ...(payload.judgeReference?{judgeReferenceSha256:payload.judgeReference.sha256,judgeReferenceRevision:payload.judgeReference.revision}:{}),
      scenariosSha256: sha(suite), sourceRevision: bundle.revision, sourceBundleSha256: sha(bundle), sourceSnapshot: evaluation.sourceSnapshot || 'current',
      oracleQaCardsExcluded: payload.facts.cards.length - materialInput.facts.cards.length, familyManifestSha256: sha(configuration.familyManifest || null) },
    privacy: { containsPrivateAnswers: true, publicAnswerArtifactsAllowed: false, encryptBeforeUpload: true },
    providers: providerIds.map(id => ({ id, status: 'running', model: null, attemptedCalls: 0, cases: [] })), failures: [], dynamicSessions: [],
    measurementLimits: { renderer: 'Virtual Electron IPC delivery, not painted pixels.', audio: 'Synthetic actual-speech text, not microphone/ASR.',
      holdout: configuration.split === 'heldout' ? 'Family separation checked against the supplied manifest; historical non-exposure still requires reviewer confirmation.' : 'Development dynamic run; no final heldout quality claim.' } };
  const configs = Object.fromEntries(providerIds.map(id => [id, providerConfig(id, env, mock)]));
  const save = () => {
    const current = budget.snapshot(), observed = observedProductionAttempts(report.dynamicSessions).filter(a => a.attempted);
    report.budget = { ...current, currentProcessAttemptedCalls: current.attemptedCalls, currentProcessCallsByProvider: current.callsByProvider,
      attemptedCalls: observed.length, callsByProvider: Object.fromEntries(providerIds.map(id => [id, observed.filter(a => a.provider === id).length])),
      interruptedUnknownProductionOutcomes: report.dynamicSessions.flatMap(s => s.turns).flatMap(t => t.cueAttempts || []).filter(a => a.status === 'interrupted').length,
      concurrency: profile.concurrency, retryLimit: profile.retryLimit };
    return writeReports(report, { outputDir, sanitize: { secrets, workspaceRoot: ROOT, tempRoots } }); };
  for (const p of report.providers) { p.model = configs[p.id].model || null; if (configs[p.id].error) { p.error = configs[p.id].error; p.status = 'failed'; } }
  save(); let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++], p = report.providers.find(p => p.id === task.id), config = configs[task.id], cleanups = [];
      if (config.error) continue;
      try {
        const runtime = createProviderRuntime({ id: task.id, config, options, budget, provider: p, cleanups });
        tempRoots.push(runtime.temp); await runtime.ready;
        const imported = await importMaterials(runtime, materialInput, bundle);
        p.materialImport ||= imported;
        // Every session owns a fresh runtime. All subsequent answers use runCase.
        runtime.clear(); await runtime.invoke('settings:set', { activeJobProfile: task.session.job_profile || '', activeJobProfileId: task.session.job_profile || '' });
        const askCue = async ({ event, dialogueEvents }) => {
          const item = { id: task.session.id + '-dynamic-r' + task.repeat + '-' + event.event_id,
            sessionId: task.session.id, mode: task.session.execution_profile, question: event.text, category: 'dynamic',
            sourcePolicy: task.session.execution_profile === 'instant' ? 'ready-only' : 'standard', factsEnabled: true, eventAlreadyPublished: true };
          let result; const attempts = [];
          for (let attempt = 0; attempt <= profile.retryLimit; attempt++) {
            result = await runCase(runtime, item, p, options, budget, args => evaluateMultiturnCase({ ...args, event,
              scenarioEvaluation: event.evaluation, dialogueEvents }));
            result.attempt = attempt + 1; attempts.push({ ...result });
            if (mock && result.attempted) p.attemptedCalls++;
            if (!/^provider-http-(?:429|5\d\d)$|^(?:provider-error|total-timeout|first-content-timeout)$/u.test(result.error?.code || '') || attempt === profile.retryLimit) break;
            await pause(Math.min(10000, 1000 * (2 ** attempt)));
          }
          const sent = new Set(result.sentSourceIds || []);
          return { ...result, attempts, applicationCommit: app.commit, jobProfile: task.session.job_profile,
            authoritativeSources: bundle.sources.chunks.filter(c => sent.has(c.id)).map(c => ({ id: c.id, projectId: c.projectId, path: c.path,
              commit: bundle.sources.projects.find(p => p.id === c.projectId)?.sourceRevision || null, text: c.text, startLine: c.startLine, endLine: c.endLine })) };
        };
        const syncState = state => {
          const key = task.id + '/' + task.session.id + '/' + task.repeat;
          const old = report.dynamicSessions.findIndex(s => s.key === key), entry = { key, ...state };
          if (old >= 0) report.dynamicSessions[old] = entry; else report.dynamicSessions.push(entry);
          const others = p.cases.filter(c => !(c.sessionId === task.session.id && c.repeat === task.repeat));
          p.cases = [...others, ...state.turns.map(t => t.cue).filter(Boolean)]; save();
        };
        const state = await runDynamicSession({ session: task.session, provider: task.id, repeat: task.repeat, runtime, askCue,
          deliverEvent, env, outputDir, configuration, mock, onCheckpoint: syncState,
          generationIdentity: { applicationCommit: app.commit, factsSha256: sha(materialInput.facts), profileSha256: sha(materialInput.profile),
            sourceBundleSha256: sha(bundle), model: config.model, endpoint: config.hostname, executionProfile: task.session.execution_profile,
            outputCeiling: profile.outputCeiling, timeoutMs: profile.timeoutMs, retryLimit: profile.retryLimit } });
        syncState(state);
        if (state.status !== 'completed') report.failures.push({ provider: task.id, caseId: task.session.id, code: 'dynamic-session-incomplete' });
      } catch (error) { report.failures.push({ provider: task.id, caseId: task.session.id, code: 'dynamic-runner', message: sanitizeText(error.message, { secrets, workspaceRoot: ROOT, tempRoots }) }); }
      finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
      save();
    }
  }
  await Promise.all(Array.from({ length: Math.min(profile.concurrency, tasks.length) }, worker));
  for (const p of report.providers) {
    p.attemptedCalls = observedProductionAttempts(report.dynamicSessions).filter(a => a.provider === p.id && a.attempted).length;
    p.expectedCaseCount = tasks.filter(t => t.id === p.id).length * (configuration.turns + 1);
    p.status = p.cases.length === p.expectedCaseCount && p.cases.every(c => c.status === 'passed') && !p.error ? 'passed' : 'failed';
  }
  const actorAttempts = report.dynamicSessions.flatMap(s => s.turns.flatMap(t => [...(t.candidate?.attempts || []), ...(t.followup?.attempts || [])]));
  report.dynamicActors = { ...usageSummary(actorAttempts), behaviorsRequired: BEHAVIORS,
    byRole: ['candidate', 'followup'].map(role => ({ role, ...usageSummary(actorAttempts.filter(a => a.role === role)) })) };
  const productionAttempts = observedProductionAttempts(report.dynamicSessions);
  report.generationAttempts = { totalObservedAttempts: productionAttempts.length, actualRequests: productionAttempts.filter(a => a.attempted).length,
    usage: Object.fromEntries(['actualInputTokens', 'actualOutputTokens', 'actualTotalTokens', 'cachedInputTokens', 'actualReasoningTokens'].map(field => {
      const values = productionAttempts.map(a => a.usage?.[field]).filter(Number.isFinite);
      return [field, values.length ? values.reduce((sum, n) => sum + n, 0) : null];
    })) };
  report.status = report.providers.every(p => p.status === 'passed') && !report.failures.length ? 'passed' : 'failed';
  report.generationFinishedAt = new Date().toISOString();
  report.finishedAt = evaluation.judge && !mock ? null : report.generationFinishedAt;
  let document = save();
  if (evaluation.judge && !mock) {
    const update = value => { Object.assign(report, { providers: value.providers, judging: value.judging, manualReview: value.manualReview, status: value.status,inputs:{...report.inputs,...value.inputs} }); save(); };
    try { document = await require('./judge-private-projects.cjs').evaluateJudges({ report: document, payload, env, outputDir,
      concurrency: profile.concurrency, onCheckpoint: update }); update(document); }
    catch (error) { report.status = 'failed'; report.judging = { status: 'failed', error: sanitizeText(error.message, { secrets }) }; }
    report.finishedAt = new Date().toISOString(); document = save();
  }
  return document;
}

module.exports = { evaluateDynamic, observedProductionAttempts };
