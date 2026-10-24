'use strict';

// Offline judge/interview actors only. Production answers must use runCase and
// the application's own runtime, not this transport.
const { providerConfig } = require('../e2e-live-llm.cjs');
const { sanitizeText } = require('./live-evaluation-report.cjs');
const { setTimeout: pause } = require('node:timers/promises');

function roleConfig(id, env = process.env, role = 'judge') {
  const prefix = id.toUpperCase(), scoped = { ...env };
  const override = role.toUpperCase() + '_' + prefix + '_MODEL';
  if (env[override]) scoped[prefix + '_MODEL'] = env[override];
  return providerConfig(id, scoped, false);
}
function observedUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return usage;
}
function retryable(error) {
  return /^(?:role-http-(?:408|409|429|5\d\d)|role-timeout|role-network|judge-invalid-|judge-fabricated-|judge-missing-|judge-incomplete-|judge-unsupported-|judge-unknown-|role-invalid-)/u.test(error?.code || error?.message || '');
}
async function callRoleOnce({ config, messages, role = 'judge', timeoutMs = 120000, maxTokens = 8192, fetchImpl = globalThis.fetch }) {
  if (config.error) throw Object.assign(new Error(config.error.code), { code: config.error.code });
  const controller = new AbortController(), started = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { model: config.model, messages, stream: false, max_tokens: maxTokens,
      ...(config.id === 'qwen' ? { enable_thinking: false } : { thinking: { type: 'disabled' } }) };
    const response = await fetchImpl(config.baseURL + '/chat/completions', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error('role-http-' + response.status), { code: 'role-http-' + response.status, httpStatus: response.status });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw Object.assign(new Error('role-invalid-response-size'), { code: 'role-invalid-response-size' });
    let data;
    try { data = JSON.parse(text); } catch { throw Object.assign(new Error('role-invalid-response-json'), { code: 'role-invalid-response-json' }); }
    const choice = data.choices?.[0], rawOutput = choice?.message?.content;
    const observation = { role, requestedModel: config.model, model: data.model || null, endpointHostname: config.hostname,
      responseId: data.id || null, usage: observedUsage(data.usage), finishReason: choice?.finish_reason || null,
      durationMs: +(performance.now() - started).toFixed(2), rawOutput: typeof rawOutput === 'string' ? rawOutput : null };
    if (typeof rawOutput !== 'string' || !rawOutput.trim()) throw Object.assign(new Error('role-invalid-empty-output'), { code: 'role-invalid-empty-output', observation });
    if (choice.finish_reason !== 'stop') throw Object.assign(new Error('role-invalid-incomplete-output'), { code: 'role-invalid-incomplete-output', observation });
    return observation;
  } catch (error) {
    if (error.code) throw error;
    throw Object.assign(new Error(controller.signal.aborted ? 'role-timeout' : 'role-network'),
      { code: controller.signal.aborted ? 'role-timeout' : 'role-network' });
  } finally { clearTimeout(timer); }
}

async function runRole({ config, messages, role, attempts = [], retryLimit = 2, validate = value => value,
  onCheckpoint = async () => {}, fetchImpl, pauseImpl = pause, timeoutMs, maxTokens, secrets = [] }) {
  // A started attempt survives interruption as an observed unknown outcome.
  for (const attempt of attempts) if (attempt.status === 'running') {
    attempt.status = 'interrupted'; attempt.error = { code: 'interrupted-outcome-unknown' };
  }
  const completed = attempts.findLast(attempt => attempt.status === 'completed' && attempt.result !== undefined);
  if (completed) return { status: 'completed', result: completed.result, attempts, model: completed.model || config.model };
  if (config.error) return { status: 'failed', error: config.error, attempts, model: config.model || null };
  while (attempts.length <= retryLimit) {
    const attempt = { attempt: attempts.length + 1, role, status: 'running', startedAt: new Date().toISOString(),
      provider: config.id, requestedModel: config.model, model: null, usage: null, finishReason: null };
    attempts.push(attempt); await onCheckpoint();
    const started = performance.now();
    try {
      const observation = await callRoleOnce({ config, messages, role, fetchImpl, timeoutMs, maxTokens });
      Object.assign(attempt, observation);
      attempt.result = validate(observation.rawOutput);
      attempt.status = 'completed'; attempt.finishedAt = new Date().toISOString();
      await onCheckpoint();
      return { status: 'completed', result: attempt.result, attempts, model: attempt.model || config.model };
    } catch (error) {
      if (error.observation) Object.assign(attempt, error.observation);
      attempt.status = 'failed'; attempt.finishedAt = new Date().toISOString();
      attempt.durationMs ??= +(performance.now() - started).toFixed(2);
      attempt.error = { code: String(error.code || error.message || 'role-invalid-output') };
      if (attempt.rawOutput) attempt.rawOutput = sanitizeText(attempt.rawOutput, { secrets });
      await onCheckpoint();
      if (!retryable(attempt.error) || attempts.length > retryLimit) break;
      await pauseImpl(Math.min(10000, 1000 * (2 ** (attempts.length - 1))));
    }
  }
  return { status: 'failed', attempts, model: config.model, error: attempts.at(-1)?.error || { code: 'role-attempts-exhausted' } };
}

module.exports = { roleConfig, observedUsage, retryable, callRoleOnce, runRole };
