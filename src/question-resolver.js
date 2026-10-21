'use strict';

const { transcriptSimilarity } = require('./transcript-normalizer');
const { isSpeechNoise } = require('./speech-noise-filter');

const DEFAULT_NEW_QUESTION_GAP_MS = 2800;
const DEFAULT_LATE_FINAL_GRACE_MS = 1800;

const SWITCH_RE = /(?:换(?:一个|个|一道|道)(?:问题|题)|下(?:一个|个|一道|道)(?:问题|题)|(?:这个|这道|上一(?:个|道)?)(?:问题|题)?(?:先)?(?:跳过|不答了|不回答了|不问了|不用回答|先放一放)|(?:前面|刚才)的?(?:问题|题)(?:先)?(?:跳过|不用回答|不回答)|(?:先不|暂时不)(?:聊|说|回答)(?:这个|这道)?(?:问题|题)?)/i;
const SWITCH_PREFIX_RE = /^.*?(?:换(?:一个|个|一道|道)(?:问题|题)|下(?:一个|个|一道|道)(?:问题|题)|(?:这个|这道|上一(?:个|道)?)(?:问题|题)?(?:先)?(?:跳过|不答了|不回答了|不问了|不用回答|先放一放)|(?:前面|刚才)的?(?:问题|题)(?:先)?(?:跳过|不用回答|不回答)|(?:先不|暂时不)(?:聊|说|回答)(?:这个|这道)?(?:问题|题)?)[\s，,。.!！:：-]*/i;

const SUPPLEMENT_RE = /^(?:嗯|呃|那)?[\s，,。.!！?？]*(?:比如(?:说)?|例如|举个例子|也就是说|换句话说|具体来说|更具体一点|我的意思是|像是|或者说|尤其是|包括|比如像)/i;
const CONTINUATION_QUESTION_RE = /^(?:嗯|呃|那)?[\s，,。.!！?？]*(?:还有|另外(?:还有)?|再补充|再问(?:一个|一下)?|再有(?:一个|一点)?|第二(?:个|道)?(?:问题|题)?|第三(?:个|道)?(?:问题|题)?|然后(?:还有)?|以及|同时|顺便(?:再)?问|one more|another question|also\b|and\b|second question)/i;
const QUESTION_SIGNAL_RE = /(?:为什么|为何|怎么|如何|怎样|是不是|是否|能不能|可不可以|有没有|会不会|要不要|需不需要|还需要|应该|什么|哪些|哪种|哪个|多少|哪里|哪儿|区别|原理|作用|优缺点|代价|取舍|原因|流程|怎么做|怎么实现|如何实现|介绍(?:一下)?|讲讲|说说|解释(?:一下)?|谈谈|你做了什么|负责什么|遇到什么|怎么解决|what\b|why\b|how\b|which\b|where\b|when\b|who\b|can you\b|could you\b|would you\b|tell me\b|describe\b|explain\b)/i;
const CONDITION_START_RE = /^(?:那)?(?:如果|假如|要是|当|假设|比如|例如)/;
const CONDITION_COMPLETION_RE = /(?:那么|那(?:么)?|就|则|会不会|是不是|是否|怎么|如何|为什么|能不能|可不可以|有没有|要不要|需不需要|还需要|应该|会|能|可以|吗|呢|[?？])/;
const OPEN_END_RE = /(?:如果|假如|要是|当|假设|比如|例如|但是|不过|然后|因为|所以|或者|以及|关于|对于|通过|基于|至于|还有一个问题|我再问一个|我想问一下|为什么用|怎么用|如何用|怎么做|如何做|怎么实现|如何实现|用|对|在|从|把|让|给|和|与|或)[\s，,。.!！:：-]*$/i;
const DANGLING_TAIL_RE = /^(?:在|从|对|对于|关于|通过|基于|结合|当|如果|假如|要是|因为|所以|然后|但是|不过|以及|或者|还有|接下来|这个|这次|整个|其中|你在|我们在)(?:[\s\S]{0,12})$/i;
const IMPERATIVE_QUESTION_RE = /^(?:请)?(?:介绍|讲讲|说说|说一下|解释|解释一下|谈谈|分析|比较|描述|展开|复盘|聊聊|概括|总结一下|walk me through|tell me about|describe|explain)\b/i;
// Code edits are complete interviewer requirements even without a question mark.
const CODE_CHANGE_REQUEST_RE = /^(?:(?:那(?:么)?|现在|请|麻烦)\s*)*(?:你)?(?:把.{1,60})?(?:修改|改(?:成|为|用|一下)|换(?:成|用)|重写(?:成)?|替换(?:成)?|增加|添加|加上|补(?:上|充)|保留|去掉|删除|修复|优化).{2,}|^(?:请)?(?:不要|别)(?:再)?用.{1,40}[,，;；]\s*(?:改|换)(?:成|为|用).{2,}/i;
const CONTEXT_PREAMBLE_RE = /^(?:那(?:么)?[\s,，]*)?(?:假设|假如|如果|考虑|现在有|我们(?:有|的|正在)|有一个|场景|背景|给定|已知|要求|限制|其中|同时|但是|并且|而且)/;
const SEMANTIC_CONTINUATION_RE = /^(?:那(?:么)?[\s,，]*)?(?:如果|假设|假如|但是|不过|其中|同时|并且|而且|要求|限制|还(?:要|需)|不能|不允许|在这个|在这种|这个|这种|这些|上述|刚才|基于|针对)|(?:这些条件|上述条件|同一场景|刚才的方案)/;
const TECHNICAL_SUBJECT_RE = /\b(?:redis|mysql|postgresql|kafka|java|jvm|react|rag|langgraph|tcp|http|tcs|repopilot|function\s*call)\b/gi;

function changesTechnicalSubject(previous, next) {
  const before = new Set((previous.match(TECHNICAL_SUBJECT_RE) || []).map(s => s.toLowerCase()));
  const after = (next.match(TECHNICAL_SUBJECT_RE) || []).map(s => s.toLowerCase());
  return before.size > 0 && after.length > 0 && !after.some(s => before.has(s));
}

function continuesQuestion(previous, next) {
  if (changesTechnicalSubject(previous, next)) return false;
  return SEMANTIC_CONTINUATION_RE.test(next) || CONTINUATION_QUESTION_RE.test(next) ||
    isLikelySupplement(next) || isCodeChangeRequest(next);
}

function clipQuestion(text) {
  if (text.length <= 8000) return text;
  const marker = '\n[过长发言的中间部分已省略]\n';
  const head = Math.floor((8000 - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(8000 - marker.length - head));
}

function clean(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim();
}

function compact(value) {
  return clean(value).replace(/[\s，。！？,.!?；;：:、'"“”‘’()（）\[\]{}【】<>《》-]/g, '');
}

function hasQuestionMark(text) {
  return /[?？]/.test(text);
}

function isLikelyIncompleteFragment(value) {
  const text = clean(value);
  const body = compact(text);
  if (!body) return true;
  if (isSpeechNoise(text)) return true;
  if (hasQuestionMark(text)) return false;

  // Tiny partials such as “如果平”, “为什么用”, “还有一个问题” must never
  // replace a previously confirmed question just because ASR emitted sentence_end.
  if (body.length <= 3 && !QUESTION_SIGNAL_RE.test(text)) return true;
  if (OPEN_END_RE.test(text)) return true;
  // ASR can emit a final containing one or more complete questions followed by
  // the beginning of the next clause, e.g. ‘...? 在这个过程’. That tail is
  // not answerable yet even though it is longer than a tiny noise fragment.
  if (DANGLING_TAIL_RE.test(text) && !QUESTION_SIGNAL_RE.test(text) && !IMPERATIVE_QUESTION_RE.test(text)) return true;

  if (CONDITION_START_RE.test(text) && !CONDITION_COMPLETION_RE.test(text)) {
    return true;
  }

  if (/^(?:还有一个问题|另外一个问题|我再问一个|我想问一下|再问一下)[\s，,。.!！]*$/i.test(text)) {
    return true;
  }

  // A short interrogative stem can still be unfinished even though it contains
  // “为什么/怎么/如何”. Avoid prematurely promoting it before its object arrives.
  if (body.length <= 7 && /^(?:为什么|怎么|如何|是不是|是否|能不能|有没有|会不会|要不要)/.test(body) &&
      /(?:用|对|在|从|把|让|给|和|与|或|的|是)$/.test(body)) {
    return true;
  }

  return false;
}

function isLikelyCompleteQuestion(value) {
  const text = clean(value);
  const body = compact(text);
  if (!body || isLikelyIncompleteFragment(text)) return false;
  if (hasQuestionMark(text)) return true;
  if (isCodeChangeRequest(text)) return true;
  if (IMPERATIVE_QUESTION_RE.test(text) && body.length >= 5) return true;
  if (QUESTION_SIGNAL_RE.test(text) && body.length >= 5) return true;
  return false;
}

function isCodeChangeRequest(value) {
  const text = clean(value);
  return !isLikelyIncompleteFragment(text) && CODE_CHANGE_REQUEST_RE.test(text);
}

function isLikelySupplement(value) {
  const text = clean(value);
  if (!text || isSpeechNoise(text)) return false;
  return SUPPLEMENT_RE.test(text) && !isLikelyCompleteQuestion(text);
}

function splitTrailingIncompleteClause(value) {
  const text = clean(value);
  if (!text) return null;
  let lastQuestionMark = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '?' || text[i] === '？') lastQuestionMark = i;
  }
  if (lastQuestionMark < 0 || lastQuestionMark >= text.length - 1) return null;
  const prefix = clean(text.slice(0, lastQuestionMark + 1));
  const tail = clean(text.slice(lastQuestionMark + 1));
  if (!prefix || !tail || !isLikelyCompleteQuestion(prefix)) return null;
  // A substantive example after '?' is still part of the current question.
  if (isLikelySupplement(tail) && compact(tail).length >= 12 && !OPEN_END_RE.test(tail)) return null;
  if (!isLikelyIncompleteFragment(tail)) return null;
  return { completeText: prefix, pendingText: tail };
}

function isSubstantiveCandidateSpeech(value) {
  const spoken = compact(value);
  if (spoken.length < 4) return false;
  return !/^(?:嗯|嗯嗯|啊|哦|噢|好的|好|明白|对|对的|是的|了解|可以|没问题|行|收到|知道了|懂了)+$/.test(spoken);
}

function stripSwitchPrefix(value) {
  const text = clean(value);
  if (!SWITCH_RE.test(text)) return text;
  const stripped = text.replace(SWITCH_PREFIX_RE, '').trim();
  return stripped || text;
}

function overlapsEnough(a, b) {
  if (!a || !b) return false;
  const score = transcriptSimilarity(a, b);
  if (score >= 0.88) return true;
  const aa = compact(a).toLowerCase();
  const bb = compact(b).toLowerCase();
  if (!aa || !bb) return false;
  const shorter = aa.length <= bb.length ? aa : bb;
  const longer = aa.length > bb.length ? aa : bb;
  return shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.72;
}

function mergeFragment(pending, next) {
  const a = clean(pending);
  const b = clean(next);
  if (!a) return b;
  if (!b) return a;
  if (overlapsEnough(a, b)) return compact(a).length >= compact(b).length ? a : b;
  if (b.startsWith(a) || a.startsWith(b)) return b.length >= a.length ? b : a;

  // A clearly independent new question should not be glued to an unfinished tail.
  if (isLikelyCompleteQuestion(b) &&
      (changesTechnicalSubject(a, b) ||
       (/^(?:为什么|怎么|如何|什么|哪些|是否|是不是|能不能|有没有|会不会|要不要|请|介绍|讲讲|解释|what\b|why\b|how\b|can\b|could\b|would\b)/i.test(b) &&
        !continuesQuestion(a, b) && !(compact(a).length >= 12 && CONTEXT_PREAMBLE_RE.test(a))))) {
    return null;
  }

  if (!isLikelyCompleteQuestion(a)) {
    const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
    const separator = /[。.!！;；]$/.test(a) ? '\n' : (needsSpace ? ' ' : '');
    return clipQuestion(`${a}${separator}${b}`);
  }
  return null;
}

class QuestionResolver {
  constructor({
    newQuestionGapMs = DEFAULT_NEW_QUESTION_GAP_MS,
    lateFinalGraceMs = DEFAULT_LATE_FINAL_GRACE_MS
  } = {}) {
    this.newQuestionGapMs = Math.max(800, Number(newQuestionGapMs) || DEFAULT_NEW_QUESTION_GAP_MS);
    this.lateFinalGraceMs = Math.max(500, Number(lateFinalGraceMs) || DEFAULT_LATE_FINAL_GRACE_MS);
    this.reset();
  }

  reset() {
    this.stableParts = [];
    this.pendingText = '';
    this.pendingAt = 0;
    this.interim = null;
    this.speaking = false;
    this.awaitingText = false;
    this.lastSpeechEndAt = 0;
    this.lastFinalAt = 0;
    this.boundary = null;
    this.hasSpeechState = false;
    this.revision = 0;
    this.lastSubmitted = null;
    this.seenFinalKeys = new Map();
  }

  _clearActive() {
    this.stableParts = [];
    this.pendingText = '';
    this.pendingAt = 0;
    this.interim = null;
    this.awaitingText = false;
    this.boundary = null;
    this.revision++;
  }

  _pruneSeen(now) {
    for (const [key, at] of this.seenFinalKeys) {
      if (now - at > 12000) this.seenFinalKeys.delete(key);
    }
    while (this.seenFinalKeys.size > 80) this.seenFinalKeys.delete(this.seenFinalKeys.keys().next().value);
  }

  speechState(data = {}) {
    const channel = data.channel;
    if (channel === 'you') return;
    if (channel !== 'them') return;

    const now = Date.now();
    this.hasSpeechState = true;
    this.speaking = !!data.speaking;
    if (!data.speaking) {
      this.lastSpeechEndAt = Number(data.speechEndedAt) || now;
      return;
    }

    const startedAt = Number(data.speechStartedAt) || now;
    const gapMs = this.lastSpeechEndAt ? Math.max(0, startedAt - this.lastSpeechEndAt) : 0;
    this.boundary = { at: startedAt, gapMs };
    this.awaitingText = true;
  }

  _eventKey(data, _final) {
    if (data?.utteranceKey) return `${data.sourceId || 'stream'}:${data.utteranceKey}`;
    if (Number.isFinite(data?.utteranceOrder)) return `${data.sourceId || 'stream'}:${data.utteranceOrder}`;
    return '';
  }

  _isLateSubmittedDuplicate(text, data, now) {
    const submitted = this.lastSubmitted;
    if (!submitted || now - submitted.at > this.lateFinalGraceMs) return false;
    // A forced partial reply must not suppress the completed ASR final.
    if (submitted.partial && compact(text).length > compact(submitted.text).length) return false;
    const rawKey = data?.utteranceKey ? `${data.sourceId || 'stream'}:${data.utteranceKey}` : '';
    if (rawKey && submitted.keys?.has(rawKey)) return true;
    return overlapsEnough(text, submitted.text);
  }

  _appendStable(text, meta = {}) {
    const value = clean(text);
    if (!value) return;
    const last = this.stableParts.at(-1);
    if (last && overlapsEnough(last.text, value)) {
      if (compact(value).length > compact(last.text).length) last.text = value;
      last.at = meta.at || Date.now();
      if (meta.key) last.key = meta.key;
      return;
    }
    this.stableParts.push({ text: value, at: meta.at || Date.now(), key: meta.key || '' });
    if (this.stableParts.length > 64) this.stableParts.splice(0, this.stableParts.length - 64);
    this.revision++;
  }

  observe(data = {}, final = false) {
    const channel = data.channel;
    const raw = clean(data.text);

    if (channel === 'you') {
      if (!this.speaking && isSubstantiveCandidateSpeech(raw)) {
        // If the candidate has started giving a real answer themselves, do not let
        // Ctrl+Enter later resurrect the old unanswered interviewer question.
        this._clearActive();
      }
      return;
    }
    if (channel !== 'them') return;

    if (!final) {
      if (!raw) {
        this.interim = null;
        return;
      }
      if (isSpeechNoise(raw)) return;
      this.interim = {
        text: raw,
        at: Date.now(),
        key: data.utteranceKey ? `${data.sourceId || 'stream'}:${data.utteranceKey}` : ''
      };
      this.awaitingText = false;
      return;
    }

    if (!raw || isSpeechNoise(raw)) return;
    const now = Date.now();
    const eventKey = this._eventKey(data, true);
    if (eventKey) {
      this._pruneSeen(now);
      if (this.seenFinalKeys.has(eventKey)) return;
      this.seenFinalKeys.set(eventKey, now);
    }

    if (this._isLateSubmittedDuplicate(raw, data, now)) {
      this.interim = null;
      this.awaitingText = false;
      return;
    }

    let text = raw;
    const switched = SWITCH_RE.test(text);
    if (switched) {
      this._clearActive();
      text = stripSwitchPrefix(text);
    }

    // One ASR final may contain two complete questions plus the unfinished start
    // of a third sentence. Promote only the complete prefix and keep the tail
    // pending so Ctrl+Enter never sends ‘在这个过程’ as if it were complete.
    const trailing = splitTrailingIncompleteClause(text);
    const trailingPending = trailing?.pendingText || '';
    if (trailing) text = trailing.completeText;

    const finalGapMs = this.lastFinalAt ? now - this.lastFinalAt : 0;
    const boundaryGapMs = this.boundary?.gapMs || 0;
    // Prefer real VAD boundaries when available. ASR delivery latency by itself
    // must not split one spoken turn into a different question.
    const longBoundary = this.hasSpeechState
      ? boundaryGapMs > this.newQuestionGapMs
      : finalGapMs > this.newQuestionGapMs;
    const continuationQuestion = CONTINUATION_QUESTION_RE.test(text);

    if (this.pendingText) {
      const merged = mergeFragment(this.pendingText, text);
      if (merged && isLikelyCompleteQuestion(merged)) {
        text = merged;
        this.pendingText = '';
        this.pendingAt = 0;
      } else if (merged && isLikelySupplement(merged) && this.stableParts.length) {
        text = merged;
        this.pendingText = '';
        this.pendingAt = 0;
      } else if (isLikelyCompleteQuestion(text) && !continuationQuestion) {
        // The old unfinished tail never completed; a real new question supersedes it.
        this.pendingText = '';
        this.pendingAt = 0;
      } else if (merged) {
        // Scene-setting can span several ASR finals before the actual question.
        text = merged;
        this.pendingText = '';
        this.pendingAt = 0;
      }
    }

    // Supplements such as “比如图片会不会变模糊” may look syntactically
    // incomplete on their own, but once a stable question exists they belong to
    // that question and must be retained before the generic incomplete check.
    const relatedConstraint = this.stableParts.length && !isLikelyCompleteQuestion(text) &&
      !isLikelyIncompleteFragment(text) &&
      continuesQuestion(this.stableParts.map(part => part.text).join('\n'), text);
    if (isLikelySupplement(text) || relatedConstraint) {
      if (this.stableParts.length) this._appendStable(text, { at: now, key: eventKey });
      else {
        this.pendingText = text;
        this.pendingAt = now;
      }
      this.interim = null;
      this.awaitingText = false;
      this.boundary = null;
      this.lastFinalAt = now;
      return;
    }

    if (isLikelyIncompleteFragment(text)) {
      this.pendingText = text;
      this.pendingAt = now;
      this.interim = null;
      this.awaitingText = false;
      this.lastFinalAt = now;
      return;
    }

    if (isLikelyCompleteQuestion(text)) {
      if (!switched && longBoundary && this.stableParts.length && !continuationQuestion &&
          !continuesQuestion(this.stableParts.map(part => part.text).join('\n'), text)) {
        this.stableParts = [];
        this.pendingText = '';
        this.pendingAt = 0;
      }
      this._appendStable(text, { at: now, key: eventKey });
      if (trailingPending) {
        this.pendingText = trailingPending;
        this.pendingAt = now;
      }
      this.interim = null;
      this.awaitingText = false;
      this.boundary = null;
      this.lastFinalAt = now;
      return;
    }

    // A declarative fragment that is not a recognized supplement is held back.
    // It may become answerable after the next ASR segment, but cannot steal focus.
    this.pendingText = text;
    this.pendingAt = now;
    this.interim = null;
    this.awaitingText = false;
    this.lastFinalAt = now;
  }

  // Read-only preview shares final-fragment merging with formal submission.
  // It never marks submitted speech or advances conversation/checklist state.
  previewForPrefetch() { return this.resolveForSubmit({ allowPartial: true }); }

  resolveForSubmit({ allowPartial = false } = {}) {
    let parts = this.stableParts.map((part) => part.text);
    let provisional = false;
    const interimText = clean(this.interim?.text);
    const interimTrailing = splitTrailingIncompleteClause(interimText);
    const interimAnswerText = interimTrailing?.completeText || interimText;
    const interimPendingText = interimTrailing?.pendingText || '';

    if (interimAnswerText && !isSpeechNoise(interimAnswerText)) {
      if (isLikelyCompleteQuestion(interimAnswerText)) {
        const longBoundary = (this.boundary?.gapMs || 0) > this.newQuestionGapMs;
        const continuationQuestion = CONTINUATION_QUESTION_RE.test(interimAnswerText);
        if (longBoundary && parts.length && !continuationQuestion &&
            !continuesQuestion(parts.join('\n'), interimAnswerText)) parts = [];
        if (!parts.length || !overlapsEnough(parts.at(-1), interimAnswerText)) parts.push(interimAnswerText);
        provisional = true;
      } else if (isLikelySupplement(interimAnswerText) && parts.length) {
        parts.push(interimAnswerText);
        provisional = true;
      }
    }

    const deduped = [];
    for (const part of parts) {
      if (!deduped.length || !overlapsEnough(deduped.at(-1), part)) deduped.push(part);
      else if (compact(part).length > compact(deduped.at(-1)).length) deduped[deduped.length - 1] = part;
    }

    let text = clipQuestion(deduped.join('\n').trim());
    const pendingText = this.pendingText || interimPendingText || (interimText && !isLikelyCompleteQuestion(interimText) ? interimText : '');
    let partial = false;
    if (allowPartial && !text) {
      text = clipQuestion(mergeFragment(this.pendingText, interimText) || interimText || this.pendingText);
      partial = !!text;
      provisional = !!interimText;
    }
    const keys = new Set(this.stableParts.map((part) => part.key).filter(Boolean));
    if (this.interim?.key && provisional) keys.add(this.interim.key);

    return {
      text,
      pendingText,
      partial,
      provisional,
      awaitingText: this.awaitingText,
      revision: this.revision,
      keys,
      parts: this.stableParts.map(part => part.text),
      interimText
    };
  }

  markSubmitted(snapshot) {
    const text = clean(snapshot?.text);
    if (!text) return;
    this.lastSubmitted = {
      text,
      at: Date.now(),
      keys: snapshot?.keys instanceof Set ? new Set(snapshot.keys) : new Set(),
      partial: !!snapshot.partial
    };
    // Consume only the frozen request. Speech arriving during generation, and
    // an unsubmitted tail after a complete question, belong to the next request.
    const frozen = new Set(snapshot.parts || [text]);
    const remaining = this.stableParts.filter(part => !frozen.has(part.text));
    const pending = snapshot.partial && this.pendingText === snapshot.pendingText ? ''
      : this.pendingText || (!snapshot.partial ? snapshot.pendingText || '' : '');
    const interim = this.interim?.text !== snapshot.interimText ? this.interim : null;
    const boundary = this.boundary;
    const awaitingText = this.awaitingText;
    this._clearActive();
    this.stableParts = remaining;
    this.pendingText = pending;
    this.pendingAt = pending ? Date.now() : 0;
    this.interim = interim;
    if (remaining.length || pending || interim || awaitingText) {
      this.boundary = boundary;
      this.awaitingText = awaitingText;
    }
  }
}

module.exports = {
  QuestionResolver,
  DEFAULT_NEW_QUESTION_GAP_MS,
  DEFAULT_LATE_FINAL_GRACE_MS,
  isLikelyIncompleteFragment,
  isLikelyCompleteQuestion,
  isCodeChangeRequest,
  isLikelySupplement,
  splitTrailingIncompleteClause,
  isSubstantiveCandidateSpeech
};
