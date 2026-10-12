'use strict';

const { createHash } = require('node:crypto');

const QUESTION = /[?？]|为什么|为何|怎么|如何|怎样|是否|能不能|什么|哪些|哪里|多少|介绍|讲讲|说说|解释|分析|比较|\b(?:why|how|what|which|where|when|can you|could you|would you|tell me|describe|explain|compare)\b/i;
const SCENARIO = /(?:假设|假如|如果|给定|场景|考虑|已知|\b(?:suppose|assuming|imagine|given|what if|if)\b)/i;
const CONSTRAINT = /要求|限制|必须|不能|不允许|至少|最多|保持|保留|允许|\b(?:must|cannot|can't|required|at least|at most|preserve|without|constraint)\b/i;
const EDIT = /改成|改为|修改|重写|优化|修复|添加|实现|\b(?:rewrite|change|modify|implement|fix|optimize)\b/i;
const TOPICS = [
  ['Redis', /\bredis\b/i], ['MySQL', /\bmysql\b/i], ['Kafka', /\bkafka\b/i],
  ['LangGraph', /\blanggraph\b/i], ['Function Call', /\bfunction\s*call(?:ing)?\b/i],
  ['React', /\breact\b/i], ['QPS', /\bqps\b/i], ['Java', /\bjava\b/i],
  ['分库分表', /分库|分表|\bshard(?:ing)?\b/i], ['缓存', /缓存|\bcach\w*\b/i],
  ['扩容', /扩容|扩展|流量增长|\bscal\w*\b/i], ['幂等', /幂等|\bidempoten\w*\b/i],
  ['重试', /重试|\bretr\w*\b/i], ['MQ', /\bmq\b|消息队列|\bmessage queue\b/i],
  ['库存', /库存|\binventory\b/i], ['订单', /订单|\border\b/i],
  ['架构', /架构|\barchitect\w*\b/i], ['性能', /性能|\bperformance\b/i],
  ['一致性', /一致性|\bconsisten\w*\b/i], ['故障', /挂了|失效|故障|宕机|\bfail\w*\b|\boutage\b/i],
  ['Database', /数据库|\bdatabase\b/i], ['Schema', /表结构|\bschema\b/i],
  ['Architecture', /\barchitecture\b/i], ['TCP', /\btcp\b/i], ['HTTP', /\bhttp\b/i]
];

function stableId(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function topicsFor(text) {
  return TOPICS.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function questionIntent(text) {
  if (/挂了|故障|失效|宕机|积压|\bfail\w*\b|\boutage\b|\bbacklog\b/i.test(text)) return 'failure';
  if (/不用|不选|代价|取舍|权衡|优缺点|\b(?:trade.?off|alternative|why not)\b/i.test(text)) return 'tradeoff';
  if (/为什么|为何|原因|\bwhy\b/i.test(text)) return 'reason';
  if (/代码|实现|改成|改为|\b(?:code|implement|rewrite)\b/i.test(text)) return 'implementation';
  if (/设计|优化|扩容|\b(?:design|optimize|scale)\b/i.test(text)) return 'design';
  return 'explanation';
}

// Boundaries retain offsets into originalText. Commas only split an explicit
// question/imperative, so setup and constraints do not become invented questions.
function clauses(text) {
  const boundaries = new Set([0, text.length]);
  const delimiters = /[?？;；\n]+|[。！!]+|\.(?=\s|$)/g;
  for (const match of text.matchAll(delimiters)) boundaries.add(match.index + match[0].length);
  const nextQuestion = /[,，]\s*(?=(?:为什么|为何|怎么|如何|怎样|是否|能不能|什么|哪些|哪里|介绍|讲讲|说说|解释|分析|比较|你(?:怎么|如何))|(?:why|how|what|which|can you|could you|would you|explain|describe)\b)|\s+(?:and|also)\s+(?=(?:why|how|what|which|can you|could you)\b)/gi;
  for (const match of text.matchAll(nextQuestion)) boundaries.add(match.index + match[0].length);
  const positions = [...boundaries].sort((a, b) => a - b);
  return positions.slice(0, -1).map((start, index) => {
    let end = positions[index + 1];
    while (start < end && /\s|[,，]/.test(text[start])) start++;
    while (end > start && /\s|[,，]/.test(text[end - 1])) end--;
    return { text: text.slice(start, end), start, end };
  }).filter(part => part.text);
}

function planInterviewQuestion({ text = '', partial = false, sourceKey = '', mode = 'say' } = {}) {
  const originalText = String(text || '').trim();
  const pieces = clauses(originalText);
  const questions = pieces.filter(part => QUESTION.test(part.text) || EDIT.test(part.text));
  // An uncertain fragment remains one provisional target; never complete it.
  if (!questions.length && originalText) questions.push({ text: originalText, start: 0, end: originalText.length });
  const scenarioPart = pieces.find(part => SCENARIO.test(part.text));
  let scenario = '';
  if (scenarioPart) {
    const marker = scenarioPart.text.search(/[,，]\s*(?:你(?:怎么|如何)|怎么|如何|为什么)|[,，]\s*(?:how|what|why|would|could|can)\b/i);
    scenario = marker >= 0 ? scenarioPart.text.slice(0, marker).trim() : scenarioPart.text;
    // A question clause already contains its own scenario. Keep the exact setup
    // without requiring a second text reconstruction from the raw transcript.
    if (questions.some(q => q.start === scenarioPart.start)) {
      scenario = scenario.replace(/[?？]$/, '');
    }
  }
  const constraints = pieces.filter(part => CONSTRAINT.test(part.text)).map(part => part.text).slice(0, 16);
  const subQuestions = questions.slice(0, 32).map((part, index) => ({
    id: stableId(sourceKey ? `${sourceKey}:${index}` : `${originalText}:${index}:${part.text}`),
    ...part,
    intent: questionIntent(part.text),
    topics: topicsFor(part.text)
  }));
  const type = scenario ? 'scenario' : subQuestions.length > 1 ? 'multi-question' : 'question';
  return {
    originalText, type, scenario, constraints,
    mainQuestion: subQuestions[0]?.text || originalText,
    subQuestions, partial: !!partial, sourceKey: String(sourceKey || ''), mode,
    answerStrategy: subQuestions.length > 1
      ? ['先给整体结论', '按原顺序覆盖各子问', '只展开问题要求的实现、取舍或故障边界']
      : ['直接回答当前问题', '结合相关条件和明确指代，不重答无关旧题'],
    omittedQuestions: Math.max(0, questions.length - subQuestions.length)
  };
}

module.exports = { planInterviewQuestion, topicsFor, questionIntent, stableId };
