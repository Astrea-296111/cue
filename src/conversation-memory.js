'use strict';

const { tokenize } = require('./project-search');
const { planProjectRetrieval, isLikelyFollowUp, sameProjectScopes } = require('./project-query');
const { planInterviewQuestion, stableId } = require('./interview-question-planner');
const { InterviewChecklist } = require('./interview-checklist');
const { ProjectInterviewState } = require('./project-interview-state');

const ANSWER_MODES = new Set(['ask', 'say', 'assist', 'technical', 'answerThis', 'leetcode']);
const INTERVIEW_MODES = new Set(['ask', 'say', 'assist', 'technical', 'answerThis']);
const REFERENTIAL_FOLLOWUP = /刚才|前面|上一个|回到|这段|这个解法|这道题|这个实现|第[一二三四五六七八九十\d]+|后[一二三四五六七八九十\d]+|你提到|你说的|这个|那个|继续|展开|为什么这样|怎么保证|what about|you mentioned|the second|the last/i;
const clean = value => String(value || '').trim();
const userMessage = entry => entry.spokenContext
  ? `候选人当时的实际发言（自述，可能有识别错误）：\n${entry.spokenContext}\n\n用户问题：${entry.question}`
  : entry.question;

function excerpt(text, limit) {
  text = clean(text);
  if (text.length <= limit) return text;
  const marker = '\n[中间内容已省略；此为历史摘录]\n';
  const room = Math.max(0, limit - marker.length);
  const head = Math.ceil(room * 0.65);
  return text.slice(0, head) + marker + text.slice(-(room - head));
}

function terms(text) { return new Set(tokenize(text, true)); }
function overlapTerms(documentTerms, queryTerms) {
  let score = 0;
  for (const term of queryTerms) if (documentTerms.has(term)) score++;
  return score;
}
function overlap(text, queryTerms) { return overlapTerms(terms(text), queryTerms); }

function selectRelevantText(text, query, limit = 2200) {
  text = clean(text);
  if (text.length <= limit) return text;
  const queryTerms = terms(query);
  const blocks = text.split(/\n\s*\n/).flatMap(block => {
    if (block.length <= 1400) return [block];
    const parts = [];
    for (let i = 0; i < block.length; i += 1000) parts.push(block.slice(i, i + 1000));
    return parts;
  });
  const ranked = blocks.map((text, index) => ({ text, index, score: overlap(text, queryTerms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let remaining = Math.max(0, limit - 24);
  for (const block of ranked) {
    if (remaining < 80) break;
    const part = excerpt(block.text, remaining);
    selected.push({ ...block, text: part });
    remaining -= part.length + 2;
  }
  return '[相关原文摘录，非完整资料]\n' + selected.sort((a, b) => a.index - b.index).map(b => b.text).join('\n\n');
}

function contextPolicy(mode, question, hasHistory, plan = null) {
  if (plan?.projectSwitched) return 'project-switch';
  if (mode === 'recap' || mode === 'followup') return 'broad';
  if (!hasHistory) return 'independent';
  // A positively detected topic exit must not drag the previous project answer
  // into the new prompt just because the sentence starts with ‘为什么/怎么’.
  if (plan?.reason === 'topic-exit') return 'independent';
  if (REFERENTIAL_FOLLOWUP.test(clean(question))) return 'referential';
  // Project identity is maintained separately from lexical follow-up wording.
  // A question such as ‘100%恢复率牺牲了什么’ can still be a TCS drill-down
  // even though it contains no pronoun like ‘这个项目’. Keep one recent pair
  // when the project router says the active project is being continued.
  if (plan?.reason === 'active-project-followup' || plan?.reason === 'project-followup') return 'followup';
  if (!isLikelyFollowUp(question)) return 'independent';
  return 'followup';
}

class ConversationMemory {
  constructor() { this.epoch = 0; this.reset(); }

  reset() {
    this.epoch++;
    this.recent = [];
    this.archive = [];
    this.lastPlan = null;
    this.activeProjectPlan = null;
    this.lastStartedAt = 0;
    this.sequence = 0;
    this.searchTerms = new WeakMap();
    this.checklist = new InterviewChecklist();
    this.projectInterviewStates = new Map();
    this.lastCommittedId = 0;
  }

  begin({ mode, question, transcript = [], settings = {}, catalog = [], interviewPlan = null, evidenceRevision = null }) {
    const startedAt = Date.now();
    const current = clean(question);
    const newerSpeech = transcript.filter(t => t.channel === 'them' && t.ts > this.lastStartedAt);
    const routeTurns = newerSpeech.slice();
    if (current && clean(routeTurns.at(-1)?.text) !== current) routeTurns.push({ channel: 'them', text: current });
    const plan = planProjectRetrieval(routeTurns, mode, {
      previousPlan: this.lastPlan,
      activeProjectPlan: this.activeProjectPlan,
      catalog,
      manualProjectId: settings.currentProjectId || '',
      interviewPlan,
      answerHint: this.recent.at(-1)?.answer || ''
    });
    const policy = contextPolicy(mode, current, this.recent.length + this.archive.length > 0, plan);
    const configured = Number(settings.conversationContextChars);
    const isolated = policy === 'independent' || policy === 'project-switch';
    const defaultBudget = isolated ? 0
      : policy === 'followup' ? (settings.smart ? 9000 : 6000)
        : policy === 'referential' ? (settings.smart ? 14000 : 9000)
          : (settings.smart ? 32000 : 20000);
    const budget = isolated ? 0
      : Number.isFinite(configured) && configured >= 4000
        ? Math.min(48000, Math.floor(configured), Math.max(defaultBudget, 4000))
        : defaultBudget;
    const snapshot = this.buildHistory(current, plan, budget, policy);
    const spokenContext = plan.projectSwitched ? '' : excerpt(transcript.filter(t => t.channel === 'you' && t.ts > this.lastStartedAt)
      .map(t => clean(t.text)).filter(Boolean).join('\n'), 1400);
    const request = { epoch: this.epoch, id: ++this.sequence, startedAt, mode, question: current,
      plan, policy, spokenContext, ...snapshot,
      interviewPlan: interviewPlan || planInterviewQuestion({ text: current, mode }),
      evidenceRevision, manualFingerprint: stableId(settings.projectKnowledge || '') };
    if (INTERVIEW_MODES.has(mode) && current) {
      request.checklist = this.checklist.begin(request);
      const projectState = this._projectState(plan);
      if (projectState) {
        projectState.setSourceRevision(evidenceRevision, request.manualFingerprint);
        request.projectInterviewState = projectState.snapshot(request.checklist);
      } else request.projectInterviewState = null;
    } else {
      request.checklist = null;
      request.projectInterviewState = null;
    }
    return request;
  }

  buildHistory(question, plan, budget, policy = 'independent') {
    // Critical realtime rule: an independent question gets zero previous assistant
    // answers. This prevents answer inertia/error propagation and trims TTFT.
    if (policy === 'independent' || policy === 'project-switch' || budget <= 0) {
      return { turns: [], memory: '', stats: { policy, recentPairs: 0, recalledPairs: 0,
        storedPairs: this.recent.length + this.archive.length, historyChars: 0, budget: 0 } };
    }

    const maxRecent = policy === 'followup' || policy === 'referential' ? 3 : 10;
    const historyBudget = Math.floor(budget * (policy === 'broad' ? 0.72 : 0.82));
    let used = 0;
    const chosen = [];
    // Keep project follow-ups inside their identity even after an explicit switch
    // or a generic technical interlude. Retain all entries for broad recap modes.
    const sameThread = entry => policy === 'broad' || (plan.retrieve
      ? plan.scopes?.length ? entry.plan?.retrieve && sameProjectScopes(plan.scopes, entry.plan.scopes)
        : entry.plan?.retrieve && !entry.plan.scopes?.length && entry.plan.projectLabel === plan.projectLabel
      : !entry.plan?.retrieve);
    for (let i = this.recent.length - 1; i >= 0 && chosen.length < maxRecent; i--) {
      const entry = this.recent[i];
      if (!sameThread(entry)) continue;
      const size = userMessage(entry).length + entry.answer.length;
      if (size + used > historyBudget) {
        if (!chosen.length && historyBudget > 200) {
          const q = excerpt(userMessage(entry), Math.min(1800, Math.floor(historyBudget / 3)));
          chosen.unshift({ ...entry, question: q, spokenContext: '', answer: excerpt(entry.answer, Math.max(0, historyBudget - q.length)) });
          used = historyBudget;
        }
        break;
      }
      chosen.unshift(entry);
      used += size;
    }
    const turns = chosen.flatMap(entry => [
      { role: 'user', text: userMessage(entry) },
      { role: 'assistant', text: entry.answer }
    ]);

    if (policy === 'followup') {
      return { turns, memory: '', stats: { policy, recentPairs: chosen.length, recalledPairs: 0,
        storedPairs: this.recent.length + this.archive.length, historyChars: used, budget } };
    }

    const ids = new Set(chosen.map(e => e.id));
    const older = [...this.archive, ...this.recent.filter(e => !ids.has(e.id))].filter(sameThread);
    const query = `${question}\n${plan.anchor || ''}`;
    const qTerms = terms(query);
    const ranked = older.map(e => {
      let indexed = this.searchTerms.get(e);
      if (!indexed) {
        indexed = { question: terms(userMessage(e)), answer: terms(excerpt(e.answer, 5000)) };
        this.searchTerms.set(e, indexed);
      }
      return { entry: e, score: overlapTerms(indexed.question, qTerms) * 3 + overlapTerms(indexed.answer, qTerms) +
        (plan.retrieve && e.plan?.anchor === plan.anchor ? 8 : 0) };
    }).sort((a, b) => b.score - a.score || b.entry.id - a.entry.id);

    const blocks = [];
    let remaining = Math.max(0, budget - used);
    const heading = '=== 更早问答摘录（仅用于消解明确指代；助手旧答案不是项目事实） ===\n';
    remaining -= heading.length;
    const recallLimit = policy === 'referential' ? 3 : 6;
    for (const { entry, score } of ranked.slice(0, recallLimit)) {
      if (remaining < 180 || score <= 0) break;
      const label = `\n[历史轮次 ${entry.id}] ${excerpt(userMessage(entry), 700)}\n助手当时回答：`;
      if (label.length + 80 > remaining) continue;
      const body = selectRelevantText(entry.answer, query, Math.min(1200, remaining - label.length - 2));
      blocks.push({ id: entry.id, text: label + body });
      remaining -= label.length + body.length + 2;
    }
    const memory = blocks.length ? heading + blocks.sort((a, b) => a.id - b.id).map(b => b.text).join('\n\n') : '';
    return { turns, memory, stats: { policy, recentPairs: chosen.length, recalledPairs: blocks.length,
      storedPairs: this.recent.length + this.archive.length, historyChars: used + memory.length, budget } };
  }

  commit(request, answer, { completion, evidence } = {}) {
    if (request.epoch !== this.epoch || !ANSWER_MODES.has(request.mode) || !clean(answer)) return false;
    // The main runner owns generation/abort checks; also reject stale or duplicate
    // direct callers so an old same-epoch answer cannot roll back project state.
    if (request.id !== this.sequence || request.id <= this.lastCommittedId) return false;
    if (['say', 'technical'].includes(request.mode) && !clean(request.question)) return false;
    this.lastCommittedId = request.id;
    this.checklist.commit(request, answer, completion);
    const checklist = this.checklist.snapshot(request);
    const projectState = this._projectState(request.plan);
    if (projectState) {
      projectState.setSourceRevision(request.evidenceRevision, request.manualFingerprint);
      projectState.commit({ ...request, checklist }, evidence);
    }
    this.recent.push({ id: request.id, question: excerpt(request.question || '请解决当前屏幕上的题目（原始截图未保留）', 8000),
      spokenContext: request.spokenContext, answer: excerpt(answer, 48000), plan: request.plan,
      checklist: checklist ? { ...checklist, questions: checklist.questions.map(item => ({ ...item, text: excerpt(item.text, 500) })),
        pending: checklist.pending.map(item => ({ ...item, text: excerpt(item.text, 500) })) } : null });
    this.lastPlan = request.plan;
    this.activeProjectPlan = request.plan?.activeProject
      ? { ...request.plan.activeProject, scopes: [...(request.plan.activeProject.scopes || [])] }
      : null;
    this.lastStartedAt = request.startedAt;
    let size = this.recent.reduce((n, e) => n + userMessage(e).length + e.answer.length, 0);
    while (this.recent.length > 24 || (size > 240000 && this.recent.length > 1)) {
      const old = this.recent.shift();
      size -= userMessage(old).length + old.answer.length;
      this.archive.push({ ...old, checklist: null, question: excerpt(old.question, 800), spokenContext: excerpt(old.spokenContext, 900), answer: excerpt(old.answer, 2400) });
    }
    while (this.archive.length > 240) this.archive.shift();
    return true;
  }

  _projectState(plan) {
    // Ambiguous and comparison requests do not merge facts into one project.
    if (!plan?.retrieve || plan.scopes?.length !== 1 || !plan.scopes[0]) return null;
    const scope = plan.scopes[0];
    let state = this.projectInterviewStates.get(scope);
    if (!state) state = new ProjectInterviewState({ project: plan.projectLabel || plan.activeProject?.label || scope, scopes: [scope] });
    this.projectInterviewStates.delete(scope);
    this.projectInterviewStates.set(scope, state);
    while (this.projectInterviewStates.size > 12) this.projectInterviewStates.delete(this.projectInterviewStates.keys().next().value);
    return state;
  }

  getInterviewState(scopes = this.activeProjectPlan?.scopes || []) {
    if (scopes.length !== 1) return null;
    return this.projectInterviewStates.get(scopes[0])?.snapshot() || null;
  }

  invalidateSources() {
    // Preserve user conversation, but no completed request or source reference
    // from an older import snapshot can be committed into the new snapshot.
    this.epoch++;
    this.projectInterviewStates.clear();
  }
}

module.exports = { ConversationMemory, selectRelevantText, excerpt, contextPolicy };
