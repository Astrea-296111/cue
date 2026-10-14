'use strict';

const { inProjectScope } = require('./project-scope');
const { stableId } = require('./interview-question-planner');

const MAX_EVIDENCE = 24;
const MAX_TOPICS = 48;
const TECH = { database: ['MySQL', 'PostgreSQL', 'MongoDB'], cache: ['Redis', 'Memcached'], mq: ['Kafka', 'RabbitMQ', 'RocketMQ'] };

function flattenEvidence(evidence) {
  if (Array.isArray(evidence)) return evidence.flatMap(flattenEvidence);
  if (!evidence || typeof evidence !== 'object') return [];
  if (evidence.text && evidence.path) return [evidence];
  return ['chunks', 'profiles', 'cards', 'evidence', 'sources'].flatMap(key => flattenEvidence(evidence[key]));
}

class ProjectInterviewState {
  constructor({ project, scopes }) {
    this.project = project || scopes[0];
    this.scopes = [...scopes];
    this.evidence = new Map();
    this.architecture = {};
    this.decisions = [];
    this.discussedTopics = [];
    this.unresolvedTopics = [];
    this.currentFocus = null;
    this.currentEntity = null;
    this.indexRevision = null;
    this.manualFingerprint = null;
    this.lastRequestId = 0;
  }

  setSourceRevision(indexRevision, manualFingerprint) {
    const changedIndex = indexRevision != null && this.indexRevision != null && this.indexRevision !== indexRevision;
    const changedManual = manualFingerprint != null && this.manualFingerprint != null && this.manualFingerprint !== manualFingerprint;
    if (changedIndex || changedManual) {
      for (const [id, item] of this.evidence) {
        if ((changedIndex && item.sourceType === 'imported') || (changedManual && item.sourceType === 'manual')) this.evidence.delete(id);
      }
      this._deriveFacts();
    }
    if (indexRevision != null) this.indexRevision = indexRevision;
    if (manualFingerprint != null) this.manualFingerprint = manualFingerprint;
  }

  commit(request, evidence) {
    if (request.id <= this.lastRequestId) return false;
    this.lastRequestId = request.id;
    const accepted = [];
    for (const item of flattenEvidence(evidence)) {
      if (!['imported', 'manual'].includes(item.sourceType)) continue;
      if (item.provenance === 'derived_hint') continue;
      if (/assistant|generated|llm/i.test(String(item.origin || item.source || ''))) continue;
      if (!Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine) continue;
      if (item.sourceType === 'imported' && !inProjectScope(item, this.scopes)) continue;
      if (item.sourceType === 'manual' && item.path !== 'settings.projectKnowledge') continue;
      if (item.scopes?.length && !item.scopes.some(scope => this.scopes.includes(scope))) continue;
      const id = stableId(`${item.sourceType}:${item.projectId || this.scopes[0]}:${item.path}:${item.startLine}:${item.endLine}:${item.startOffset ?? ''}:${item.endOffset ?? ''}`);
      this.evidence.delete(id);
      this.evidence.set(id, { id, sourceType: item.sourceType, scope: this.scopes[0],
        projectId: item.projectId || null, path: String(item.path).slice(0, 500), startLine: item.startLine, endLine: item.endLine,
        text: String(item.text), partial: !!item.partial,
        startOffset: Number.isInteger(item.startOffset) ? item.startOffset : null,
        endOffset: Number.isInteger(item.endOffset) ? item.endOffset : null,
        projectName: item.projectName || null, docType: item.docType || null,
        truthScope: item.truthScope || null, status: item.status || null,
        provenance: item.provenance || (item.sourceType === 'manual' ? 'user_authored' : 'imported'),
        headingPath: Array.isArray(item.headingPath) ? [...item.headingPath] : item.headingPath || null,
        codeRefs: Array.isArray(item.codeRefs) ? item.codeRefs.map(ref => ({ ...ref })) : [],
        relatedDocs: Array.isArray(item.relatedDocs) ? [...item.relatedDocs] : [],
        topics: (item.topics || item.interviewTopics || []).filter(topic => typeof topic === 'string').slice(0, 12),
        symbol: typeof item.symbol === 'string' ? item.symbol.slice(0, 160) : null,
        revision: item.sourceType === 'imported' ? this.indexRevision : this.manualFingerprint });
      accepted.push(this.evidence.get(id));
    }
    while (this.evidence.size > MAX_EVIDENCE) this.evidence.delete(this.evidence.keys().next().value);
    this._deriveFacts();
    const topics = request.interviewPlan?.subQuestions.flatMap(question => question.topics || []) || [];
    for (const topic of topics) {
      this.discussedTopics = this.discussedTopics.filter(old => old !== topic);
      this.discussedTopics.push(topic);
    }
    this.discussedTopics = this.discussedTopics.slice(-MAX_TOPICS);
    if (request.checklist) this.unresolvedTopics = request.checklist.questions.filter(question =>
      ['pending', 'unknown'].includes(question.status)).map(question => question.text.slice(0, 500)).slice(-16);
    this.currentFocus = { question: request.question.slice(0, 500), topics: [...new Set(topics)].slice(0, 12),
      symbols: [...new Set(accepted.map(item => item.symbol).filter(Boolean))].slice(0, 8),
      sourceRefs: accepted.map(item => item.id),
      requestId: request.id };
    this.currentEntity = this.currentFocus.symbols.at(-1) || this.currentFocus.topics.at(-1) || this.currentEntity;
    return true;
  }

  _deriveFacts() {
    this.architecture = {};
    this.decisions = [];
    for (const item of this.evidence.values()) {
      if (item.partial) continue;
      if (item.docType === 'theory') continue;
      if (['planned', 'hypothetical', 'abandoned', 'general_knowledge'].includes(item.truthScope)) continue;
      // Detect explicit source statements only. Mentioning a technology, or a
      // hypothetical alternative, does not establish that the project uses it.
      for (const [category, technologies] of Object.entries(TECH)) {
        for (const technology of technologies) {
          const using = new RegExp(`(?:采用|使用|选择|基于|uses?|using|chose|chosen|adopted)\\s*${technology}\\b`, 'i');
          const statement = item.text.split(/[。！？;；\n]+|\.(?=\s|$)/).find(part => using.test(part) &&
            !/假设|如果|假如|可能|建议|计划|可选|(?:不|未|没有|并非|无需|禁止).{0,6}(?:采用|使用|选择|基于)|\b(?:if|would|could|may|might|should|not|never|without|alternative|consider\w*|plan\w*|don't|doesn't|didn't)\b/i.test(part));
          if (!statement) continue;
          const entries = this.architecture[category] || (this.architecture[category] = []);
          if (!entries.some(entry => entry.technology === technology)) entries.push({ technology, sourceRefs: [item.id],
            truthScope: item.truthScope || 'unverified', revision: item.revision });
          if (/因为|为了|原因|考虑|代价|取舍|\b(?:because|in order to|trade.?off|reason)\b/i.test(statement)) {
            this.decisions.push({ technology, sourceText: statement.slice(0, 600), sourceRefs: [item.id] });
          }
        }
      }
    }
    this.decisions = this.decisions.slice(-16);
  }

  snapshot(checklist) {
    const unresolvedTopics = checklist ? checklist.questions.filter(question =>
      ['pending', 'unknown'].includes(question.status)).map(question => question.text.slice(0, 500)).slice(-16) : [...this.unresolvedTopics];
    return { project: this.project, scopes: [...this.scopes], currentFocus: this.currentFocus ? {
      ...this.currentFocus, topics: [...this.currentFocus.topics], symbols: [...this.currentFocus.symbols],
      sourceRefs: [...(this.currentFocus.sourceRefs || [])] } : null,
      currentEntity: this.currentEntity,
      architecture: JSON.parse(JSON.stringify(this.architecture)), decisions: this.decisions.map(decision => ({ ...decision, sourceRefs: [...decision.sourceRefs] })),
      discussedTopics: [...this.discussedTopics], unresolvedTopics,
      evidence: [...this.evidence.values()].map(item => ({ ...item, topics: [...item.topics] })),
      stats: { evidenceCount: this.evidence.size, discussedTopics: this.discussedTopics.length, indexRevision: this.indexRevision } };
  }
}

function formatProjectInterviewState(state, { maxChars = 1800 } = {}) {
  if (!state || maxChars <= 0) return '';
  const lines = ['=== 当前项目讨论进度（不代表候选人实际说过，不是项目事实来源） ===', `项目：${state.project}`];
  if (state.currentFocus?.question) lines.push(`最近关注：${state.currentFocus.question}`);
  if (state.discussedTopics?.length) lines.push(`已讨论主题（不表示均已答全）：${state.discussedTopics.join('、')}`);
  if (state.unresolvedTopics?.length) lines.push(`本话题尚未确认覆盖：${state.unresolvedTopics.join('；')}`);
  return lines.join('\n').slice(0, maxChars);
}

module.exports = { ProjectInterviewState, formatProjectInterviewState, flattenEvidence };
