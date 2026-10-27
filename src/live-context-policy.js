'use strict';

const DEFAULTS = Object.freeze({ historyWindowTurns: 2, includeCandidateSpeech: false,
  includePreviousAiAnswers: false, recallArchivedTurns: false, clearOnTopicSwitch: true });
const SWITCH = /换.{0,3}(?:问题|题)|不聊项目|不谈项目|现在做这个题|新话题|单独问|一般来说/;
const REFERENTIAL = /对比过|对照组|怎么融合|第[一二三四五六七八九十0-9]+(?:个问题|道题|点)|third question|second question|you mentioned|你们几个人|你负责哪块|是你一个人|团队|同事|那这个项目|它们|他们|这两|两种|这个(?:怎么|如何|方案|项目|机制|实现)|这些|上述|刚才|前面|这样|那(?:么)?为什么|失败后|代价呢|怎么恢复/;
const EXPLICIT = /Redis|JVM|SQL|Kafka|RabbitMQ|temperature|top[- _]?p|MCP|RAG|Arclight|CAE/i;
function normalize(value = {}) {
  return { ...DEFAULTS, ...value, historyWindowTurns: Math.max(0, Math.min(2, Math.floor(Number(value.historyWindowTurns ?? 2)) || 0)),
    recallArchivedTurns: false, includePreviousAiAnswers: false };
}
function needsReference(question) {
  const q = String(question || '');
  return !SWITCH.test(q) && REFERENTIAL.test(q) && !EXPLICIT.test(q);
}
class LiveQuestionWindow {
  constructor() { this.reset(); }
  reset() { this.turns = []; }
  observe(snapshot) {
    if (!snapshot?.questionId) return;
    const text = snapshot.text || snapshot.pendingText || snapshot.interimText || '';
    if (!text) return;
    const previous = this.turns.find(t => t.questionId === snapshot.questionId);
    const turn = { questionId: snapshot.questionId, revision: snapshot.revision, text,
      observedAt: snapshot.observedAt, startedAt:previous?.startedAt || snapshot.observedAt, sourceKeys: [...(snapshot.sourceKeys || [])] };
    if (previous) Object.assign(previous, turn);
    else this.turns.push(turn);
    if (this.turns.length > 6) this.turns.shift();
  }
  select(snapshot, configured) {
    const start = performance.now(), policy = normalize(configured);
    const index = this.turns.findIndex(t => t.questionId === snapshot?.questionId);
    const prior = (index >= 0 ? this.turns.slice(0, index) : this.turns).slice(-policy.historyWindowTurns);
    const selected = needsReference(snapshot?.text) ? prior : [];
    return { policy, turns: selected.map(t => ({ ...t })), referenceContext: selected.map(t => t.text).join('\n'),
      topicSwitch: selected.length ? null : SWITCH.test(snapshot?.text || '') ? 'explicit-switch' : 'independent-question',
      selectionMs: performance.now() - start };
  }
}
module.exports = { DEFAULTS, normalize, needsReference, LiveQuestionWindow };
