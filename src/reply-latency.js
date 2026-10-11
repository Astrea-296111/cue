'use strict';
const { performance } = require('perf_hooks');
let sequence = 0;
let speechEnd = null, final = null, interim = null;
const clean = value => String(value || '').trim();
function observe(channel, data) {
  if (!data || data.channel !== 'them') return;
  const now = performance.now();
  if (channel === 'vad:state') {
    if (data.speaking) { speechEnd = null; final = null; interim = null; }
    else speechEnd = now;
  } else if (channel === 'stt:final') {
    final = { text: clean(data.text), at: now, speechEnd: speechEnd != null && now - speechEnd < 10000 ? speechEnd : null };
    speechEnd = null;
    interim = null;
  } else if (channel === 'stt:interim') interim = { text: clean(data.text), at: now };
}
function start(mode, question) {
  const started = performance.now();
  const text = clean(question);
  const matchedFinal = final && final.text === text && started - final.at < 60000 ? { ...final } : null;
  const matchedInterim = !matchedFinal && interim && interim.text === text && started - interim.at < 4000;
  const requestId = `${Date.now().toString(36)}-${++sequence}`;
  let first = false;
  return { requestId, started,
    firstToken(requestSent) {
      if (first) return;
      first = true;
      const now = performance.now();
      console.log('[latency][reply] ' + JSON.stringify({ requestId, mode,
        input: matchedFinal ? 'stt-final' : matchedInterim ? 'stt-interim' : 'manual-or-transcript',
        requestToFirstTokenMs: +(now - started).toFixed(2),
        llmFirstTokenMs: +(now - requestSent).toFixed(2),
        // finalAge includes the time the user spends deciding to press the shortcut.
        finalAgeAtRequestMs: matchedFinal ? +(started - matchedFinal.at).toFixed(2) : null,
        finalToFirstTokenMs: matchedFinal ? +(now - matchedFinal.at).toFixed(2) : null,
        // VAD end is the detected endpoint, not the physical end of speech.
        vadEndToFinalMs: matchedFinal?.speechEnd != null && matchedFinal.at >= matchedFinal.speechEnd
          ? +(matchedFinal.at - matchedFinal.speechEnd).toFixed(2) : null }));
    }
  };
}
function reset() { speechEnd = null; final = null; interim = null; }
module.exports = { observe, start, reset };
