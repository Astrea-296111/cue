'use strict';
const { performance } = require('perf_hooks');
function createReplyLatency({ now = () => performance.now(), log = value => console.log(value), wallNow = Date.now } = {}) {
  let sequence = 0;
  let speechEnd = null, final = null, interim = null;
  const finals = [];
  const clean = value => String(value || '').trim();
  const compact = value => clean(value).normalize('NFKC').replace(/[\s，。！？,.;；:：!?]/g, '');
  function observe(channel, data) {
    if (!data || data.channel !== 'them') return;
    const at = now();
    if (channel === 'vad:state') {
      if (data.speaking) { speechEnd = null; final = null; interim = null; }
      else speechEnd = at;
    } else if (channel === 'stt:final') {
      final = { text: clean(data.text), at, speechEnd: speechEnd != null && at - speechEnd < 10000 ? speechEnd : null,
        sourceKey: data.utteranceKey ? `${data.sourceId || 'stream'}:${data.utteranceKey}` : '' };
      finals.push(final);
      if (finals.length > 32) finals.shift();
      speechEnd = null;
      interim = null;
    } else if (channel === 'stt:interim') interim = { text: clean(data.text), at };
  }
  function start(mode, question, { sourceKeys = [] } = {}) {
    const started = now();
    const text = clean(question);
    const compactText = compact(text);
    const keys = new Set(sourceKeys);
    const matches = finals.filter(item => started - item.at < 60000 &&
      (keys.size ? keys.has(item.sourceKey) : item.text === text ||
        compact(item.text).length >= 4 && compactText.includes(compact(item.text))));
    const matchedFinal = matches.at(-1) || null;
    const matchedInterim = !matchedFinal && interim && interim.text === text && started - interim.at < 4000;
    const requestId = `${wallNow().toString(36)}-${++sequence}`;
    const phases = {};
    let first = false;
    return { requestId, started,
      activity(event) {
        const phase = event?.phase || 'provider-event';
        if (phases[phase] == null) phases[phase] = now();
        if (phase === 'reasoning' && phases['provider-event'] == null) phases['provider-event'] = phases[phase];
      },
      firstToken(requestSent) {
        if (first) return;
        first = true;
        const at = now();
        const elapsed = phase => phases[phase] == null ? null : +(phases[phase] - requestSent).toFixed(2);
        log('[latency][reply] ' + JSON.stringify({ requestId, mode,
          input: matchedFinal ? 'stt-final' : matchedInterim ? 'stt-interim' : 'manual-or-transcript',
          requestToFirstTokenMs: +(at - started).toFixed(2),
          prepareMs: +(requestSent - started).toFixed(2),
          llmFirstTokenMs: +(at - requestSent).toFixed(2),
          providerResponseMs: elapsed('provider-response'),
          firstProviderEventMs: elapsed('provider-event'),
          reasoningStartedMs: elapsed('reasoning'),
          reasoningToFirstTokenMs: phases.reasoning == null ? null : +(at - phases.reasoning).toFixed(2),
          // finalAge includes the time the user spends deciding to press the shortcut.
          finalAgeAtRequestMs: matchedFinal ? +(started - matchedFinal.at).toFixed(2) : null,
          finalToFirstTokenMs: matchedFinal ? +(at - matchedFinal.at).toFixed(2) : null,
          // VAD end is the detected endpoint, not the physical end of speech.
          vadEndToFinalMs: matchedFinal?.speechEnd != null && matchedFinal.at >= matchedFinal.speechEnd
            ? +(matchedFinal.at - matchedFinal.speechEnd).toFixed(2) : null }));
      }
    };
  }
  function reset() { speechEnd = null; final = null; interim = null; finals.length = 0; }
  return { observe, start, reset };
}
module.exports = { ...createReplyLatency(), createReplyLatency };
