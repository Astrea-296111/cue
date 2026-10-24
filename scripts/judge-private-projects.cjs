#!/usr/bin/env node
'use strict';

const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { prepareJudgeInput, parseJudgeOutput, mergeJudges, DIMENSIONS } = require('./lib/multiturn-judge.cjs');
const { createReviewPlan, stableCaseKey } = require('./lib/multiturn-quality.cjs');
const { roleConfig, runRole } = require('./lib/evaluation-role-client.cjs');
const { sanitizeReport } = require('./lib/live-evaluation-report.cjs');
const POLICY = 'cue-independent-judges-v2';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function privateWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, target); fs.chmodSync(target, 0o600);
}
function usageSummary(attempts) {
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'], result = {};
  for (const field of fields) {
    const seen = attempts.map(a => a.usage?.[field]).filter(Number.isFinite);
    result[field] = seen.length ? seen.reduce((sum, n) => sum + n, 0) : null;
  }
  return { attempts: attempts.length, completedAttempts: attempts.filter(a => a.status === 'completed').length,
    failedAttempts: attempts.filter(a => a.status !== 'completed').length,
    observedUsageAttempts: attempts.filter(a => a.usage !== null && a.usage !== undefined).length, usage: result };
}
function summarizeJudging(report) {
  const rows = (report.providers || []).flatMap(p => (p.cases || []).map(item => ({ provider: p.id, item })));
  const all = rows.flatMap(({ item }) => (item.judging?.judges || []).flatMap(j => j.attempts || []));
  const counts = Object.fromEntries(['passed', 'failed', 'needs-review', 'unverified'].map(status => [status, rows.filter(r => r.item.judging?.consensus?.status === status).length]));
  const means = {};
  for (const d of DIMENSIONS) {
    const values = rows.map(r => r.item.judging?.consensus?.scores?.[d]).filter(Number.isFinite);
    means[d] = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  }
  const coverageRows = rows.flatMap(r => r.item.judging?.judges || []).filter(j => j.status === 'completed').flatMap(j => j.result.coverage);
  const criticalFailures = rows.filter(r => r.item.judging?.consensus?.criticalFailure).length;
  const crossModelVerifiedCases = rows.filter(r => r.item.judging?.modelDiversity === 'verified-distinct-served-models').length;
  const rateAtLeastThree = (selected, dimension) => {
    const values = selected.map(r => r.item.judging?.consensus?.scores?.[dimension]).filter(Number.isFinite);
    return { evaluated: values.length, total: selected.length, rate: values.length ? values.filter(n => n >= 3).length / values.length : null };
  };
  const correctionRows = rows.filter(r => [...(r.item.sessionTags || []), ...(r.item.tags || []), r.item.precedingCandidateBehavior || '']
    .some(tag => /correction|spoken.error|wrong.guarantee|contradiction|corrected.claim/u.test(tag)) || /纠正|口误|改口/u.test(JSON.stringify(r.item.scenarioEvaluation || {})));
  const families = new Map();
  for (const row of rows) for (const family of row.item.familyIds?.length ? row.item.familyIds : row.item.sessionTags?.length ? row.item.sessionTags : [row.item.category || 'unclassified']) {
    const score = row.item.judging?.consensus?.scores?.oralNaturalness;
    if (!families.has(family)) families.set(family, []);
    if (Number.isFinite(score)) families.get(family).push(score);
  }
  const oralByFamily = Object.fromEntries([...families].map(([id, values]) => [id, { evaluated: values.length,
    mean: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null }]));
  const coverageRate = coverageRows.length ? coverageRows.filter(r => r.status === 'conveyed').length / coverageRows.length : null;
  const continuity = rateAtLeastThree(rows, 'contextContinuity'), correction = rateAtLeastThree(correctionRows, 'correctionQuality');
  const noRepeatRows = rows.map(row => ({ row, expected: row.item.scenarioEvaluation || {}, checks: [] })).map(entry => {
    for (const [source, field, wanted] of [['must_convey', 'coverage', 'conveyed'], ['must_not_assert', 'prohibitedClaims', 'not_asserted']]) {
      (entry.expected[source] || []).forEach((text, index) => { if (/不重复|不再.*纠正|再次.*(?:道歉|纠正)|重复.*(?:纠正|道歉|提醒)/u.test(text)) entry.checks.push({ field, index, wanted }); });
    }
    return entry;
  }).filter(entry => entry.checks.length);
  const noRepeatEvaluated = noRepeatRows.filter(entry => entry.row.item.judging?.judges?.filter(j => j.status === 'completed').length === 2);
  const noRepeat = { total: noRepeatRows.length, evaluated: noRepeatEvaluated.length, rate: noRepeatEvaluated.length ? noRepeatEvaluated.filter(entry =>
    entry.row.item.judging.judges.every(j => entry.checks.every(check => j.result[check.field].find(c => c.constraintIndex === check.index)?.status === check.wanted))).length / noRepeatEvaluated.length : null };
  const gates = { twoActualModelsPerCase: crossModelVerifiedCases === rows.length && rows.length > 0,
    noCriticalFailure: criticalFailures === 0, requiredPointCoverage95: coverageRate === null ? null : coverageRate >= 0.95,
    continuity95: continuity.rate === null ? null : continuity.rate >= 0.95,
    correction95: correction.rate === null ? null : correction.rate >= 0.95,
    noRepeatedCorrection95: noRepeat.rate === null ? null : noRepeat.rate >= 0.95,
    oralMean35: means.oralNaturalness === null ? null : means.oralNaturalness >= 3.5,
    everyFamilyOralMean3: Object.values(oralByFamily).length ? Object.values(oralByFamily).every(x => x.mean !== null && x.mean >= 3) : null };
  return { policy: POLICY, totalCases: rows.length, ...counts, dimensionMeans: means,
    criticalFailures, crossModelVerifiedCases,
    continuity, correction, noRepeatedCorrection: noRepeat, oralByFamily, qualityGates: gates,
    automatedGatesPassed: Object.values(gates).every(value => value === true || value === null),
    requiredPointCoverage: { conveyed: coverageRows.filter(r => r.status === 'conveyed').length, total: coverageRows.length,
      rate: coverageRate },
    ...usageSummary(all), byJudge: ['qwen', 'deepseek'].map(id => ({ id, ...usageSummary(all.filter(a => a.provider === id)) })),
    blinded: true, independentMessages: true, humanReview: 'pending',
    limitations: ['Automated scores are observations. Required human source review remains pending until recorded.',
      'Missing API usage is null. Every retry and interrupted unknown outcome remains in attempts.'] };
}

async function evaluateJudges({ report, payload = {}, env = process.env, outputDir, concurrency = 2,
  onCheckpoint = async () => {}, fetchImpl, pauseImpl }) {
  if (!report || !Array.isArray(report.providers) || !outputDir) throw new Error('Judge evaluation requires a report and private output directory.');
  if (report.kind === 'mock') throw new Error('Mock production output cannot be accepted as real judged evaluation.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Judge concurrency must be between 1 and 4.');
  const configurations = ['qwen', 'deepseek'].map(id => roleConfig(id, env, 'judge'));
  if (!configurations.some(c => c.error) && configurations[0].model === configurations[1].model) throw new Error('Two different actual configured judge models are required.');
  const secrets = configurations.map(c => c.apiKey).filter(Boolean);
  const checkpointPath = path.join(outputDir, 'judge-checkpoint.json');
  const identity = hash({ policy: POLICY, application: report.application, build: report.build?.commit, inputs: report.inputs,
    judges: configurations.map(c => ({ id: c.id, model: c.model, endpoint: c.hostname })) });
  let checkpoint = { schemaVersion: 1, policy: POLICY, identity, entries: {} };
  if (fs.existsSync(checkpointPath)) {
    const previous = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (previous.identity === identity && previous.policy === POLICY) checkpoint = previous;
    else throw new Error('Judge checkpoint belongs to different inputs, code or models; use a separate output directory.');
  }
  const rows = report.providers.flatMap(provider => (provider.cases || []).map(item => ({ provider: provider.id, item })));
  const persist = async () => {
    checkpoint.updatedAt = new Date().toISOString();
    report.judging = { ...summarizeJudging(report), status: 'running' };
    privateWrite(checkpointPath, sanitizeReport(checkpoint, { secrets }));
    await onCheckpoint(report);
  };
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const { provider, item } = rows[cursor++];
      const prepared = prepareJudgeInput({ item, payload });
      const key = stableCaseKey(item, provider), previous = checkpoint.entries[key];
      if (previous && previous.inputDigest !== prepared.digest) throw new Error('Judge case input changed under an existing checkpoint key.');
      const entry = previous || { inputDigest: prepared.digest, authorityIds: prepared.authorityIds,
        // No origin provider, version label, commit or expected model enters messages.
        input: prepared.input, judges: configurations.map(c => ({ provider: c.id, status: 'pending', model: c.model || null, attempts: [] })) };
      checkpoint.entries[key] = entry;
      item.judging = entry;
      if (!String(item.answer || '').trim()) {
        entry.consensus = { status: 'unverified', needsReview: true, scores: null, reason: 'No complete answer was available for semantic judging.' };
        await persist(); continue;
      }
      // Sequential within one answer; independent fresh messages for each model.
      for (let i = 0; i < configurations.length; i++) {
        const old = entry.judges[i], config = configurations[i];
        const judged = await runRole({ config, messages: prepared.messages, role: 'judge', attempts: old.attempts,
          retryLimit: 2, maxTokens: 8192, timeoutMs: 120000, fetchImpl, pauseImpl, secrets,
          validate: raw => parseJudgeOutput(raw, prepared.input), onCheckpoint: persist });
        entry.judges[i] = { provider: config.id, ...judged };
        await persist();
      }
      entry.consensus = mergeJudges(entry.judges);
      const servedModels = entry.judges.map(j => j.status === 'completed' ? j.attempts.findLast(a => a.status === 'completed')?.model : null);
      entry.modelDiversity = servedModels.every(Boolean) && new Set(servedModels).size === 2 ? 'verified-distinct-served-models' :
        servedModels.every(Boolean) ? 'same-served-model' : 'served-model-unobserved';
      if (entry.modelDiversity !== 'verified-distinct-served-models') entry.consensus = { ...entry.consensus, status: 'unverified', needsReview: true,
        reason: 'Distinct configured judges did not establish two distinct actual served models; actual response model IDs remain recorded.' };
      if (prepared.input.truncationObserved) entry.consensus = { ...entry.consensus, status: 'needs-review', needsReview: true,
        reason: 'Bounded judge input omitted part of the answer, dialogue or evidence; full-source human review is required.' };
      item.quality = { ...(item.quality || {}), semanticJudged: entry.consensus.status !== 'unverified',
        semanticStatus: entry.consensus.status, manualReviewRequired: true };
      await persist();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  report.manualReview = createReviewPlan(report);
  const packets = report.manualReview.selectedCases.map(selection => {
    const row = rows.find(r => stableCaseKey(r.item, r.provider) === selection.key);
    const sessionRows = rows.filter(r => r.provider === row.provider && r.item.sessionId === row.item.sessionId && r.item.repeat === row.item.repeat);
    const complete = sessionRows.map(r => r.item.dialogueEvents || r.item.dialogue || []).sort((a, b) => b.length - a.length)[0] || [];
    return { ...selection, question: row.item.question, answer: row.item.answer,
      completeDialogue: complete, sessionAnswers: sessionRows.map(r => ({ id: r.item.id, question: r.item.question, answer: r.item.answer,
        scenarioEvaluation: r.item.scenarioEvaluation, authoritativeSources: r.item.authoritativeSources || [], judging: r.item.judging })),
      judging: row.item.judging, sourceRevision: report.inputs?.sourceRevision || null };
  });
  privateWrite(path.join(outputDir, 'manual-review-queue.json'), sanitizeReport({ ...report.manualReview, packets }, { secrets }));
  report.judging = { ...summarizeJudging(report), status: report.manualReview.selectedCases.length ? 'needs-review' : 'completed',
    reviewQueueFile: 'manual-review-queue.json', completedAt: new Date().toISOString() };
  if (report.judging.unverified || report.judging.failed || report.judging['needs-review']) report.status = 'failed';
  else if (report.manualReview.selectedCases.length && report.status !== 'failed') report.status = 'needs-review';
  checkpoint.updatedAt = new Date().toISOString();
  privateWrite(checkpointPath, sanitizeReport(checkpoint, { secrets }));
  await onCheckpoint(report);
  return report;
}

module.exports = { evaluateJudges, summarizeJudging, usageSummary, privateWrite, POLICY };
