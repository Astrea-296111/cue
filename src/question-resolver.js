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
const OPEN_END_RE = /(?:如果|假如|要是|当|假设|比如|例如|但是|不过|然后|因为|所以|或者|以及|关于|对于|通过|基于|至于|还有一个问题|我再问一个|我想问一下|为什么用|怎么用|如何用|怎么做|如何做|怎么实现|如何实现|怎么|如何|为什么|用|对|在|从|把|让|给|和|与|或)[\s，,。.!！:：-]*$/i;
const DANGLING_TAIL_RE = /^(?:在|从|对|对于|关于|通过|基于|结合|当|如果|假如|要是|因为|所以|然后|但是|不过|以及|或者|还有|接下来|这个|这次|整个|其中|你在|我们在)(?:[\s\S]{0,12})$/i;
const IMPERATIVE_QUESTION_RE = /^(?:请)?(?:介绍|讲讲|说说|说一下|解释|解释一下|谈谈|分析|比较|描述|展开|复盘|聊聊|概括|总结一下|walk me through|tell me about|describe|explain)(?:\b|(?=[\u3400-\u9fff]))/i;
// Code edits are complete interviewer requirements even without a question mark.
const IMPLEMENTATION_REQUEST_RE = /(?:请|麻烦|给定|要求|用|实现|编写|写一个)[\s\S]{0,240}(?:实现|编写|写(?:一(?:个|段))?|返回|求解|输出|计算|设计)[\s\S]{2,}/i;
const CODE_CHANGE_REQUEST_RE = /^(?:(?:那(?:么)?|现在|请|麻烦)\s*)*(?:你)?(?:把.{1,60})?(?:修改|改(?:成|为|用|一下)|换(?:成|用)|重写(?:成)?|替换(?:成)?|增加|添加|加上|补(?:上|充)|保留|去掉|删除|修复|优化).{2,}|^(?:请)?(?:不要|别)(?:再)?用.{1,40}[,，;；]\s*(?:改|换)(?:成|为|用).{2,}/i;
const CONTEXT_PREAMBLE_RE = /^(?:那(?:么)?[\s,，]*)?(?:在|假设|假如|如果|考虑|现在有|我们(?:有|的|正在)|有一个|场景|背景|给定|已知|要求|限制|其中|同时|但是|并且|而且)/;
const PREMISE_RE = /(?:不能|不得|不允许|必须|至少|最多|不超过|不少于|只能|仅能|条件下|情况下)/;
const SEMANTIC_CONTINUATION_RE = /^(?:那(?:么)?[\s,，]*)?(?:如果|假设|假如|但是|不过|其中|同时|并且|而且|要求|限制|还(?:要|需)|不能|不允许|在这个|在这种|这个|这种|这些|上述|刚才|基于|针对)|(?:这些条件|上述条件|同一场景|刚才的方案)/;
// Compare identifiers structurally; no project/model/technology allowlist.
const TECHNICAL_SUBJECT_RE = /\b[A-Za-z][A-Za-z0-9_.+#/-]{1,40}\b/g;

const CORRECTION_RE = /(?:不是[\s\S]{1,100}?[，,;；]?(?:我(?:问|说)的是|我问|讲)|(?:现在)?我(?:问|说)的是|先不(?:聊|说|讲)[\s\S]{1,100}?[，,;；]\s*(?:讲|说|聊)|别(?:聊|说|讲)[\s\S]{1,100}?[，,;；]\s*(?:讲|说|聊))/i;
const NEW_TOPIC_RE = /^(?:那(?:么)?[\s,，]*)?(?:另外(?:一(?:个|道))?(?:问题|题)|(?:我)?再问一(?:个|道)(?:问题|题)?|换(?:一?(?:个|道))(?:问题|题)|下(?:一?(?:个|道))(?:问题|题)|现在(?:我)?问(?:的)?是)/;
const ELLIPTIC_QUESTION_RE = /^(?:那(?:么)?[\s,，]*)?(?:为什么|为何|怎么恢复|失败(?:后)?(?:如何|怎么)(?:恢复|处理)|(?:出错|异常|超时|回滚|重试)(?:时|后)?(?:如何|怎么|怎么办)|代价呢|取舍呢|还有呢)[?？。.!！]*$/;
const REFERENTIAL_RE = /(?:这样|这么|刚才|上述|前面|第二点|第一点|这个(?:方案|设计|实现|选择|流程|做法)|这种(?:方案|设计|实现|选择|做法))/;
function isCorrection(text) {
  return CORRECTION_RE.test(text) && !/(?:问的是|说的是|讲|说|聊)[\s,，。.!！]*$/.test(text);
}

function changesTechnicalSubject(previous, next) {
  const before = new Set((previous.match(TECHNICAL_SUBJECT_RE) || []).map(s => s.toLowerCase()));
  const after = (next.match(TECHNICAL_SUBJECT_RE) || []).map(s => s.toLowerCase());
  return before.size > 0 && after.length > 0 && !after.some(s => before.has(s));
}

function continuesQuestion(previous, next) {
  if (NEW_TOPIC_RE.test(next) || isCorrection(next)) return false;
  return OPEN_END_RE.test(previous) || /(?:怎么|如何|为什么)[\s，,。.!！]*$/.test(previous) || /^(?:它们|他们|这两种|这些)/.test(next) || SEMANTIC_CONTINUATION_RE.test(next) || ELLIPTIC_QUESTION_RE.test(next) || CONTINUATION_QUESTION_RE.test(next) ||
    isLikelySupplement(next) || isCodeChangeRequest(next);
}

// An ASR final is a transport boundary, not necessarily a topic boundary.
// Preserve a scene introduced before its question until the user submits it or
// the interviewer explicitly changes topic. A pause alone is not a switch.
function hasOpenScene(parts, lastSubmitted, questionId, now) {
  if (!parts.length || lastSubmitted?.questionId === questionId) return false;
  if (now - (parts.at(-1).at || now) > 45000) return false;
  return !isLikelyCompleteQuestion(parts[0].text) &&
    parts.some(part => isLikelyCompleteQuestion(part.text));
}

// Auto-close only when the reply itself supplies strong, local evidence of
// addressing one question. Uncertain/short answers remain manually actionable.
function candidateAddressesQuestion(question, speech) {
  const answer = clean(speech), q = clean(question);
  if (compact(answer).length < 12 || /^(?:嗯|哦|好|啊|那个|稍等|我想一下|让我想想)[，,\s]*(?:我)?(?:调|检查|测试)(?:一下|下)?(?:声音|音量|麦克风|设备)/.test(answer)) return false;
  if (/自我介绍|介绍(?:一下|下)?自己/.test(q) && /(?:我叫|我的名字|我本科|我毕业|我目前|我现在|我是一名)/.test(answer)) return true;
  const terms = value => new Set((value.match(/[A-Za-z][A-Za-z0-9_.+#/-]{1,40}|[\u3400-\u9fff]{2,}/g) || []).flatMap(word => {
    if (/^[A-Za-z]/.test(word)) return [word.toLowerCase()];
    const result=[]; for(let i=0;i<word.length-1;i++) result.push(word.slice(i,i+2)); return result;
  }));
  const ignored = new Set(['怎么','如何','什么','可以','这个','一个','我们','然后','一下','问题','处理','你们','我在','就是','所以']);
  const questionTerms = terms(q);
  const common=[...terms(answer)].filter(t=>!ignored.has(t)&&questionTerms.has(t));
  return common.length >= 2 && /(?:我|我们|首先|因为|通过|采用|使用|一般|需要|主要|比如)/.test(answer);
}

function groupCoverage(parts, answeredParts) {
  const groups = [];
  for (const part of parts) {
    const id = part.key || `sequence:${part.sequence}`;
    const answered = !!part.final && answeredParts.get(id) === part.text;
    const previous = groups.at(-1);
    const separate = CONTINUATION_QUESTION_RE.test(part.text) || NEW_TOPIC_RE.test(part.text) || isCorrection(part.text);
    const sameScene = previous && !separate && previous.answered === answered && previous.canMark === !!part.final &&
      // Keep shared scene context separate from the first question, so
      // marking that question answered does not remove other questions' context.
      !(!isLikelyCompleteQuestion(previous.text) && isLikelyCompleteQuestion(part.text)) &&
      (!isLikelyCompleteQuestion(previous.text) || !isLikelyCompleteQuestion(part.text) || continuesQuestion(previous.text, part.text));
    if (sameScene) {
      previous.text += '\n' + part.text;
      previous.partIds.push(id);
    } else groups.push({ id, text: part.text, answered, canMark: !!part.final, partIds: [id] });
  }
  return groups;
}

// Full current questions take priority over optional context budgets. Real model
// window handling belongs to request budgeting, not silent speech truncation.
function clipQuestion(text) { return text; }

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
  if(/^(?:how|why|what|which|where|when|could|would|can)(?:\s+(?:do|does|did|would|can|could|should|is|are|will|you|we|it|the|a|an|to|of|about))*$/i.test(text))return true;
  if(text.split(/\s+/).length<=5&&/^(?:how|why|could|would|can)\b/i.test(text)&&/\b(?:use|prevent|implement|design|handle|explain|describe|compare|build|return|duplicate)\s*$/i.test(text))return true;

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
  if (isCorrection(text)) return true;
  if (/[呢吗][。.!！]*$/.test(text) && body.length >= 3) return true;
  if (isCodeChangeRequest(text) || IMPLEMENTATION_REQUEST_RE.test(text)) return true;
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
  return classifyCandidateUtterance(value) === 'substantive';
}

function classifyCandidateUtterance(value, { uncertain = false } = {}) {
  if (uncertain) return 'uncertain';
  const spoken = compact(value).toLowerCase();
  if (!spoken) return 'empty';
  if (/^(?:我想一下|让我想想|稍等|这个我了解|那我先说一下)$/.test(spoken)) return 'thinking';
  if (/^(?:嗯哼|嗯嗯|嗯|啊|哦|噢|好的|好|明白了|明白|对的|对|是的|是|了解了|了解|没错|可以|没问题|行|收到|知道了|懂了|okay|ok|right|yes|uh|hmm)+$/.test(spoken)) return 'acknowledgement';
  return 'substantive';
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
      ((changesTechnicalSubject(a, b) && compact(a).length < 12) || /^(?:为什么|怎么|如何|什么|哪些|是否|是不是|能不能|有没有|会不会|要不要|请|介绍|讲讲|解释|what\b|why\b|how\b|can\b|could\b|would\b)/i.test(b) &&
        !continuesQuestion(a, b) && !(compact(a).length >= 12 && !isLikelyCompleteQuestion(a)) && !(compact(a).length >= 8 && (CONTEXT_PREAMBLE_RE.test(a) || PREMISE_RE.test(a))))) {
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
  constructor({ newQuestionGapMs = DEFAULT_NEW_QUESTION_GAP_MS,
    lateFinalGraceMs = DEFAULT_LATE_FINAL_GRACE_MS, now = Date.now } = {}) {
    this.newQuestionGapMs = Math.max(800, Number(newQuestionGapMs) || DEFAULT_NEW_QUESTION_GAP_MS);
    this.lateFinalGraceMs = Math.max(500, Number(lateFinalGraceMs) || DEFAULT_LATE_FINAL_GRACE_MS);
    this.now = now;
    this._id = 0; this.epoch = 0;
    this.reset();
  }

  reset({ epoch } = {}) {
    this.epoch = Number.isFinite(epoch) ? epoch : this.epoch + 1;
    this.stableParts = []; this.pendingText = ''; this.pendingUnits = []; this.pendingAt = 0; this.pendingRelated = false;
    this.interim = null; this.speaking = false; this.awaitingText = false; this.awaitingNewQuestion = false;
    this.lastSpeechEndAt = 0; this.lastFinalAt = 0; this.boundary = null; this.hasSpeechState = false;
    this.revision = 0; this.lastSubmitted = null; this.currentQuestionId = ''; this.referenceContext = '';
    this.eventSequence = 0; this.events = new Map(); this.sourceSessions = new Map(); this.retiredSessions = new Set();
    this.highWater = new Map(); this.claims = new Map(); this.lastRetryable = null; this.reason = 'no-current-question';
    this.answeredParts = new Map();
    this.retiredKeys = new Set(); this.retiredWatermarks = new Map(); this.candidateActivity = ''; this.lastHandledText = ''; this.autoClose = null;
  }

  _clearActive(reason = 'no-current-question') {
    this.stableParts = []; this.pendingText = ''; this.pendingUnits = []; this.pendingAt = 0; this.pendingRelated = false;
    this.interim = null; this.awaitingText = false; this.awaitingNewQuestion = false;
    this.boundary = null; this.currentQuestionId = ''; this.referenceContext = ''; this.reason = reason; this.revision++;
    this.answeredParts.clear();
  }
  _identity() { return this.currentQuestionId || (this.currentQuestionId = `q${this.epoch}-${++this._id}`); }
  _touch(reason) { this._identity(); this.revision++; this.reason = reason; }
  _activeText() { return this.stableParts.map(part => part.text).join('\n') || this.interim?.text || ''; }
  _prune(now) {
    for (const [key, record] of this.events) if (now - record.at > 120000) this.events.delete(key);
    while (this.events.size > 80) this.events.delete(this.events.keys().next().value);
    while (this.highWater.size > 16) this.highWater.delete(this.highWater.keys().next().value);
    while (this.sourceSessions.size > 16) this.sourceSessions.delete(this.sourceSessions.keys().next().value);
    while (this.retiredSessions.size > 32) this.retiredSessions.delete(this.retiredSessions.values().next().value);
    while (this.claims.size > 8) this.claims.delete(this.claims.keys().next().value);
  }

  speechState(data = {}) {
    if (data.channel !== 'them') return;
    const now = this.now(); this.hasSpeechState = true; this.speaking = !!data.speaking;
    if (!data.speaking) { this.lastSpeechEndAt = Number(data.speechEndedAt) || now; return; }
    const at = Number(data.speechStartedAt) || now;
    this.boundary = { at, gapMs: this.lastSpeechEndAt ? Math.max(0, at - this.lastSpeechEndAt) : 0 };
    this.awaitingText = true;
  }

  _eventMeta(data, final, raw) {
    const now = this.now(); this._prune(now);
    const source = String(data.sourceId || 'stream');
    const session = String(data.sourceSessionId ?? data.sourceSession ?? data.sessionId ?? data.streamSessionId ?? '');
    const sourceKey = session ? `${source}@${session}` : source;
    if (session) {
      const retired = `${source}@${session}`;
      if (this.retiredSessions.has(retired)) return null;
      const previous = this.sourceSessions.get(source);
      if (previous && previous !== session) {
        this.retiredSessions.add(`${source}@${previous}`);
      }
      this.sourceSessions.set(source, session);
    }
    const order = Number.isFinite(data.utteranceOrder) ? data.utteranceOrder : undefined;
    const local = data.utteranceKey != null ? String(data.utteranceKey) : order !== undefined ? String(order) : '';
    const key = local ? `${sourceKey}:${local}` : '';
    if (key && this.retiredKeys.has(key)) return null;
    if (order !== undefined && order <= (this.retiredWatermarks.get(sourceKey) ?? -Infinity)) return null;
    const previous = key ? this.events.get(key) : null;
    const version = Number.isFinite(data.utteranceRevision) ? data.utteranceRevision
      : Number.isFinite(data.revision) ? data.revision : Number.isFinite(data.eventRevision) ? data.eventRevision : undefined;
    if (previous) {
      if (version !== undefined && previous.version !== undefined &&
          (version < previous.version || version === previous.version && previous.final)) return null;
      if (previous.retiredByManual && previous.text === raw) return null;
      if (previous.text === raw && (previous.final || !final)) return null;
      if (previous.final && !final && (version === undefined || previous.version !== undefined && version <= previous.version)) return null;
    }
    const activeKey = key && (this.stableParts.some(part => part.key === key) || this.pendingUnits.some(part => part.key === key) || this.interim?.key === key);
    const high = this.highWater.get(sourceKey);
    if (order !== undefined && high !== undefined && order < high && !activeKey) return null;
    // Missing upstream order cannot establish global chronology. A known older
    // utterance from this source may finish late, but cannot replace a newer one.
    if (order === undefined && previous && !activeKey && [...this.events.values()].some(record =>
      record.sourceKey === sourceKey && record.firstSequence > previous.firstSequence)) return null;
    if (order !== undefined) this.highWater.set(sourceKey, Math.max(high ?? order, order));
    const sequence = ++this.eventSequence;
    const meta = { key, at: now, source, sourceKey, session, order, version, final, text: raw, sequence,
      startMs:data.startMs, endMs:data.endMs, clockDomain:data.clockDomain,
      firstSequence: previous?.firstSequence ?? sequence };
    if (key) this.events.set(key, meta);
    return meta;
  }

  _isLateSubmittedDuplicate(text, meta) {
    const previous = this.lastSubmitted;
    if (!previous || this.now() - previous.at > this.lateFinalGraceMs) return false;
    if (meta.key) return previous.sourceKeys.includes(meta.key) && previous.text === text;
    return !this.boundary && overlapsEnough(text, previous.text);
  }

  _appendStable(text, meta) {
    const part = { ...meta, text: clean(text), at: meta.at, key: meta.key || '', source: meta.source,
      sourceOrder: meta.order, sequence: meta.sequence };
    const same = part.key ? this.stableParts.findIndex(item => item.key === part.key) : -1;
    if (same >= 0) this.stableParts[same] = part;
    else {
      const last = this.stableParts.at(-1);
      if (last && !part.key && overlapsEnough(last.text, part.text)) this.stableParts[this.stableParts.length - 1] = part;
      else this.stableParts.push(part);
    }
    // Bound the number of ASR units, preserving the complete text of each unit.
    // No question text or constraints are clipped to meet a token target.
    this.stableParts.sort((a,b)=>a.sourceKey === b.sourceKey && a.order !== undefined && b.order !== undefined ? a.order-b.order : a.firstSequence-b.firstSequence);
    this._touch('final');
  }

  observe(data = {}, final = false) {
    const raw = clean(data.text);
    if (data.channel === 'you') {
      this.candidateActivity = classifyCandidateUtterance(raw, { uncertain: !!data.possibleEchoOf || data.speaker === 'unknown' });
      if (final && this.candidateActivity === 'substantive' && !data.echoOf && !data.possibleEchoOf && !this.speaking && this.stableParts.length) {
        const current = this.resolveForSubmit();
        const questionGroups = current.segments.filter(part => !part.answered && isLikelyCompleteQuestion(part.text));
        const last = this.stableParts.at(-1);
        const overlapping = data.clockDomain && last.clockDomain === data.clockDomain && Number.isFinite(data.startMs) && Number.isFinite(last.endMs) && data.startMs <= last.endMs;
        if (!overlapping && questionGroups.length === 1 && !current.pendingText && candidateAddressesQuestion(questionGroups[0].text, raw)) {
          const before = { eventId:data.eventId, questionId:this.currentQuestionId, stableParts:[...this.stableParts],
            answeredParts:new Map(this.answeredParts), retiredKeys:new Set(this.retiredKeys), retiredWatermarks:new Map(this.retiredWatermarks), lastHandledText:this.lastHandledText };
          this.retireActive('candidate-answer-started');
          this.autoClose = data.eventId ? before : null;
        }
      }
      return;
    }
    if (data.channel !== 'them' || !raw || isSpeechNoise(raw)) return;
    if (/^(?:喂|哈喽|hello|hi|嗯|啊|哦|好|可以|好的|行|测试|收到|开始吧|我们开始吧)+$/i.test(compact(raw))) return;
    if (/(?:听得?(?:到|清)|听不(?:到|清)|声音|音量|麦克风)/.test(raw) && /(?:喂|听|声音|音量|麦克风)/.test(raw) && !/(?:介绍|项目|技术|代码|设计|实现|架构|为什么|如何|怎么做|举个例子)/.test(raw)) return;
    const meta = this._eventMeta(data, final, raw);
    if (!meta) return;
    const samePart = meta.key && this.stableParts.find(part => part.key === meta.key);
    const sameInterim = meta.key && this.interim?.key === meta.key;
    const correction = isCorrection(raw), announced = NEW_TOPIC_RE.test(raw) || SWITCH_RE.test(raw);
    let text = announced && !correction ? stripSwitchPrefix(raw) : raw;
    if (final && (this.lastHandledText || this.lastSubmitted?.text) && /^(?:为什么|为何|代价呢|举个例子)[。.!！]*$/.test(text)) text += '？';
    const trailing = splitTrailingIncompleteClause(text);
    const trailingPending = trailing?.pendingText || '';
    if (trailing) text = trailing.completeText;
    const previousText = this.stableParts.map(part => part.text).join('\n');
    if (!previousText && REFERENTIAL_RE.test(text) && this.lastSubmitted?.text) this.referenceContext = this.lastSubmitted.text.slice(0, 1000);
    let related = !!samePart || !!sameInterim || !!previousText && (continuesQuestion(previousText, text) ||
      !correction && !announced && hasOpenScene(this.stableParts, this.lastSubmitted, this.currentQuestionId, meta.at));
    let complete = isLikelyCompleteQuestion(text);
    const pendingContext = this.pendingText && !this.awaitingNewQuestion && !correction && !announced &&
      mergeFragment(this.pendingText, text) ? { text: this.pendingText, related: this.pendingRelated, at: this.pendingAt } : null;
    if (pendingContext?.related) related = true;
    const newPendingTarget=complete&&this.pendingText&&!this.pendingRelated&&!sameInterim&&!related&&mergeFragment(this.pendingText,text)===null;
    const newTarget = newPendingTarget || !samePart && !sameInterim && (correction || announced) || complete && (previousText || this.interim?.text) && !related && !sameInterim;
    const newInterimTarget = !final && complete && this.interim && !sameInterim && !related;
    if (newTarget || newInterimTarget) {
      const reference = REFERENTIAL_RE.test(text) ? previousText || this.interim?.text || '' : '';
      this._clearActive(correction ? 'correction' : announced ? 'new-question-announced' : 'latest-independent-question');
      this.referenceContext = reference.slice(0, 1000);
      if (pendingContext) { this.pendingText = pendingContext.text; this.pendingAt = pendingContext.at; this.pendingRelated = pendingContext.related; }
      related = false;
    }
    if (announced && !complete) {
      this.pendingText = text; this.pendingAt = meta.at; this.pendingSequence = meta.sequence; this.pendingRelated = false;
      this.awaitingNewQuestion = true; this.awaitingText = false;
      this._touch('awaiting-new-question');
      if (!final) this.interim = { ...meta, text };
      return;
    }
    if (!final) {
      // A draft has an identity before it becomes answerable. An unrelated new
      // incomplete draft blocks submission of the previous question.
      if (!complete && previousText && !related && !samePart && !sameInterim) related = true;
      this.interim = { ...meta, text, pendingText: trailingPending, related, correction };
      this.awaitingText = false;
      this._touch(complete ? correction ? 'interim-correction' : 'meaningful-interim' : 'incomplete-fragment');
      if (complete) this.awaitingNewQuestion = false;
      return;
    }
    // A confirmed revision replaces the original unit, even when shorter. It
    // must not be appended to its old text or rejected because its key was seen.
    if (samePart && !newTarget) {
      this._appendStable(text, meta);
      this.pendingText = trailingPending; this.pendingAt = trailingPending ? meta.at : 0; this.pendingSequence = meta.sequence;
      this.pendingRelated = !!trailingPending;
      if (sameInterim) this.interim = null;
      this.awaitingNewQuestion = false; this.awaitingText = false; this.boundary = null; this.lastFinalAt = meta.at;
      this.reason = 'final-revision';
      return;
    }
    if (this.pendingText && !this.awaitingNewQuestion && !correction) {
      const merged = mergeFragment(this.pendingText, text);
      if (merged && complete) {
        for (const unit of this.pendingUnits) this._appendStable(unit.text, unit);
        this.pendingUnits = []; related = true;
        this.pendingText = ''; this.pendingAt = 0; this.pendingRelated = false;
      } else if (!merged && isLikelyCompleteQuestion(text)) {
        if (related) for (const unit of this.pendingUnits) this._appendStable(unit.text, unit);
        this.pendingText = ''; this.pendingUnits = []; this.pendingAt = 0; this.pendingRelated = false;
      }
    } else if (this.awaitingNewQuestion && complete) {
      this.pendingText = ''; this.pendingAt = 0; this.awaitingNewQuestion = false;
    }
    const relatedConstraint = this.stableParts.length && !isLikelyIncompleteFragment(text) &&
      (related || continuesQuestion(this.stableParts.map(part => part.text).join('\n'), text));
    if (isLikelyCompleteQuestion(text) || isLikelySupplement(text) && this.stableParts.length || relatedConstraint) {
      if (this.stableParts.length && !related && !isLikelySupplement(text) && !relatedConstraint && !samePart) {
        this._clearActive('latest-independent-question');
      }
      this._appendStable(text, meta);
      this.pendingText = trailingPending; this.pendingAt = trailingPending ? meta.at : 0; this.pendingSequence = meta.sequence; this.pendingRelated = !!trailingPending;
      this.interim = null; this.awaitingText = false; this.awaitingNewQuestion = false;
      this.boundary = null; this.lastFinalAt = meta.at;
      if (correction) this.reason = 'correction';
      return;
    }
    const existingPending = meta.key && this.pendingUnits.findIndex(p => p.key === meta.key);
    if (existingPending !== false && existingPending >= 0) this.pendingUnits[existingPending] = {...meta, text};
    else this.pendingUnits.push({...meta, text});
    this.pendingUnits.sort((a,b)=>a.sourceKey === b.sourceKey && a.order !== undefined && b.order !== undefined ? a.order-b.order : a.firstSequence-b.firstSequence);
    this.pendingText = this.pendingUnits.map(p=>p.text).join('\n'); this.pendingAt = meta.at; this.pendingSequence = meta.sequence;
    this.pendingRelated = !!this.stableParts.length && (related || CONDITION_START_RE.test(text) || isLikelySupplement(text));
    this.interim = null; this.awaitingText = false; this.lastFinalAt = meta.at;
    this._touch('incomplete-fragment');
  }

  _snapshot(values) {
    const sourceKeys = Object.freeze([...new Set(values.sourceKeys || [])]);
    const snapshot = { asrFinal:values.source==='manual'?null:values.source==='final'&&!!values.text,
      semanticStatus:values.text?'answerable':'incomplete',completePrefix:values.text||'',pendingTail:values.pendingText||'',
      ...values, sourceKeys, parts: Object.freeze([...(values.parts || [])]) };
    Object.defineProperty(snapshot, 'keys', { enumerable: true, get: () => new Set(sourceKeys) });
    return Object.freeze(snapshot);
  }
  markAnswered({ questionId, partId, text, answered }) {
    if (questionId !== this.currentQuestionId || typeof answered !== 'boolean') throw new Error('问题已更新，请重新确认');
    const group = groupCoverage(this.stableParts, this.answeredParts).find(p => p.id === partId && p.text === text && p.canMark);
    if (!group) throw new Error('该发言已更新，请重新确认');
    for (const id of group.partIds) {
      const part = this.stableParts.find(p => (p.key || `sequence:${p.sequence}`) === id);
      if (answered) this.answeredParts.set(id, part.text); else this.answeredParts.delete(id);
    }
    this._touch('answer-coverage-changed');
  }
  retireActive(reason = 'manual-clear') {
    this.lastHandledText = this.resolveForSubmit().text || this.lastHandledText;
    if (reason === 'manual-clear') { this.candidateActivity = ''; this.autoClose = null; }
    for (const [key] of this.events) this.retiredKeys.add(key);
    for (const [sourceKey, order] of this.highWater) this.retiredWatermarks.set(sourceKey, Math.max(this.retiredWatermarks.get(sourceKey) ?? -Infinity, order));
    for (const part of [...this.stableParts, ...this.pendingUnits, ...(this.interim ? [this.interim] : [])]) {
      if (part.key) this.retiredKeys.add(part.key);
      if (part.sourceKey && Number.isFinite(part.order)) this.retiredWatermarks.set(part.sourceKey, Math.max(this.retiredWatermarks.get(part.sourceKey) ?? -Infinity, part.order));
    }
    while (this.retiredKeys.size > 500) this.retiredKeys.delete(this.retiredKeys.values().next().value);
    this._clearActive(reason);
  }
  retractCandidateClose(eventId) {
    const previous=this.autoClose;
    if (!previous || !eventId || previous.eventId !== eventId || this.currentQuestionId || this.interim || this.pendingText) return false;
    this.stableParts=previous.stableParts; this.answeredParts=previous.answeredParts;
    this.retiredKeys=previous.retiredKeys; this.retiredWatermarks=previous.retiredWatermarks;
    this.lastHandledText=previous.lastHandledText; this.currentQuestionId=previous.questionId;
    this.autoClose=null; this.candidateActivity='uncertain'; this.revision++; this.reason='candidate-uncertain';
    return true;
  }
  previewForPrefetch(options = {}) { return this.resolveForSubmit({ ...options, allowPartial: true }); }
  resolveForSubmit({ allowPartial = false, epoch = this.epoch } = {}) {
    let selected = [...this.stableParts];
    let text = selected.map(part => part.text).join('\n');
    let provisional = false;
    const interimText = clean(this.interim?.text);
    let pendingText = this.pendingText || this.interim?.pendingText || '';
    if (interimText && !isSpeechNoise(interimText) && !this.awaitingNewQuestion) {
      let candidate = interimText;
      let related = this.interim.related;
      if (this.pendingText) {
        const merged = mergeFragment(this.pendingText, candidate);
        if (merged) { selected.push(...this.pendingUnits); text = selected.map(part => part.text).join('\n'); related = true; }
      }
      if (isLikelyCompleteQuestion(candidate) || isLikelySupplement(candidate) && !isLikelyIncompleteFragment(candidate) && text) {
        const same = this.interim.key ? selected.findIndex(part => part.key === this.interim.key) : -1;
        if (same >= 0) selected[same] = { ...this.interim, text: candidate };
        else if (!text || related || continuesQuestion(text, candidate) || isLikelySupplement(candidate)) selected.push({ ...this.interim, text: candidate });
        else selected = [{ ...this.interim, text: candidate }];
        provisional = true; text = selected.map(part => part.text).join('\n');
        pendingText = this.interim.pendingText || '';
      } else if (!pendingText) pendingText = interimText;
    }
    if (this.awaitingNewQuestion) text = '';
    // allowPartial permits a meaningful latest interim, never a bare “如果” or
    // “另外一个问题”. No model request is a better result than reviving old text.
    const partial = provisional;
    const individualSegments = selected.map(part => {
      const id = part.key || `sequence:${part.sequence}`;
      return { id, text: part.text, answered: !!part.final && this.answeredParts.get(id) === part.text, canMark: !!part.final };
    });
    const segments = groupCoverage(selected, this.answeredParts);
    if (!this.awaitingNewQuestion && individualSegments.some(part => part.answered)) text = individualSegments.filter(part => !part.answered).map(part => part.text).join('\n');
    const at = selected.reduce((latest, part) => Math.max(latest, part.at || 0), 0) || this.pendingAt || 0;
    const sourceKeys = selected.flatMap(part => part.keys || [part.key]).filter(Boolean);
    return this._snapshot({ epoch, questionId: this.currentQuestionId || '', revision: this.revision,
      text, sourceKeys, sourceOrder: selected.at(-1)?.sourceOrder ?? selected.at(-1)?.order,
      observedAt: at, timeBase: 'wall', source: provisional ? 'interim' : 'final', status: text ? provisional ? 'partial' : 'ready' : 'partial',
      reason: this.awaitingNewQuestion ? 'awaiting-new-question' : text ? this.reason : pendingText ? 'incomplete-fragment' : 'no-current-question',
      referenceContext: undefined, pendingText, partial, provisional, asrFinal: text ? !provisional : !this.interim&&!!pendingText,
      semanticStatus: text ? 'answerable' : 'incomplete', completePrefix: text, pendingTail: pendingText,
      awaitingText: this.awaitingText, awaitingNewQuestion: this.awaitingNewQuestion,
      parts: segments.filter(part => !part.answered).map(part => part.text), segments, interimText,
      utterances:selected.map(part=>Object.freeze({key:part.key,sourceId:part.source,sourceSessionId:part.session,utteranceOrder:part.order,revision:part.version,isFinal:part.final})) });
  }

  manualSnapshot(value, { epoch = this.epoch } = {}) {
    const text = String(value || '').trim(), at = this.now();
    return this._snapshot({ epoch, questionId: `manual${epoch}-${++this._id}`, revision: 1, text,
      selectionSequence: this.eventSequence, sourceKeys: [], observedAt: at, timeBase: 'wall', source: 'manual', status: 'ready', reason: 'manual', partial: false,
      provisional: false, pendingText: '', parts: [text], interimText: '' });
  }
  _consume(snapshot) {
    // Submission is a request state transition, never deletion of the manual
    // target. Same-utterance final/revisions still replace the retained parts.
    this.lastSubmitted = { text: snapshot.text, at: this.now(), sourceKeys: [...(snapshot.sourceKeys || [])], questionId: snapshot.questionId, revision: snapshot.revision };
    return;
  }
  claim(snapshot, generationId) {
    if (!snapshot?.text || snapshot.epoch !== this.epoch) return null;
    const key = `${snapshot.epoch}:${snapshot.questionId}:${snapshot.revision}`;
    if (this.claims.has(key)) return null;
    const claimed = this._snapshot({ ...snapshot, status: 'claimed', generationId });
    this.claims.set(key, { snapshot: claimed, status: 'claimed' });
    if (snapshot.reason === 'manual') {
      const cutoff = snapshot.selectionSequence;
      this.stableParts = this.stableParts.filter(part => part.sequence > cutoff);
      if (this.interim?.sequence <= cutoff) this.interim = null;
      if ((this.pendingSequence || 0) <= cutoff) { this.pendingText = ''; this.pendingAt = 0; this.awaitingNewQuestion = false; }
      for (const record of this.events.values()) if (record.sequence <= cutoff) record.retiredByManual = true;
      if (!this.stableParts.length && !this.interim) { this.currentQuestionId = ''; this.referenceContext = ''; this.reason = 'no-current-question'; }
      this.revision++;
    } else if (snapshot.reason !== 'retry') this._consume(snapshot);
    this._prune(this.now());
    return claimed;
  }
  settle(snapshot, outcome = 'completed') {
    if (!snapshot) return;
    const key = `${snapshot.epoch}:${snapshot.questionId}:${snapshot.revision}`;
    const owned = this.claims.get(key);
    if (!owned || owned.snapshot.generationId !== snapshot.generationId) return;
    owned.status = outcome;
    if (outcome === 'failed' || outcome === 'canceled') this.lastRetryable = owned.snapshot;
    else if (this.lastRetryable?.questionId === snapshot.questionId && this.lastRetryable?.revision === snapshot.revision) this.lastRetryable = null;
  }
  retrySnapshot(questionId) {
    const previous = questionId ? [...this.claims.values()].reverse().find(item => item.snapshot.questionId === questionId)?.snapshot
      : this.lastRetryable || [...this.claims.values()].reverse().find(item => item.status !== 'claimed')?.snapshot;
    if (!previous || previous.epoch !== this.epoch) return null;
    // A retry has a fresh request revision while retaining the explicit frozen
    // question identity, never pulling a new ASR target into the old task.
    return this._snapshot({ ...previous, status: 'ready', revision: ++this.revision, reason: 'retry', generationId: undefined });
  }
  markSubmitted(snapshot) {
    if (!snapshot?.text) return;
    if (snapshot.status === 'claimed') this.settle(snapshot, 'completed');
    else this._consume(snapshot);
  }
}

module.exports = {
  QuestionResolver, DEFAULT_NEW_QUESTION_GAP_MS, DEFAULT_LATE_FINAL_GRACE_MS,
  isLikelyIncompleteFragment, isLikelyCompleteQuestion, isCodeChangeRequest,
  isLikelySupplement, splitTrailingIncompleteClause, isSubstantiveCandidateSpeech, classifyCandidateUtterance
};
