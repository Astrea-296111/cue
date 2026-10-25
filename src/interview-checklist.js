'use strict';

const { isLikelyFollowUp } = require('./project-query');
const { stableId } = require('./interview-question-planner');

const MAX_QUESTIONS = 256;
const MAX_THREADS = 48;
const UNRESOLVED = new Set(['pending', 'unknown']);
const SKIP = /(?:换(?:个|一个|一道)问题|下一个问题|跳过|不用回答|不回答了|先不聊|暂时不聊)|\b(?:skip (?:this|that|the) question|next question|never mind|forget (?:this|that))\b/i;
const RETURN = /回到|刚才|前面|上一个|\b(?:return to|back to|earlier|previous)\b/i;
const REFUSAL = /不知道|不清楚|无法(?:判断|回答|确定)|信息不足|缺少.{0,12}(?:信息|条件|证据)|未提供|不能确定|\b(?:cannot answer|can't answer|do not know|don't know|insufficient|not enough information|unable to answer)\b/i;
const MECHANISM = /因为|考虑|所以|选择|采用|使用|通过|先|再|需要|避免|保证|降低|回源|降级|熔断|限流|备用|恢复|重建|切换|监控|告警|持久化|重试|拆分|扩容|扩展|分片|迁移|加|用|\b(?:because|choose|use|using|first|then|should|would|avoid|ensure|reduce|fallback|degrad\w*|recover\w*|replica|scale|partition\w*|rather than)\b|[{}=]/i;

function scopeKey(plan) {
  return plan?.retrieve && plan.scopes?.length
    ? `project:${[...plan.scopes].sort().join('|')}` : plan?.retrieve ? 'project:unresolved' : 'generic';
}

function copyEntry(entry, current = false) {
  return { id: entry.id, text: entry.text, status: entry.status, answered: entry.status === 'covered',
    current, partial: entry.partial, sourceKey: entry.sourceKey, intent: entry.intent,
    topics: [...entry.topics], evidenceNeeds: (entry.evidenceNeeds || []).map(need => ({ ...need })),
    ...(entry.answerEvidence ? { answerEvidence: entry.answerEvidence } : {}) };
}

function requestedPending(question, entries, previousRequestId) {
  // An unresolved coverage heuristic is bookkeeping, not a new instruction
  // from the interviewer. Reintroduce an old ask only when it is requested.
  const value = String(question || '').trim();
  const complete = /(?:补答|补上|答完|答全|答完整|回答完整|回答完|讲完|说完|讲完整).{0,20}(?:问题|遗漏|刚才|前面|之前|上次)|(?:问题|遗漏|刚才|前面|之前|上次).{0,20}(?:补答|补上|答完|答全|答完整|回答完整|回答完|讲完|说完|讲完整)|(?:漏答|没答|未回答|遗漏).{0,8}(?:问题|子问|部分)|(?:问题|子问|部分).{0,8}(?:未答|没答|没回答|未回答|漏答|遗漏)|(?:刚才|前面|之前).{0,20}(?:没答|没回答|漏答|未回答)|\b(?:unanswered|omitted|remaining|missed)\s+(?:questions?|points?|parts?)\b|\b(?:answer|cover|finish|complete).{0,32}(?:previous|earlier|both|all)\s+(?:questions?|points?|parts?)\b/i.test(value);
  const ordinal = value.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:个|道|小)?(?:问题|问|点|部分)/) ||
    value.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+(?:question|point|part)\b/i);
  if (ordinal) {
    // Mentioning an earlier question inside a new, specific question is a
    // reference, not a request to repeat its whole answer.
    const remainder=(value.slice(0,ordinal.index)+value.slice(ordinal.index+ordinal[0].length)).replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
    if(!complete&&!/^(?:(?:那|那么|还有|然后|刚才的?|前面的?|之前的?|上次的?|请|先|再|继续|接着|回答|答一下|答完整|答完|补答|补充|讲讲|说说|展开|解释|呢|的回答|的答案)|(?:whatabout|howabout|and|please|answer|finish|complete|continue|elaborate|expand))*$/.test(remainder))return [];
    const raw = ordinal[1].toLowerCase(), words = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
    const digits = '一二三四五六七八九';
    let number = /^\d/.test(raw) ? Number.parseInt(raw, 10) : words.indexOf(raw) + 1;
    if (!number) number = raw.includes('十') ? (raw[0] === '十' ? 1 : digits.indexOf(raw[0]) + 1) * 10 +
      (raw.endsWith('十') ? 0 : digits.indexOf(raw.at(-1)) + 1) : digits.indexOf(raw) + 1;
    return entries.filter(entry => entry.sourceIndex === number - 1).slice(-1);
  }
  if (complete) return entries;
  if (/^(?:继续|接着(?:说|讲)?|go on|continue|carry on)[。.!！?？]*$/i.test(value))
    return entries.filter(entry => entry.lastRequestedId === previousRequestId);
  return [];
}

function coverageEvidence(question, answer, index, total) {
  if (question.partial || !answer.trim()) return '';
  const numbered = answer.split(/^\s*(?:\d+[.)、]|#{1,6})\s+/m).map(s => s.trim()).filter(Boolean);
  const subjectTopics = question.topics.filter(topic => !['架构', '性能', '故障', '扩容', 'QPS', '订单'].includes(topic));
  // For a multi-question answer, one paragraph cannot be re-used to cover each
  // unrelated question. Independent numbered sections follow the supplied order.
  const candidates = total > 1 ? [numbered.length > 1 ? numbered[index] : subjectTopics.length ? answer : null] : [answer];
  for (const candidate of candidates) {
    if (!candidate || REFUSAL.test(candidate)) continue;
    const body = candidate.replace(question.text, '').replace(/[?？][^。.!！\n]*$/, '').trim();
    if (body.replace(/[\s\p{P}\p{S}]/gu, '').length < 12 || !MECHANISM.test(body)) continue;
    if (!subjectTopics.length && question.intent === 'explanation' && total > 1) continue;
    if (subjectTopics.length && !subjectTopics.some(topic => body.toLowerCase().includes(topic.toLowerCase()) ||
      (topic === '分库分表' && /分库|分表|\bshard\w*/i.test(body)) ||
      (topic === '缓存' && /\bcach\w*/i.test(body)) || (topic === '幂等' && /\bidempoten\w*/i.test(body)) ||
      (topic === 'Database' && /数据库/i.test(body)) || (topic === 'Schema' && /表结构/i.test(body)))) continue;
    if (question.intent === 'design' && !/扩容|扩展|分片|读写分离|拆分|批处理|异步|优化|索引|缓存|队列|无状态|负载均衡|分库|分表|\b(?:scal\w*|partition\w*|replica\w*|shard\w*|index\w*|cach\w*|asynchronous|batch\w*|load balanc\w*|stateless)\b/i.test(body)) continue;
    if (question.intent === 'failure' && !/回源|降级|熔断|限流|备用|恢复|重建|切换|持久化|重试|监控|告警|失败|故障|\b(?:fallback|degrad\w*|recover\w*|replica|retry|retries|monitor\w*|fail\w*|circuit)\b/i.test(body)) continue;
    if (question.intent === 'reason' || question.intent === 'tradeoff') {
      if (!/因为|考虑|原因|选择|代价|取舍|权衡|避免|所以|收益|开销|复杂|\b(?:because|reason|choose|trade.?off|cost|complex\w*|avoid|rather than)\b/i.test(body)) continue;
    }
    return body.slice(0, 260);
  }
  return '';
}

class InterviewChecklist {
  constructor({ maxQuestions = MAX_QUESTIONS, maxThreads = MAX_THREADS } = {}) {
    this.maxQuestions = maxQuestions;
    this.maxThreads = maxThreads;
    this.reset();
  }

  reset() {
    this.entries = new Map();
    this.threads = new Map();
    this.projectThreads = new Map();
    this.lastRequest = null;
    this.lastCommittedId = 0;
  }

  begin(request) {
    const { id, epoch, question, plan, interviewPlan } = request;
    const key = scopeKey(plan);
    const previous = this.lastRequest;
    if (SKIP.test(question) && previous) {
      for (const entry of this.entries.values()) {
        if (entry.threadId === previous.threadId && UNRESOLVED.has(entry.status)) entry.status = 'skipped';
      }
    }
    const topics = interviewPlan.subQuestions.flatMap(sub => sub.topics || []);
    const genericSubjectChange = key === 'generic' && previous?.scopeKey === key && topics.length && previous.topics?.length &&
      !topics.some(topic => previous.topics.includes(topic)) && !RETURN.test(question);
    const continuing = !SKIP.test(question) && !interviewPlan.scenario && plan?.reason !== 'topic-exit' &&
      !genericSubjectChange && (request.policy !== 'independent' || RETURN.test(question)) &&
      (isLikelyFollowUp(question) || ['active-project-followup', 'project-followup'].includes(plan?.reason));
    let threadId = continuing && previous?.scopeKey === key ? previous.threadId : null;
    if (!threadId && continuing && key.startsWith('project:') && RETURN.test(question)) {
      threadId = this.projectThreads.get(key) || null;
    }
    // Reliable source keys can revise a forced partial in the same scope even
    // when the eventual complete wording no longer looks like a follow-up.
    const sameSource = interviewPlan.sourceKey && [...this.entries.values()].find(entry =>
      entry.epoch === epoch && entry.scopeKey === key && entry.sourceKey === interviewPlan.sourceKey && entry.partial);
    if (sameSource && !SKIP.test(question)) threadId = sameSource.threadId;
    if (!threadId) threadId = `${epoch}:${id}:${stableId(key + question)}`;
    if (!this.threads.has(threadId)) this.threads.set(threadId, { scenario: interviewPlan.scenario || '', scopeKey: key });
    if (key.startsWith('project:') && key !== 'project:unresolved') this.projectThreads.set(key, threadId);
    const ids = [];
    for (const [index, sub] of interviewPlan.subQuestions.entries()) {
      const entryId = `${threadId}:${sub.id}`;
      let entry = this.entries.get(entryId);
      const oldPartial = sameSource && [...this.entries.values()].find(item => item.threadId === threadId &&
        item.sourceKey === interviewPlan.sourceKey && item.sourceIndex === index && item.partial);
      if (!entry && oldPartial) entry = oldPartial;
      if (!entry) {
        entry = { id: entryId, epoch, threadId, scopeKey: key, sourceIndex: index, status: 'pending' };
        this.entries.set(entry.id, entry);
      }
      Object.assign(entry, { text: sub.text, partial: !!interviewPlan.partial, sourceKey: interviewPlan.sourceKey,
        intent: sub.intent, topics: [...(sub.topics || [])], evidenceNeeds: (sub.evidenceNeeds || []).map(need => ({ ...need })), lastRequestedId: id });
      if (oldPartial && !interviewPlan.partial) { entry.status = 'pending'; delete entry.answerEvidence; }
      ids.push(entry.id);
    }
    this.lastRequest = { id, epoch, threadId, scopeKey: key, topics };
    this._prune();
    const current = ids.map(entryId => this.entries.get(entryId)).filter(Boolean);
    const candidates = [...this.entries.values()].filter(entry => request.mode !== 'assist' && entry.threadId === threadId && !ids.includes(entry.id) &&
      !entry.partial && UNRESOLVED.has(entry.status));
    const pending = requestedPending(question, candidates, previous?.id).slice(-8);
    // The request owns a stable snapshot; new speech cannot change its checklist.
    return { epoch, threadId, scenario: this.threads.get(threadId)?.scenario || '', scopes: [...(plan?.scopes || [])],
      questions: [...current.map(entry => copyEntry(entry, true)), ...pending.map(entry => copyEntry(entry))],
      pending: pending.map(entry => copyEntry(entry)), stats: this.stats() };
  }

  commit(request, answer, completion) {
    if (!request.checklist || request.id < this.lastCommittedId) return false;
    this.lastCommittedId = request.id;
    const provenComplete = completion?.complete === true && completion?.truncated !== true;
    const questions = request.checklist.questions;
    for (const [index, frozen] of questions.entries()) {
      const entry = this.entries.get(frozen.id);
      // A newer snapshot can refine a partial. Its old answer must not cover it.
      if (!entry || entry.epoch !== request.epoch || entry.lastRequestedId > request.id || entry.status === 'skipped') continue;
      const missingSource = request.unavailableEvidenceQuestionIds?.some(id => frozen.id === id || frozen.id.endsWith(':' + id));
      const evidence = provenComplete && !missingSource ? coverageEvidence(frozen, answer, index, questions.length) : '';
      if (evidence) { entry.status = 'covered'; entry.answerEvidence = evidence; }
      else if (entry.status !== 'covered') entry.status = 'unknown';
    }
    return true;
  }

  snapshot(request) {
    if (!request.checklist) return null;
    const questions = request.checklist.questions.map(frozen => {
      const entry = this.entries.get(frozen.id);
      return entry ? copyEntry(entry, frozen.current) : frozen;
    });
    return { ...request.checklist,
      questions, pending: questions.filter(question => !question.current && UNRESOLVED.has(question.status)), stats: this.stats() };
  }

  stats() {
    return { storedQuestions: this.entries.size, threadCount: this.threads.size,
      pendingQuestions: [...this.entries.values()].filter(entry => UNRESOLVED.has(entry.status)).length };
  }

  view({ threadId = this.lastRequest?.threadId } = {}) {
    return { threadId: threadId || null,
      questions: [...this.entries.values()].filter(entry => !threadId || entry.threadId === threadId).map(entry => copyEntry(entry)),
      stats: this.stats() };
  }

  _prune() {
    while (this.entries.size > this.maxQuestions) this.entries.delete(this.entries.keys().next().value);
    while (this.threads.size > this.maxThreads) {
      const oldest = this.threads.keys().next().value;
      this.threads.delete(oldest);
      for (const [id, entry] of this.entries) if (entry.threadId === oldest) this.entries.delete(id);
      for (const [key, id] of this.projectThreads) if (id === oldest) this.projectThreads.delete(key);
    }
  }
}

function formatInterviewChecklist(checklist, { maxChars = 1800, includeCurrent = true } = {}) {
  if (!checklist?.questions?.length || maxChars <= 0) return '';
  const heading = '=== 本轮问题清单（先回答当前新问，再补相关遗漏；覆盖指 Cue 建议，非候选人实际发言） ===';
  const relevant = checklist.questions.filter(q => q.current ? includeCurrent : UNRESOLVED.has(q.status));
  if (!relevant.length) return '';
  const lines = relevant.map((q, index) =>
    `${index + 1}. ${q.current ? '当前' : '此前未确认覆盖'}${q.partial ? '（发言未完整，不补全）' : ''}：${q.text}`);
  let output = heading;
  for (const line of lines) {
    if (output.length + line.length + 1 > maxChars) break;
    output += '\n' + line;
  }
  return output.slice(0, maxChars);
}

module.exports = { InterviewChecklist, formatInterviewChecklist, coverageEvidence };
