'use strict';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeUsage(provider, usage = {}) {
  const result = {};
  if (provider === 'anthropic') {
    const uncached = finite(usage.input_tokens), read = finite(usage.cache_read_input_tokens), write = finite(usage.cache_creation_input_tokens);
    if (uncached !== undefined) {
      result.uncachedInputTokens = uncached;
      result.actualInputTokens = uncached + (read || 0) + (write || 0);
    }
    result.actualOutputTokens = finite(usage.output_tokens);
    result.cachedInputTokens = read; result.cacheCreatedTokens = write;
  } else if (provider === 'gemini') {
    result.actualInputTokens = finite(usage.promptTokenCount);
    result.actualOutputTokens = finite(usage.candidatesTokenCount);
    result.actualTotalTokens = finite(usage.totalTokenCount);
    result.cachedInputTokens = finite(usage.cachedContentTokenCount);
    result.actualReasoningTokens = finite(usage.thoughtsTokenCount);
  } else if (provider === 'ollama') {
    result.actualInputTokens = finite(usage.prompt_eval_count);
    result.actualOutputTokens = finite(usage.eval_count);
  } else {
    result.actualInputTokens = finite(usage.prompt_tokens);
    result.actualOutputTokens = finite(usage.completion_tokens);
    result.actualTotalTokens = finite(usage.total_tokens);
    result.cachedInputTokens = finite(usage.prompt_tokens_details?.cached_tokens);
    result.actualReasoningTokens = finite(usage.completion_tokens_details?.reasoning_tokens);
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function createUsageReporter(provider, onUsage) {
  let raw = {}, previous = '';
  return usage => {
    if (!usage || typeof usage !== 'object') return;
    raw = { ...raw, ...usage };
    const metrics = normalizeUsage(provider, raw);
    const identity = JSON.stringify(metrics);
    if (identity === previous || !Object.keys(metrics).length) return;
    previous = identity;
    if (typeof onUsage === 'function') onUsage(metrics);
  };
}

module.exports = { normalizeUsage, createUsageReporter };
