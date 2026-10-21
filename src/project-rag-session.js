'use strict';

const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { RETRIEVAL_POLICY, executionPolicy } = require('./project-prefetch-policy');
const sourceEvents = new EventEmitter();

const RETRIEVAL_CONFIG_VERSION = 'realtime-question-v2';
const NEED_LABELS = { context: '相关项目资料', implemented: '当前实现', implementation: '实现与源码', decision: '选型理由', constraints: '约束', challenge: '真实困难与行动', incident: '事件与处理依据', performance: '测试指标与口径', environment: '环境', ownership: '明确个人职责', collaboration: '协作分工', process: '流程', limitation: '实现边界', theory: '原理', general_knowledge: '通用原理', hypothetical: '假设与实际基础' };
function formatRetrievalRequirements(bundle, maxChars = 1400) {
  const rows = bundle.byQuestion || [];
  const heading = '=== 本轮各子问的资料需求与缺口（缺口不能由旧建议补成事实） ===';
  if (!rows.length) {
    const messages = (bundle.missing || []).map(item => item.message ||
      (item.reason === 'revision-changed' ? '资料快照已改变，本轮没有可用的旧来源。' : '本轮缺少相应资料。'));
    return messages.length ? heading + '\n' + [...new Set(messages)].join('\n').slice(0, Math.max(0, maxChars - heading.length - 1)) : '';
  }
  const lines = rows.map((row, index) => {
    const needs = [...new Set((row.evidenceNeeds || []).map(need => NEED_LABELS[need.type] || '相应证据'))];
    const gaps = [...new Set((row.missing || []).map(need => NEED_LABELS[need.type] || '相应证据'))];
    return `${index + 1}. 需要：${needs.join('、')}；${gaps.length ? '缺少：' + gaps.join('、') : '有对应来源，仍须遵守其事实范围'}。`;
  });
  let text = heading;
  for (const line of lines) {
    if (text.length + line.length + 1 > maxChars) { text += '\n其余子问资料需求未能展示，不视为已有充分依据。'; break; }
    text += '\n' + line;
  }
  return text;
}
function retrievalIdentity(input) {
  const plan = input.projectPlan || {};
  return createHash('sha256').update(JSON.stringify({
    epoch: input.epoch, scopes: [...(plan.scopes || [])].sort(),
    revision: input.projectRevision, modelVersion: input.modelVersion || 'base',
    question: String(input.question || ''), questionVersion: input.questionVersion || '',
    questionId: input.questionId || '', questionRevision: input.questionRevision ?? null,
    sourceKey: input.sourceKey || '', config: input.retrievalConfigVersion || RETRIEVAL_CONFIG_VERSION,
    needs: input.interviewPlan?.subQuestions || [], scenario: input.interviewPlan?.scenario || '',
    constraints: input.interviewPlan?.constraints || [], bindings: plan.subQuestionScopes || [],
    budget: input.contextBudget, hashFallback: input.hashFallback !== false, semanticThreshold: input.semanticThreshold ?? .70
  })).digest('hex');
}

// Guesses never mutate question selection, project state or answer coverage.
// Each project has one running task and only its newest pending replacement.
class ProjectRagSession {
  constructor({ retrieve, isCurrent = () => true, debounceMs,
    maxResults = 12, now = Date.now, onEvent = () => {}, onResult = () => {}, policy = RETRIEVAL_POLICY } = {}) {
    this.retrieve = retrieve;
    this.isCurrent = isCurrent;
    this.debounceMs = debounceMs ?? policy.interim.debounceMs;
    this.maxResults = maxResults;
    this.now = now;
    this.slots = new Map();
    this.results = new Map();
    this.sequence = 0;
    this.policy = policy; this.onEvent = onEvent; this.onResult = onResult;
    this.running = null; this.pending = null; this.predictions = []; this.generation = 0;
    this.firstPendingAt = null; this.lastStartedAt = -Infinity; this.timer = null;
    this.suspendedBy = null;
    this.metrics = { queued: 0, started: 0, completed: 0, canceled: 0, timedOut: 0, stale: 0 };
  }

  schedule(input, { immediate = false, origin = immediate ? 'final' : 'interim' } = {}) {
    if (!input.projectPlan?.retrieve || input.projectPlan.scopes?.length !== 1 || !input.question) return false;
    const key = retrievalIdentity(input);
    const project = input.projectPlan.scopes[0];
    if (this.running?.key === key || this.pending?.key === key || this.take(input)) return false;
    const old = this.running;
    if (old && (old.project !== project || old.origin === 'prediction' || this.corrected(old.question, input.question))) {
      this.cancelRunning('superseded');
    }
    if (old?.project !== project) this.predictions = [];
    if (origin === 'final') this.predictions = [];
    this.pending = { ...input, key, origin, project, sequence: ++this.sequence, generation: this.generation };
    this.slots.clear(); this.slots.set(project, true);
    this.firstPendingAt ??= this.now(); this.record('queued');
    clearTimeout(this.timer);
    const wait = immediate ? 0 : Math.max(0, Math.max(this.lastStartedAt + this.policy.interim.minIntervalMs,
      Math.min(this.now() + this.debounceMs, this.firstPendingAt + this.policy.interim.maxWaitMs)) - this.now());
    if (immediate && !this.running) this._run();
    else this.timer = setTimeout(() => this._run(), wait);
    return true;
  }

  corrected(before, after) {
    if (after.startsWith(before)) return false;
    const entities = text => [...String(text).matchAll(/\b(?:redis|mysql|kafka|postgres|python|java|[A-Z]\w*(?:Service|Repository))\b|不是|改成|不用|不要|并非/gi)].map(m => m[0].toLowerCase()).sort().join('|');
    return entities(before) !== entities(after) || !before.startsWith(after);
  }

  cancelRunning(reason) {
    if (this.running && !this.running.controller.signal.aborted) {
      this.running.controller.abort(reason); this.record('canceled');
    }
  }

  record(event, requestId = this.running?.requestId || this.pending?.requestId || null) {
    this.metrics[event]++;
    this.onEvent({ event, requestId,
      ...this.metrics, ...Object.fromEntries(Object.entries(this.metrics).map(([key, value]) =>
        ['background' + key[0].toUpperCase() + key.slice(1), value])) });
  }

  schedulePrediction(input) {
    if (!input.projectPlan?.retrieve || input.projectPlan.scopes?.length !== 1) return false;
    const key = retrievalIdentity(input);
    if (this.predictions.some(task => task.key === key) || this.running?.key === key) return false;
    if (this.predictions.length >= this.policy.maxPredictions) return false;
    this.predictions.push({ ...input, key, origin: 'prediction', project: input.projectPlan.scopes[0],
      sequence: ++this.sequence, generation: this.generation, expires: this.now() + this.policy.predictionTTL });
    this.record('queued', input.requestId || null);
    if (!this.running && !this.pending) this.timer = setTimeout(() => this._run(), 0);
    return true;
  }

  async _run() {
    if (this.running || this.suspendedBy != null) return;
    clearTimeout(this.timer); this.timer = null;
    if (this.pending?.origin === 'interim' && this.now() < this.lastStartedAt + this.policy.interim.minIntervalMs) {
      this.timer = setTimeout(() => this._run(), this.lastStartedAt + this.policy.interim.minIntervalMs - this.now());
      return;
    }
    const task = this.pending || this.predictions.shift();
    if (!task) return;
    if (task === this.pending) { this.pending = null; this.firstPendingAt = null; }
    if (task.generation !== this.generation || !this.isCurrent(task)) { this.record('stale'); this._run(); return; }
    if (task.expires && task.expires < this.now()) { this.record('stale'); this._run(); return; }
    task.controller = new AbortController();
    this.running = task; this.lastStartedAt = this.now(); this.record('started');
    let timer;
    try {
      const policy = task.realtimeEvidencePrefetch === false
        ? { execution: 'legacy', semanticWaitMs: 100, budgetMs: 100, hashFallback: task.hashFallback }
        : executionPolicy('background', this.policy.background);
      const expired = new Promise(resolve => { timer = setTimeout(() => {
        task.controller.abort('background-timeout'); this.record('timedOut'); resolve(null);
      }, policy.budgetMs); });
      const result = await Promise.race([this.retrieve({ ...task, ...policy,
        signal: task.controller.signal, deadlineAt: this.now() + policy.budgetMs }), expired]);
      if (result && !task.controller.signal.aborted && task.generation === this.generation && this.isCurrent(task)) {
        this.onResult(result, task); this.record('completed');
        if (task.origin !== 'prediction' && task.exactEligible !== false) {
          this.results.set(task.key, { result, at: this.now(), scopes: [...task.projectPlan.scopes], origin: task.origin });
          while (this.results.size > this.maxResults) this.results.delete(this.results.keys().next().value);
        }
      } else if (result) {
        this.record('stale');
      }
    } catch (_) {
      // Optional prefetch failure is handled by the formal local retrieval.
    } finally {
      clearTimeout(timer);
      if (this.running === task) this.running = null;
      if (task.generation === this.generation && (this.pending || this.predictions.length)) {
        // Do not chain two CPU-bound evidence selections in one microtask turn.
        // Keyboard, audio and UI callbacks get a poll phase between jobs.
        setImmediate(() => { if (task.generation === this.generation) this._run(); });
      }
    }
  }

  take(input, { metadata = false } = {}) {
    const key = retrievalIdentity(input);
    const hit = this.results.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > this.policy.exactResultTTL || !this.isCurrent(input)) { this.results.delete(key); return null; }
    return metadata ? { ...hit.result, prefetchAgeMs: this.now() - hit.at, prefetchOrigin: hit.origin } : hit.result;
  }

  retainScopes(scopes) {
    for (const [project] of this.slots) {
      if (scopes?.includes(project)) continue;
      this.slots.delete(project);
    }
    if (this.running && !scopes?.includes(this.running.project)) this.cancelRunning('scope-changed');
    if (this.pending && !scopes?.includes(this.pending.project)) this.pending = null;
    this.predictions = this.predictions.filter(task => scopes?.includes(task.project));
    // Result identity includes scopes; keeping source caches is safe, while
    // question-result guesses from other projects are discarded immediately.
    for (const [key, hit] of this.results) if (!hit.scopes.every(scope => scopes?.includes(scope))) this.results.delete(key);
  }

  reset() {
    this.generation++; clearTimeout(this.timer); this.timer = null;
    this.cancelRunning('session-reset');
    this.running = null; this.pending = null; this.predictions = []; this.firstPendingAt = null;
    this.slots.clear();
    this.results.clear();
    this.suspendedBy = null;
  }

  suspend(owner) {
    this.suspendedBy = owner;
    clearTimeout(this.timer); this.timer = null;
    this.cancelRunning('foreground-dispatch');
  }

  resume(owner) {
    // An old request's first token/finally must not unlock its successor.
    if (this.suspendedBy !== owner) return false;
    this.suspendedBy = null;
    if (!this.running && (this.pending || this.predictions.length)) {
      this.timer = setTimeout(() => this._run(), 0);
    }
    return true;
  }

  pause() {
    this.cancelRunning('generic-question'); this.pending = null; this.predictions = [];
    clearTimeout(this.timer); this.timer = null; this.firstPendingAt = null;
  }
}

module.exports = { ProjectRagSession, retrievalIdentity, RETRIEVAL_CONFIG_VERSION, sourceEvents,
  formatRetrievalRequirements, notifyProjectSourcesChanged: state => sourceEvents.emit('changed', state) };
