'use strict';

const REALTIME_MODES = new Set(['say', 'answerThis', 'ask', 'assist', 'technical', 'leetcode']);

function realtimeTransportOptions(settings, mode) {
  // A hidden SDK retry adds a backoff plus another full inference attempt.
  // Live answers fail immediately; the existing UI lets the user retry. Leave
  // standalone callers, deliberate deep mode and summaries at SDK defaults.
  return !settings.smart && REALTIME_MODES.has(mode) ? { maxRetries: 0 } : {};
}

function geminiThinkingConfig(model, smart, explicit) {
  if (explicit && typeof explicit === 'object') return { ...explicit };
  if (smart) return undefined;
  // Gemini 2.5 Flash supports zero thinking budget. Pro and unknown/newer
  // families have different bounds; never send a guessed incompatible value.
  return /^gemini-2\.5-flash(?:-lite)?(?:-preview-[\w-]+)?$/i.test(String(model || ''))
    ? { thinkingBudget: 0 } : undefined;
}

module.exports = { realtimeTransportOptions, geminiThinkingConfig };
