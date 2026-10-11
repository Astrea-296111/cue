'use strict';

// Interviewer turns are grouped by pause length.
// - A very short pause usually means the interviewer is continuing the same turn
//   (for example, asking two related questions back-to-back).
// - A longer pause means a new question has started. Any older unanswered question
//   is retired so Ctrl+Enter always targets the newest question.
//
// These two values are intentionally kept at the top of the file so they are easy
// to tune for a different microphone / meeting app.
const DEFAULT_QUESTION_PAUSE_MS = 1500;
const CONTINUATION_GRACE_MS = 2800;

// Phrases that explicitly abandon/switch the previous question. These override
// the pause window and immediately make the following words the newest turn.
const SWITCH = /换(?:一个|个|一道|道)(?:问题|题)|下(?:一个|个|一道|道)(?:问题|题)|(?:这个|这道|上一(?:个|道)?)(?:问题|题)?(?:先)?(?:跳过|不答了|不回答了|不问了|不用回答|先放一放)|(?:前面|刚才)的?(?:问题|题)(?:先)?(?:跳过|不用回答|不回答)|(?:先不|暂时不)(?:聊|说|回答)(?:这个|这道)?(?:问题|题)?/g;

// If the pause is only slightly above the normal merge window, additive wording
// is still treated as the same interviewer turn. This is what keeps “还有一个…”
// / “第二个问题…” together instead of losing the first question.
const CONTINUATION = /^(?:嗯|呃|那)?[\s，,。.!！?？]*(?:还有|另外(?:还有)?|再补充|再问(?:一个|一下)?|再有(?:一个|一点)?|第二(?:个|道)?(?:问题|题)?|第三(?:个|道)?(?:问题|题)?|然后(?:还有)?|以及|同时|顺便(?:再)?问|one more|another question|also\b|and\b|second question)/i;

function isSubstantiveCandidateSpeech(value) {
  const spoken = String(value || '').replace(/[\s，。！？,.!?；;：:、]/g, '');
  if (spoken.length < 4) return false;
  // Short acknowledgements should not split two interviewer questions. The list
  // deliberately stays conservative: real sentence-like candidate speech still
  // creates a turn boundary.
  return !/^(?:嗯|嗯嗯|啊|哦|噢|好的|好|明白|对|对的|是的|了解|可以|没问题|行|收到|知道了|懂了)+$/.test(spoken);
}

class LatestQuestion {
  constructor({
    maxPauseMs = DEFAULT_QUESTION_PAUSE_MS,
    continuationGraceMs = CONTINUATION_GRACE_MS
  } = {}) {
    this.maxPauseMs = maxPauseMs;
    this.continuationGraceMs = Math.max(maxPauseMs, continuationGraceMs);
    this.reset();
  }

  reset() {
    this.clearedAt = Date.now();
    this.speechStartedAt = 0;
    this.lastSpeechEndAt = 0;
    this.lastTextAt = 0;
    this.hasSpeechState = false;
    this.speaking = false;
    this.awaitingText = false;
    this.nextTurn = false;
    this.pendingBoundary = null;
    this.turnId = 0;
    this.floorTime = this.clearedAt;
    this.floorOrders = new Map();
    this.maxOrders = new Map();
    this.parts = new Map();
  }

  beginTurn(at) {
    this.turnId++;
    this.parts.clear();
    this.floorTime = at;
    this.floorOrders = new Map(this.maxOrders);
    this.nextTurn = false;
    this.pendingBoundary = null;
  }

  speechState(data = {}) {
    if (data.channel === 'you') {
      // Do NOT use microphone/VAD duration alone as an answer boundary. System
      // audio can leak into the mic and would incorrectly discard the first of
      // two consecutive interviewer questions. Actual candidate transcript text
      // in observe() is the reliable boundary signal.
      return;
    }
    if (data.channel !== 'them') return;
    this.hasSpeechState = true;
    this.speaking = !!data.speaking;
    if (!data.speaking) {
      this.lastSpeechEndAt = Number(data.speechEndedAt) || Date.now();
      return;
    }
    this.start(data);
  }

  start(meta = {}) {
    const at = Number(meta.speechStartedAt) || Date.now();
    if (at < this.clearedAt || at < this.speechStartedAt) return;
    if (at === this.speechStartedAt) return;

    const gapMs = this.lastSpeechEndAt > 0
      ? Math.max(0, at - this.lastSpeechEndAt)
      : 0;

    if (!this.turnId) {
      this.beginTurn(at);
    } else if (this.nextTurn || gapMs > this.maxPauseMs) {
      // We deliberately defer clearing the old parts until the first text from
      // this new speech arrives. While waiting, snapshot() returns empty, so a
      // Ctrl+Enter press can never fall back to the previous question.
      this.pendingBoundary = {
        at,
        gapMs,
        forceNew: this.nextTurn
      };
    } else {
      this.pendingBoundary = null;
    }

    this.speechStartedAt = at;
    this.awaitingText = true;
  }

  markSubmitted(snapshot) {
    if (snapshot?.turnId === this.turnId) this.nextTurn = true;
  }

  _shouldMergePendingBoundary(raw, pending) {
    if (!pending || pending.forceNew) return false;
    if (pending.gapMs <= this.maxPauseMs) return true;
    return pending.gapMs <= this.continuationGraceMs && CONTINUATION.test(raw);
  }

  observe(data, final = false) {
    if (data?.channel === 'you') {
      // Ignore candidate-channel text that arrives while the interviewer channel
      // is actively speaking; in speaker mode this is commonly acoustic echo.
      if (!this.speaking && isSubstantiveCandidateSpeech(data.text)) this.nextTurn = true;
      return;
    }
    if (data?.channel !== 'them') return;

    const raw = String(data.text || '').trim();
    if (!raw) return;

    const now = Date.now();
    const at = Number(data.speechStartedAt) || this.speechStartedAt || now;
    const source = String(data.sourceId || 'stream');
    const order = Number.isFinite(data.utteranceOrder) ? data.utteranceOrder : null;
    const segment = Number.isFinite(data.segmentId) ? data.segmentId : 0;
    const key = data.utteranceKey ? `${source}:${data.utteranceKey}` : `${at}:${segment}`;
    let previous = this.parts.get(key);

    // Late results may complete an EARLIER question in the same turn. They can
    // never revive a question retired by an answer, a pause boundary or switch.
    if (!previous && (at < this.floorTime || at < this.clearedAt ||
        (order !== null && order <= (this.floorOrders.get(source) ?? -Infinity)))) return;
    if (data.ignoreForLive && order === null && !previous) return;

    const isNewest = order !== null
      ? order >= (this.maxOrders.get(source) ?? -Infinity)
      : at >= this.speechStartedAt;
    const newUtterance = !previous && isNewest &&
      (data.utteranceKey || data.segmentId != null || at >= this.speechStartedAt);

    const switches = [...raw.matchAll(SWITCH)];
    const lastSwitch = switches.at(-1);
    let beganTurnHere = false;
    const beginNewestTurn = () => {
      if (!beganTurnHere) {
        this.beginTurn(at);
        beganTurnHere = true;
      }
      previous = undefined;
    };

    // Resolve a deferred pause boundary only with text belonging to the latest
    // speech. An old final arriving late must not clear/replace the new question.
    const pending = this.pendingBoundary;
    if (pending && at >= pending.at && newUtterance) {
      if (!this._shouldMergePendingBoundary(raw, pending)) beginNewestTurn();
      else this.pendingBoundary = null;
    }

    // Fallback for providers without VAD/speech-state events.
    const textGapMs = this.lastTextAt ? now - this.lastTextAt : 0;
    const noVadLongGap = !this.hasSpeechState && textGapMs > this.maxPauseMs;
    const noVadContinuation = noVadLongGap && textGapMs <= this.continuationGraceMs && CONTINUATION.test(raw);
    if (!this.turnId || (newUtterance && (this.nextTurn || (noVadLongGap && !noVadContinuation)))) {
      beginNewestTurn();
    }

    if (previous?.final && !final && (data.segmentId != null || data.utteranceKey)) return;

    // Preserve the switch phrase so the model can understand any correction,
    // while removing everything before the last explicit abandon/switch phrase.
    const text = lastSwitch ? raw.slice(lastSwitch.index) : raw;
    if (lastSwitch && isNewest && !previous?.switch) beginNewestTurn();

    this.parts.set(key, {
      text,
      final,
      at,
      source,
      order,
      segment,
      switch: !!lastSwitch || !!previous?.switch
    });

    if (order !== null) {
      this.maxOrders.set(source, Math.max(order, this.maxOrders.get(source) ?? -Infinity));
    }
    while (this.maxOrders.size > 8) this.maxOrders.delete(this.maxOrders.keys().next().value);

    if (at >= this.speechStartedAt) {
      this.speechStartedAt = at;
      this.awaitingText = false;
      if (this.pendingBoundary && at >= this.pendingBoundary.at) this.pendingBoundary = null;
    }
    this.lastTextAt = now;

    // Bound long monologues without selecting only their final ASR fragment.
    while (this.parts.size > 32) {
      const oldest = this.ordered()[0];
      this.parts.delete(oldest[0]);
    }
  }

  ordered() {
    return [...this.parts.entries()].sort(([, a], [, b]) =>
      a.source === b.source && a.order !== null && b.order !== null
        ? a.order - b.order
        : a.at - b.at || a.segment - b.segment);
  }

  snapshot() {
    const texts = [];
    for (const [, part] of this.ordered()) {
      if (texts.at(-1) !== part.text) texts.push(part.text);
    }
    return {
      // Critical stale-answer guard: while a newer interviewer utterance has
      // started but has no text yet, never expose the older question as current.
      text: this.awaitingText ? '' : texts.join('\n').slice(-8000),
      awaitingText: this.awaitingText,
      speechStartedAt: this.speechStartedAt,
      turnId: this.turnId
    };
  }
}

module.exports = {
  LatestQuestion,
  DEFAULT_QUESTION_PAUSE_MS,
  CONTINUATION_GRACE_MS
};
