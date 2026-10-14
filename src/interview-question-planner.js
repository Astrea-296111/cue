'use strict';

const { createHash } = require('node:crypto');

const QUESTION = /[?？]|为什么|为何|怎么|如何|怎样|是否|能不能|什么|哪(?:些|里|个|种|一部分|部分|方面)|多少|介绍|讲讲|说说|解释|分析|比较|\b(?:why|how|what|which|where|when|can you|could you|would you|tell me|describe|explain|compare)\b/i;
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

// Evidence requirements are additive. The existing coarse intent stays stable
// for checklist/answer-shape callers and is never treated as a fact classifier.
function evidenceNeedsFor(text, { scenario = '', projectAssociated = false } = {}) {
  const value = String(text || '');
  const needs = [];
  const add = (type, docTypes, requires = [], extra = {}) => {
    const existing = needs.find(need => need.type === type);
    if (existing) {
      existing.docTypes = [...new Set([...existing.docTypes, ...docTypes])];
      existing.requires = [...new Set([...existing.requires, ...requires])];
      if (extra.truthScopes) existing.truthScopes = [...new Set([...existing.truthScopes, ...extra.truthScopes])];
      if (extra.hypothetical) existing.hypothetical = true;
      return;
    }
    needs.push({ type, required: true, docTypes, truthScopes: ['implemented', 'test_only', 'unverified'], requires, ...extra });
  };
  const hypothetical = SCENARIO.test(value) || !!scenario;
  const choice = /(?:为什么|为何|原因|选择|选型|不用|不选|代价|取舍|权衡|优缺点).{0,36}(?:用|选|方案|技术|框架|组件|设计|实现|数据库|缓存|队列)|(?:用|选|方案|设计).{0,24}(?:原因|取舍|代价)|放弃|未采用|否决|淘汰|\b(?:why (?:not )?(?:use|choose|chose|pick)|trade.?off|alternative|choice|decision|abandon\w*)\b/i.test(value);
  const implementation = /具体(?:怎么|如何)|(?:怎么|如何|哪里).{0,12}(?:实现|调用|处理)|(?:是否|有没有|已经|有无|目前).{0,12}(?:采用|使用|启用|接入|实现|上线|支持)|(?:采用|使用|启用|接入|上线).{0,12}(?:了吗|了没|没有|是否)|代码|接口|调用链|方法|函数|类|配置|源码|改成|改为|修改|实现|\b(?:code|implementation|implement|endpoint|interface|call chain|method|function|class|configuration|rewrite|currently (?:uses?|adopted))\b/i.test(value);
  const architecture = /架构|技术栈|整体组件|\b(?:architecture|tech stack|system overview)\b/i.test(value);
  const technicalEntity = topicsFor(value).length > 0 || /\b(?:[A-Z]{2,}[A-Z0-9_]*|[A-Z][a-z]{3,}(?:[A-Z][a-z0-9]+)*|[a-z]+(?:[A-Z][a-z0-9]+)+)\b|任务|调度|资源|租约|状态|预占|结果|执行|额度|库存/.test(value);
  const stateOrRecovery = /(?:是否|能否|会不会).{0,12}(?:保留|保持|存在|恢复|重试|重启)|(?:还|仍(?:然)?)(?:会|有)?存在|(?:清空|删除|失效|失败).{0,12}(?:后|时)|重试|重新(?:启动|运行|执行)|再次(?:启动|运行|执行)|(?:保留|保持).{0,18}(?:状态|结果|标识|id|pid)|\b(?:retry|restart|retained|still exists?|after (?:failure|deletion|clearing))\b/i.test(value);
  const challenge = /困难|难点|挑战|踩坑|最难|\b(?:challenge|difficulty|hardest|pitfall)\b/i.test(value);
  const incident = /真实.{0,8}(?:故障|事故|问题)|线上.{0,8}(?:故障|事故|问题)|(?:排查|定位).{0,12}(?:问题|故障|错误|失败|原因)|事故|宕机|故障|积压|挂了|\b(?:incident|outage|debug|troubleshoot|production failure|backlog)\b/i.test(value + '\n' + scenario);
  const performance = /\bqps\b|吞吐|延迟|响应时间|恢复率|成功率|提升|效果|指标|测量|压测|基准|\b(?:latency|throughput|performance|benchmark|measurement|recovery rate|percentile)\b/i.test(value);
  const ownership = /你(?:具体)?(?:负责|的职责|的贡献|做了)|本人|独立完成|负责哪|职责|贡献|\b(?:your (?:role|contribution|responsibility)|personally|ownership|responsible for)\b/i.test(value);
  const collaboration = /团队|协作|合作|推进|分工|协调|几个人|\b(?:team|collaborat\w*|coordinate|division of work)\b/i.test(value);
  const environment = /部署|环境|版本|机器|硬件|容器|\b(?:deploy\w*|environment|version|hardware|container)\b/i.test(value);
  const process = /开发(?:流程|过程)|发布(?:流程|过程)|迭代|上线流程|开发周期|怎么推进|\b(?:development process|release process|workflow|iteration)\b/i.test(value);
  const principle = /什么是|是什么|定义|原理|区别|数据结构|数据类型|为什么快|\b(?:what is|principle|definition|difference|data (?:type|structure)|why .*fast)\b/i.test(value);
  if (choice) {
    add('decision', ['decision'], ['constraints', 'alternatives', 'tradeoffs'],
      /放弃|淘汰|\babandon\w*\b/i.test(value) ? { truthScopes: ['implemented', 'test_only', 'abandoned', 'unverified'] } : {});
    add('implementation', ['implementation', 'overview'], ['implemented_baseline', 'source_refs']);
  }
  if (implementation) add('implementation', ['implementation', 'overview'], ['source_refs', 'code_refs', 'configuration_or_test']);
  if (architecture) add('implementation', ['overview', 'implementation'], ['architecture_components', 'source_refs']);
  if (stateOrRecovery && technicalEntity) {
    add('implementation', ['implementation', 'overview', 'process', 'limitation'], ['state_transition', 'constraints', 'verification']);
    if (/不能|不可|不允许|不得|边界|\b(?:cannot|can't|must not|boundary)\b/i.test(value)) {
      add('limitation', ['limitation', 'implementation'], ['implementation_boundary', 'constraints']);
    }
  }
  if (challenge) add('challenge', ['challenge', 'incident'], ['personal_action', 'verification']);
  if (incident) add('incident', ['incident', 'challenge'], ['event_scope', 'action', 'verification'], { hypothetical });
  if (performance) {
    add('performance', ['performance'], ['measurement_scope', 'units', 'result']);
    add('environment', ['environment', 'performance'], ['measurement_environment']);
  }
  if (ownership) add('ownership', ['ownership'], ['explicit_personal_contribution']);
  if (collaboration) add('collaboration', ['collaboration', 'ownership'], ['explicit_team_scope']);
  if (environment) add('environment', ['environment', 'process'], ['environment_or_version']);
  if (process) add('process', ['process', 'environment'], ['explicit_process']);
  if (/计划|打算|尚未|还没|未实现|待实现|不支持|局限|实现边界|\b(?:planned|not yet|not implemented|unsupported|limitation)\b/i.test(value)) {
    add('limitation', ['limitation', 'decision', 'implementation'], ['current_boundary_or_plan'],
      { truthScopes: ['implemented', 'test_only', 'planned', 'abandoned', 'unverified'] });
  }
  if (principle) add('general_knowledge', projectAssociated ? ['theory', 'implementation'] : ['theory'], ['principle'],
    { truthScopes: ['general_knowledge', ...(projectAssociated ? ['implemented', 'test_only', 'unverified'] : [])], projectAssociated });
  if (hypothetical) {
    add('implementation', ['implementation', 'overview'], ['implemented_baseline', 'constraints']);
    add('hypothetical', ['limitation', 'decision', 'theory', 'implementation'], ['separate_proposal_from_fact'],
      { hypothetical: true, truthScopes: ['implemented', 'test_only', 'hypothetical', 'planned', 'unverified'] });
  }
  if (!needs.length) add('context', ['overview', 'implementation', 'theory'], ['relevant_source'], { conservative: true });
  return needs;
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
  const constraints = pieces.filter(part => CONSTRAINT.test(part.text)).map(part => part.text);
  const planned = questions.map((part, index) => ({
    id: stableId(sourceKey ? `${sourceKey}:${index}` : `${originalText}:${index}:${part.text}`),
    ...part,
    intent: questionIntent(part.text),
    topics: topicsFor(part.text),
    evidenceNeeds: evidenceNeedsFor(part.text, { scenario })
  }));
  const subQuestions = planned.slice(0, 32);
  const type = scenario ? 'scenario' : subQuestions.length > 1 ? 'multi-question' : 'question';
  return {
    originalText, type, scenario, constraints,
    mainQuestion: subQuestions[0]?.text || originalText,
    subQuestions, partial: !!partial, sourceKey: String(sourceKey || ''), mode,
    answerStrategy: subQuestions.length > 1
      ? ['先给整体结论', '按原顺序覆盖各子问', '只展开问题要求的实现、取舍或故障边界']
      : ['直接回答当前问题', '结合相关条件和明确指代，不重答无关旧题'],
    omittedQuestions: Math.max(0, questions.length - subQuestions.length),
    // Keep exact tail asks and their requirements for routing and explicit
    // missing reports; the checklist retains its existing 32-question bound.
    omittedSubQuestions: planned.slice(32)
  };
}

module.exports = { planInterviewQuestion, topicsFor, questionIntent, evidenceNeedsFor, stableId };
