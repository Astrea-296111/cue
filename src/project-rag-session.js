'use strict';

const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const sourceEvents = new EventEmitter();

const RETRIEVAL_CONFIG_VERSION = 'typed-per-question-v1';
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
    sourceKey: input.sourceKey || '', config: RETRIEVAL_CONFIG_VERSION,
    needs: input.interviewPlan?.subQuestions || [], budget: input.contextBudget, hashFallback: input.hashFallback !== false
  })).digest('hex');
}

// Guesses never mutate question selection, project state or answer coverage.
// Each project has one running task and only its newest pending replacement.
class ProjectRagSession {
  constructor({ retrieve, isCurrent = () => true, debounceMs = 200, maxResults = 12, now = Date.now } = {}) {
    this.retrieve = retrieve;
    this.isCurrent = isCurrent;
    this.debounceMs = debounceMs;
    this.maxResults = maxResults;
    this.now = now;
    this.slots = new Map();
    this.results = new Map();
    this.sequence = 0;
  }

  schedule(input, { immediate = false } = {}) {
    if (!input.projectPlan?.retrieve || input.projectPlan.scopes?.length !== 1 || !input.question) return false;
    const key = retrievalIdentity(input);
    const project = input.projectPlan.scopes[0];
    let slot = this.slots.get(project);
    if (!slot) this.slots.set(project, slot = { timer: null, running: null, pending: null });
    if (slot.running?.key === key || slot.pending?.key === key || this.take(input)) return false;
    slot.pending = { ...input, key, sequence: ++this.sequence };
    clearTimeout(slot.timer);
    if (slot.running) {
      slot.running.controller.abort();
      return true;
    }
    if (immediate) this._run(project, slot);
    else slot.timer = setTimeout(() => this._run(project, slot), this.debounceMs);
    return true;
  }

  async _run(project, slot) {
    if (this.slots.get(project) !== slot || slot.running || !slot.pending) return;
    clearTimeout(slot.timer);
    slot.timer = null;
    const task = slot.pending;
    slot.pending = null;
    task.controller = new AbortController();
    slot.running = task;
    try {
      const result = await this.retrieve({ ...task, signal: task.controller.signal, deadlineAt: this.now() + 100 });
      if (!task.controller.signal.aborted && this.slots.get(project) === slot && this.isCurrent(task)) {
        this.results.set(task.key, { result, at: this.now(), scopes: [...task.projectPlan.scopes] });
        while (this.results.size > this.maxResults) this.results.delete(this.results.keys().next().value);
      }
    } catch (_) {
      // Optional prefetch failure is handled by the formal local retrieval.
    } finally {
      if (slot.running === task) slot.running = null;
      if (this.slots.get(project) === slot && slot.pending) this._run(project, slot);
    }
  }

  take(input) {
    const key = retrievalIdentity(input);
    const hit = this.results.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > 60000 || !this.isCurrent(input)) { this.results.delete(key); return null; }
    return hit.result;
  }

  retainScopes(scopes) {
    for (const [project, slot] of this.slots) {
      if (scopes?.includes(project)) continue;
      clearTimeout(slot.timer);
      slot.running?.controller.abort();
      this.slots.delete(project);
    }
    // Result identity includes scopes; keeping source caches is safe, while
    // question-result guesses from other projects are discarded immediately.
    for (const [key, hit] of this.results) if (!hit.scopes.every(scope => scopes?.includes(scope))) this.results.delete(key);
  }

  reset() {
    for (const slot of this.slots.values()) { clearTimeout(slot.timer); slot.running?.controller.abort(); }
    this.slots.clear();
    this.results.clear();
  }
}

module.exports = { ProjectRagSession, retrievalIdentity, RETRIEVAL_CONFIG_VERSION, sourceEvents,
  formatRetrievalRequirements, notifyProjectSourcesChanged: state => sourceEvents.emit('changed', state) };
