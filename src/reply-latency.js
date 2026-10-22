'use strict';
const { performance } = require('perf_hooks');
const round = value => Number.isFinite(value) ? +Math.max(0, value).toFixed(2) : null;
const clean = value => String(value || '').trim();
const compact = value => clean(value).normalize('NFKC').replace(/[\s，。！？,.;；:：!?]/g, '');
const safeNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sourceKey = data => data.utteranceKey ? `${data.sourceId || 'stream'}${data.sourceSessionId ? '@' + data.sourceSessionId : ''}:${data.utteranceKey}` : '';
const CONTEXT_FIELDS = ['epoch', 'questionId', 'questionRevision', 'executionProfile', 'model', 'buildCommit', 'sourceDirty',
  'identitySource', 'provider', 'endpointClass', 'ragPolicy', 'readyEvidenceHit', 'skippedReason', 'optionalContextTokensEstimate',
  'sourceCount', 'queueDelayMs', 'thinkingStatus', 'thinkingSource', 'enableThinking', 'reasoningEffort', 'thinkingConfig',
  'automaticRetriesDisabled', 'transportRetryPolicy', 'responseBoundary', 'thinkingRequest', 'reasoningObserved', 'outcome', 'timeToLocalFacts', 'packRevision', 'selectedCardCount'];

function createReplyLatency({ now = () => performance.now(), log = value => console.log(value), wallNow = Date.now } = {}) {
  let sequence = 0;
  let speechEnd = null, interim = null;
  const finals = [];
  function observe(channel, data) {
    if (!data || data.channel !== 'them') return;
    const at = now();
    if (channel === 'vad:state') {
      if (data.speaking) { speechEnd = null; interim = null; }
      else speechEnd = { at, sourceId: data.sourceId || null, sourceSessionId: data.sourceSessionId || null, sourceKey: sourceKey(data) };
    } else if (channel === 'stt:final') {
      // Missing source identity remains an approximate local endpoint link.
      const linked = speechEnd && at - speechEnd.at < 10000 &&
        (!speechEnd.sourceId || speechEnd.sourceId === data.sourceId) &&
        (!speechEnd.sourceSessionId || speechEnd.sourceSessionId === data.sourceSessionId);
      const finalKey = sourceKey(data);
      const final = { text: clean(data.text), at, speechEnd: linked ? speechEnd.at : null, sourceKey: finalKey,
        asrAssociation: linked && finalKey && speechEnd.sourceKey === finalKey ? 'utterance-key' : linked ? 'local-vad-approximation' : null };
      const old = final.sourceKey ? finals.findIndex(item => item.sourceKey === final.sourceKey) : -1;
      if (old >= 0) finals.splice(old, 1);
      finals.push(final);
      if (finals.length > 32) finals.shift();
      speechEnd = null; interim = null;
    } else if (channel === 'stt:interim') interim = { text: clean(data.text), at, sourceKey: sourceKey(data) };
  }
  function start(mode, question, options = {}) {
    const invoked = now();
    const started = safeNumber(options.triggerAt) && options.triggerAt <= invoked ? options.triggerAt : invoked;
    const wallStarted = wallNow() - (invoked - started);
    const snapshot = options.questionSnapshot || options.snapshot || {};
    const text = clean(question), compactText = compact(text);
    const keys = new Set(options.sourceKeys || snapshot.sourceKeys || []);
    const source = options.questionSource || snapshot.source || (snapshot.reason === 'manual' ? 'manual' : null);
    const manual = source === 'manual' || source === 'explicit';
    const matches = manual ? [] : finals.filter(item => started - item.at < 60000 && started >= item.at &&
      (keys.size ? keys.has(item.sourceKey) : item.text === text ||
        compact(item.text).length >= 4 && compactText.includes(compact(item.text))));
    const matchedFinal = matches.at(-1) || null;
    const matchedInterim = !manual && !matchedFinal && interim && interim.text === text && started - interim.at < 4000;
    const requestId = `${wallNow().toString(36)}-${++sequence}`;
    const context = { epoch: options.epoch ?? snapshot.epoch ?? null, questionId: options.questionId ?? snapshot.questionId ?? null,
      questionRevision: options.questionRevision ?? snapshot.revision ?? null,
      executionProfile: options.executionProfile || 'standard', model: options.model || null, buildCommit: options.buildCommit || null,
      ragPolicy: options.ragPolicy || null, readyEvidenceHit: false, skippedReason: null,
      optionalContextTokensEstimate: null, sourceCount: 0, queueDelayMs: 0 };
    const updateContext = data => { for (const key of CONTEXT_FIELDS) if (data && data[key] !== undefined) context[key] = data[key]; };
    updateContext(options);
    const questionSource = manual ? 'manual' : source || (matchedFinal ? 'final' : matchedInterim ? 'interim' : 'unknown');
    const questionAgeMs = safeNumber(snapshot.observedAt) && snapshot.timeBase !== 'monotonic'
      ? round(wallStarted - snapshot.observedAt) : matchedFinal ? round(started - matchedFinal.at) : matchedInterim ? round(started - interim.at) : manual ? 0 : null;
    const phases = {};
    let dispatchedAt = null, firstAt = null, sentenceAt = null, domAt = null, paintAt = null;
    let rendererFrameDelayMs = null, sentenceBuffer = '', finished = false, aborted = false;
    const usage = { actualInputTokens: null, actualOutputTokens: null, actualTotalTokens: null, cachedInputTokens: null, actualReasoningTokens: null };
    const input = matchedFinal ? 'stt-final' : matchedInterim ? 'stt-interim' : 'manual-or-transcript';
    const sinceDispatch = at => at == null || dispatchedAt == null ? null : round(at - dispatchedAt);
    function metrics() {
      return { requestId, mode, ...context, input, questionSource, questionAgeMs,
        triggerToDispatchMs: dispatchedAt == null ? null : round(dispatchedAt - started),
        prepareMs: dispatchedAt == null ? null : round(dispatchedAt - started),
        providerResponseMs: sinceDispatch(phases['provider-response']),
        responseBoundary: context.responseBoundary || 'adapter-stream-ready',
        firstProviderEventMs: sinceDispatch(phases['provider-event']),
        firstReasoningMs: sinceDispatch(phases.reasoning), reasoningStartedMs: sinceDispatch(phases.reasoning),
        firstContentMs: sinceDispatch(firstAt), llmFirstTokenMs: sinceDispatch(firstAt),
        triggerToFirstContentMs: firstAt == null ? null : round(firstAt - started),
        requestToFirstTokenMs: firstAt == null ? null : round(firstAt - started),
        triggerToFirstUsefulSentenceMs: sentenceAt == null ? null : round(sentenceAt - started),
        usefulSentenceHeuristic: 'first-non-placeholder-clause-ending-in-punctuation-or-newline',
        reasoningToFirstTokenMs: phases.reasoning == null || firstAt == null ? null : round(firstAt - phases.reasoning),
        finalAgeAtRequestMs: matchedFinal ? round(started - matchedFinal.at) : null,
        finalToFirstTokenMs: matchedFinal && firstAt != null ? round(firstAt - matchedFinal.at) : null,
        asrLagMs: matchedFinal?.asrAssociation === 'utterance-key' ? round(matchedFinal.at - matchedFinal.speechEnd) : null,
        asrAssociation: matchedFinal?.asrAssociation || null,
        vadEndToFinalMs: matchedFinal?.speechEnd != null ? round(matchedFinal.at - matchedFinal.speechEnd) : null,
        renderAckMs: domAt == null ? null : round(domAt - started),
        paintApproxMs: paintAt == null ? null : round(paintAt - started),
        rendererFrameDelayMs, paintMeasurement: paintAt == null ? null : 'double-raf-ack-including-ipc-not-pixel-presentation',
        tokenToRenderAckMs: firstAt == null || domAt == null ? null : round(domAt - firstAt),
        aborted, ...usage };
    }
    function firstToken(requestSent) {
      if (firstAt != null || finished) return false;
      if (dispatchedAt == null && safeNumber(requestSent)) dispatchedAt = requestSent;
      firstAt = now();
      log('[latency][reply] ' + JSON.stringify({ ...metrics(), event: 'first-content' }));
      return true;
    }
    return { requestId, started, configure: updateContext,
      dispatched(metadata = {}) {
        updateContext(metadata);
        if (dispatchedAt == null) dispatchedAt = now();
        return metrics();
      },
      activity(event) {
        if (finished) return;
        const phase = event?.phase || 'provider-event';
        if (phases[phase] == null) phases[phase] = now();
        if (phase === 'reasoning' && phases['provider-event'] == null) phases['provider-event'] = phases[phase];
      },
      firstToken,
      content(value, requestSent) {
        const body = typeof value === 'string' ? value : '';
        if (finished || !body.trim() && firstAt == null) return false;
        const first = firstToken(requestSent);
        if (sentenceAt == null) {
          sentenceBuffer = (sentenceBuffer + body).slice(-2048);
          const clauses = sentenceBuffer.match(/[^。！？!?\n]+[。！？!?\n]/g) || [];
          if (clauses.some(clause => {
            const visible = clause.trim();
            if (/^(?:`{3,}|~{3,}|#{1,6}(?:\s|$))/.test(visible) || !/[\p{L}\p{N}]/u.test(visible)) return false;
            return !/^(?:[，,。！!])*?(?:我来想一想|让我想一想|正在检索|正在思考|请稍等|稍等一下)/.test(visible);
          })) {
            sentenceAt = now();
            log('[latency][reply] ' + JSON.stringify({ ...metrics(), event: 'first-useful-sentence' }));
          }
        }
        return first;
      },
      usage(value = {}) {
        for (const key of ['actualInputTokens', 'actualOutputTokens', 'actualTotalTokens', 'cachedInputTokens', 'actualReasoningTokens']) {
          if (safeNumber(value[key])) usage[key] = value[key];
        }
      },
      renderAck(details = {}) {
        if (firstAt == null) return metrics();
        const at = now();
        if (details.stage === 'paint-approx') {
          if (paintAt != null) return metrics();
          paintAt = at;
          if (safeNumber(details.rendererElapsedMs) && details.rendererElapsedMs < 60000) rendererFrameDelayMs = details.rendererElapsedMs;
        } else {
          if (domAt != null) return metrics();
          domAt = at;
        }
        log('[latency][ui] ' + JSON.stringify({ ...metrics(), event: details.stage === 'paint-approx' ? 'paint-approx' : 'dom-ack' }));
        return metrics();
      },
      finish(details = {}) {
        if (finished) return metrics();
        finished = true; aborted = !!details.aborted;
        log('[latency][reply] ' + JSON.stringify({ ...metrics(), event: 'finished', doneMs: round(now() - started) }));
        return metrics();
      },
      metrics
    };
  }
  function reset() { speechEnd = null; interim = null; finals.length = 0; }
  return { observe, start, reset };
}
module.exports = { ...createReplyLatency(), createReplyLatency };
