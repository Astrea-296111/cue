'use strict';

const REALTIME_MODES = new Set(['say', 'answerThis', 'ask', 'assist', 'technical', 'leetcode']);

function realtimeTransportOptions(settings, mode, executionProfile = 'standard') {
  // A hidden SDK retry adds a backoff plus another full inference attempt.
  // Live answers fail immediately; the existing UI lets the user retry. Leave
  // standalone callers, deliberate deep mode and summaries at SDK defaults.
  return executionProfile === 'instant' || !settings.smart && REALTIME_MODES.has(mode) ? { maxRetries: 0 } : {};
}

function geminiThinkingConfig(model, smart, explicit) {
  if (explicit && typeof explicit === 'object') return { ...explicit };
  if (smart) return undefined;
  // Gemini 2.5 Flash supports zero thinking budget. Pro and unknown/newer
  // families have different bounds; never send a guessed incompatible value.
  return /^gemini-2\.5-flash(?:-lite)?(?:-preview-[\w-]+)?$/i.test(String(model || ''))
    ? { thinkingBudget: 0 } : undefined;
}

function endpointClass(provider, baseURL = '') {
  if (provider !== 'custom') return provider === 'azure' ? 'azure-configured' : `${provider}-official`;
  const { isDashScopeChatEndpoint } = require('./openai-compatible');
  if (isDashScopeChatEndpoint(baseURL)) return 'dashscope-official';
  try {
    const url = new URL(baseURL);
    if (url.hostname === 'api.openai.com') return 'openai-official';
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'local-compatible';
  } catch (_) {}
  return 'custom-compatible';
}

function thinkingDiagnostics({ provider, model, baseURL, requestOptions = {}, thinkingConfig, source = 'unknown' }) {
  const { dashScopeThinkingCapability } = require('./openai-compatible');
  const capability = dashScopeThinkingCapability(baseURL, model);
  let thinkingStatus = 'unknown';
  if (capability === 'required') thinkingStatus = 'required';
  else if (capability === 'toggle' && typeof requestOptions.enable_thinking === 'boolean') {
    thinkingStatus = requestOptions.enable_thinking ? 'enabled' : 'disabled';
  } else if (provider === 'gemini' && /^gemini-2\.5-flash(?:-lite)?(?:-preview-[\w-]+)?$/i.test(model)) {
    if (thinkingConfig?.thinkingBudget === 0) thinkingStatus = 'disabled';
    else if (Number(thinkingConfig?.thinkingBudget) > 0) thinkingStatus = 'enabled';
  } else if ((provider === 'openai' || endpointClass(provider, baseURL) === 'openai-official') &&
      new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano']).has(model)) {
    // These are non-reasoning chat models; no reasoning_effort is inferred.
    thinkingStatus = 'disabled';
  } else if (provider === 'anthropic' && new Set(['claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022']).has(model)) {
    thinkingStatus = 'disabled';
  }
  return { thinkingStatus, thinkingSource: thinkingStatus === 'unknown' ? source : source === 'unknown' ? 'documented-default' : source,
    enableThinking: typeof requestOptions.enable_thinking === 'boolean' ? requestOptions.enable_thinking : null,
    reasoningEffort: requestOptions.reasoning_effort || null,
    thinkingConfig: thinkingConfig ? Object.fromEntries(Object.entries(thinkingConfig)
      .filter(([key, value]) => key === 'thinkingBudget' && typeof value === 'number' || key === 'includeThoughts' && typeof value === 'boolean' ||
        key === 'thinkingLevel' && ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'minimal', 'low', 'medium', 'high'].includes(value))) : null };
}

module.exports = { realtimeTransportOptions, geminiThinkingConfig, endpointClass, thinkingDiagnostics };
