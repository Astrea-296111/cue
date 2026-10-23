'use strict';

const { createHash } = require('crypto');
const { tokenize } = require('./project-search');
const { inProjectScope } = require('./project-scope');

// Evidence selection is deliberately independent of model inference. Ranking
// says which sources are relevant; it does not prove an incident or a metric.
const NEED_TYPES = {
  implementation: ['implementation'], implemented: ['implementation', 'overview', 'environment'],
  decision: ['decision'], constraints: ['decision', 'challenge', 'limitation', 'environment'],
  challenge: ['challenge', 'incident'], incident: ['incident'],
  performance: ['performance'], environment: ['environment'],
  ownership: ['ownership'], collaboration: ['collaboration'],
  process: ['process', 'environment'], limitation: ['limitation'],
  theory: ['theory'], general_knowledge: ['theory'], hypothetical: ['implementation', 'limitation', 'decision']
};
const REAL_EXPERIENCE = new Set(['challenge', 'incident', 'ownership', 'collaboration', 'performance']);
const QUERY_FILLER = /这个项目|那个项目|项目|为什么|怎么|如何|什么|哪里|哪些|困难|难点|挑战|介绍|讲讲|说说|具体|刚才|最大的|这个|那个|你们|你在|你是|你的|你用|有没有|在这个过程中|过程中|实现|选择|用了|不用|where|what|why|how|project|your|this|that/gi;
const PERSONAL_ACTION = /(?:我(?!们)|本人|个人|候选人|人物|成员|工程师).{0,28}(?:负责|完成|贡献|实现|开发|维护|推动|设计)|(?:my (?:role|contribution|responsibility)|I (?:owned|implemented|developed|was responsible))/i;
const TECHNOLOGIES = /\b(?:redis|mysql|postgres(?:ql)?|kafka|rabbitmq|rocketmq|langgraph|langchain|mongodb|react|python|java|docker|kubernetes|grpc|faiss)\b/gi;
const FACETS = {
  constraints: /约束|限制|必须|不能|需要|额度|预算|资源|兼容|保持|保留|不再|不会|if\s*\(|assert(?:Equals|Same|False|True|That)|<=|>=|constraints?|requirements?|budget/i,
  alternatives: /不用|未用|未选|没有用|备选|替代|相比|对比|放弃|alternative|instead|versus/i,
  tradeoffs: /取舍|代价|成本|权衡|缺点|缺陷|额外|复杂|限制|trade.?off|drawback/i,
  personal_action: PERSONAL_ACTION, explicit_personal_contribution: PERSONAL_ACTION,
  action: /处理|解决|修复|定位|排查|调整|重试|恢复|回滚|repair|resolved|retry|recover/i,
  verification: /验证|测试|复现|结果|断言|回归|指标|verify|test|assert|result/i,
  event_scope: /实际发生|当时|线上.{0,12}(?:事故|故障)|历史.{0,8}故障|incident|outage/i,
  measurement_scope: /测试|压测|Mock|样本|基准|benchmark|measurement/i,
  units: /\d+(?:\.\d+)?\s*(?:ms|s\b|秒|%|QPS|TPS|MB|MiB|GB|GiB)|单位|\|\s*(?:ms|QPS|TPS)/i,
  result: /\d+(?:\.\d+)?\s*(?:ms|s\b|秒|%|QPS|TPS|MB|MiB|GB|GiB)|结果|测得/i,
  measurement_environment: /环境|单机|Mock|CPU|内存|\d+\s*核|GiB|GB|Linux|Windows|environment/i,
  explicit_team_scope: /团队|协作|分工|合作|协调|team|collaborat/i,
  environment_or_version: /部署|环境|版本|Docker|Compose|容器|JDK|Node|version|environment/i,
  explicit_process: /流程|过程|发布|迭代|开发|process|workflow|release/i,
  state_transition: /状态|重试|恢复|清理|预占|预留|预约|阶段|execution|retry|recover|failure.?stage|reservation|reserve|transition/i,
};

function evidenceId(item) {
  if (item.id !== undefined && item.id !== null && String(item.id)) return String(item.id);
  return 'source-' + createHash('sha256').update(JSON.stringify([item.projectId || '', item.revision || '',
    item.path || '', item.startOffset ?? item.startLine, item.endOffset ?? item.endLine, item.text || ''])).digest('hex').slice(0, 20);
}

function inferDocType(item) {
  if (item.docType && item.docTypeDeclared !== false) return item.docType;
  const text = String(item.text || '');
  if (['method', 'function', 'class', 'interface', 'code'].includes(item.kind)) return 'implementation';
  if (/\b(?:application\.(?:ya?ml|properties)|dockerfile|compose[^/]*\.ya?ml|package\.json|pom\.xml)\b/i.test(item.path || '')) return 'environment';
  if (/职责|本人负责|我负责|我的贡献|ownership/i.test(text)) return 'ownership';
  if (/当时|曾经|实际发生|线上事故/.test(text) && /故障|事故|宕机/.test(text) && !/如果|假设/.test(text)) return 'incident';
  if (/困难|难点|挑战|最难/.test(text)) return 'challenge';
  if (/因为|选型|权衡|取舍|选择.{0,20}(?:是|为了)|because|trade.?off/i.test(text)) return 'decision';
  if (/(?:\d+(?:\.\d+)?\s*(?:ms|秒|%|QPS|TPS|MiB|MB))/.test(text) && /测试|压测|测量|benchmark/i.test(text)) return 'performance';
  return 'overview';
}

function normalizeNeed(need) {
  const value = typeof need === 'string' ? { type: need } : { ...(need || {}) };
  value.type = value.type || value.kind || 'implementation';
  value.docTypes = value.docTypes?.length ? value.docTypes : NEED_TYPES[value.type] || [value.type];
  return value;
}

function inferNeeds(text) {
  const needs = [];
  const add = type => { if (!needs.some(item => item.type === type)) needs.push(normalizeNeed(type)); };
  if (/为什么|为何|选型|不用|取舍|why|trade.?off/i.test(text)) add('decision');
  if (/困难|难点|挑战|遇到.{0,12}(?:坑|问题)/i.test(text)) add('challenge');
  if (/真实.{0,8}(?:故障|事故)|线上事故|发生过|曾经.*故障/i.test(text)) add('incident');
  if (/QPS|延迟|指标|性能提升|恢复率|吞吐|\b(?:latency|throughput|benchmark)\b/i.test(text)) { add('performance'); add('environment'); }
  if (/职责|负责|贡献|独立完成|ownership/i.test(text)) add('ownership');
  if (/协作|团队|合作|collaboration/i.test(text)) add('collaboration');
  if (/部署|环境|版本|docker|compose/i.test(text)) add('environment');
  if (/开发过程|开发流程|推进|process/i.test(text)) add('process');
  if (/代码|源码|实现|调用链|接口|\b(?:code|implementation|method|class)\b/i.test(text)) add('implementation');
  if (/假设|如果|假如|\b(?:hypothetical|what if|suppose)\b/i.test(text)) add('hypothetical');
  if (!needs.length) add(/概览|架构|介绍|技术栈/i.test(text) ? 'implemented' : 'implementation');
  return needs;
}

function questionRequirements(question, interviewPlan, projectPlan) {
  const supplied = interviewPlan?.subQuestions?.length ? interviewPlan.subQuestions : [{ text: String(question || '') }];
  return supplied.map((entry, index) => {
    const q = typeof entry === 'string' ? { text: entry } : entry;
    const binding = projectPlan?.subQuestionScopes?.find(item => q.id && item.questionId === q.id ||
      Number.isInteger(q.start) && Number.isInteger(q.end) && item.start === q.start && item.end === q.end);
    return { ...q, id: q.id || 'question-' + index, text: String(q.text || ''),
      scopes: binding?.scopes || q.scopes || projectPlan?.scopes || [],
      scopeReason: binding?.reason || q.scopeReason || '',
      evidenceNeeds: (q.evidenceNeeds?.length ? q.evidenceNeeds : inferNeeds(q.text || '')).map(normalizeNeed) };
  });
}

function relevant(item, question) {
  if (item.validatedQuestionIds?.length && !item.validatedQuestionIds.includes(question.id)) return false;
  const ownQuestion = !item.questionIds?.length || item.questionIds.includes(question.id);
  if (ownQuestion && (item.relevanceApproved || item.channels?.includes('exact') || item.channels?.includes('semantic') || item.channels?.includes('vector'))) return true;
  if (ownQuestion && (item.coverage > .12 || item.relevance > .12 || item.confidence >= .32)) return true;
  const terms = [...new Set(tokenize(question.text.replace(QUERY_FILLER, ' '), true))];
  const sourceTerms = new Set(tokenize(item.retrievalText || `${item.symbol || ''} ${item.path || ''} ${item.text || ''}`, true));
  if (!terms.length) return true;
  const overlap = terms.filter(term => sourceTerms.has(term)).length;
  return overlap >= Math.min(2, terms.length) && overlap / terms.length >= .12;
}

function supportsNeed(item, need, question) {
  if (!question.scopes.length || !inProjectScope(item, question.scopes) || !relevant(item, question) || item.provenance === 'derived_hint') return false;
  const docType = inferDocType(item);
  if (['ownership', 'collaboration'].includes(need.type) && /团队负责人|技术负责人|管理职责|负责管理|带领团队|team lead|management responsibility/i.test(question.text) &&
    !/(?:我|本人|候选人|人物|成员|工程师)[^。；\n]{0,8}(?:担任[^。；\n]{0,8}(?:团队|技术)负责人|负责(?:团队管理|管理团队)|带领[^。；\n]{0,8}团队|管理[^。；\n]{0,8}团队)|(?:I (?:led|managed)|my management)/i.test(item.text)) return false;
  if (docType === 'implementation' && item.kind === 'context' && (String(item.text).match(/[A-Za-z0-9\u3400-\u9fff]/g) || []).length < 20) return false;
  const adoption = need.type === 'implementation' && /是不是|是否|已经|采用|用了|支持|currently|already|using/i.test(question.text);
  const allowedTypes = need.type === 'context' ? [...new Set([...need.docTypes, 'decision', 'ownership', 'collaboration', 'challenge', 'environment', 'process', 'limitation'])] :
    adoption ? [...new Set([...need.docTypes, 'environment', 'limitation'])] : need.docTypes;
  if (!allowedTypes.includes(docType)) return false;
  const truth = item.truthScope || 'unverified';
  if (['planned', 'abandoned', 'hypothetical', 'general_knowledge'].includes(truth) && need.type !== 'hypothetical' && need.type !== 'theory' && need.type !== 'general_knowledge') return false;
  if (REAL_EXPERIENCE.has(need.type) && /如果|假设|设想|拟定|计划(?:实现|采用)|尚未|未(?:发生|遇到)|没有.{0,12}(?:事故|故障|发生|遇到)|从未.{0,12}(?:事故|故障)|待(?:确认|核实)|不确定|hypothetical|unverified|not yet|\bno\b.{0,20}(?:incident|outage)|\bnever\b.{0,20}(?:incident|outage|occur)/i.test(item.text)) return false;
  if (need.truthScopes?.length && !need.truthScopes.includes(truth)) return false;
  if (need.type === 'incident' && truth === 'test_only') return false;
  if (need.type === 'incident' && docType !== 'incident' && !/线上.{0,12}(?:事故|故障)|真实.{0,12}(?:事故|故障)|实际发生|曾经.{0,12}(?:事故|故障)/i.test(item.text)) return false;
  if (need.type === 'implementation') {
    const symbols = question.text.match(/\b[A-Z][A-Za-z0-9]*(?:Controller|Service|Repository|Handler|Manager|Scheduler)\b|\b[a-zA-Z_$][\w$]*(?=\s*\()/g) || [];
    const source = `${item.symbol || ''}\n${item.text}\n${item.relation?.fromSymbol || ''}\n${item.relation?.toSymbol || ''}`;
    if (symbols.length && !symbols.some(symbol => source.includes(symbol))) return false;
    const states = question.text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || [];
    if (states.length && !states.some(state => `${item.symbol || ''}\n${item.text}`.includes(state))) return false;
    if (/\bCPU\b|内存|资源.{0,12}(?:预占|预留|准入|预约)/i.test(question.text) &&
      !/\bCPU\b|内存|资源|memory|reservation|reserve|allocat/i.test(`${item.symbol || ''}\n${item.text}`)) return false;
    const technologies = [...new Set((question.text.match(TECHNOLOGIES) || []).map(value => value.toLowerCase()))];
    const verifiedDependency = !adoption && item.relation?.status === 'resolved' && item.relation.reason !== 'declared-project-reference';
    if (technologies.length && !verifiedDependency && !(adoption ? technologies.every(value => source.toLowerCase().includes(value)) : technologies.some(value => source.toLowerCase().includes(value)))) return false;
    if (adoption && technologies.some(value => {
      const statements = String(item.text).split(/[。；;\n]/).filter(statement => statement.toLowerCase().includes(value));
      return statements.length && statements.every(statement => /计划|假设|如果|未来|拟(?:用|采|引)|尚未|待(?:实现|评估)|planned|hypothetical|not yet/i.test(statement));
    })) return false;
  }
  if (need.type === 'general_knowledge' && !need.projectAssociated && truth !== 'general_knowledge') return false;
  // A source's YAML declaration cannot establish body facts it never states.
  if (need.type === 'ownership' && !PERSONAL_ACTION.test(item.text)) return false;
  if (need.type === 'performance' && !/\d+(?:\.\d+)?\s*(?:ms|s\b|秒|%|QPS|TPS|MB|MiB|GB|GiB)|吞吐|延迟/i.test(item.text)) return false;
  if (need.type === 'performance' && truth === 'test_only' && /线上|生产|真实.{0,10}(?:指标|性能|延迟|QPS)|production/i.test(question.text)) return false;
  return true;
}

function sourceLabel(item) {
  const lines = `${item.startLine || 1}-${item.endLine || item.startLine || 1}`;
  const offsets = Number.isInteger(item.startOffset) ? `，字符 ${item.startOffset}-${item.endOffset}` : '';
  return `[来源 ${evidenceId(item)}] ${item.projectName || item.projectId || '未指定项目'} · ${inferDocType(item)} / ${item.truthScope || 'unverified'} / ${item.status || 'draft'} · ${item.path || ''}:${lines}${offsets}${item.partial ? '（节选）' : ''}`;
}

function formatEvidenceBlock(item) {
  const id = evidenceId(item);
  const relation=item.relation?.status==='resolved'&&item.relation.sourcePath&&Number.isInteger(item.relation.sourceLine)
    ? `（已核对引用 ${item.relation.fromSymbol} → ${item.relation.toSymbol}，来源 ${item.relation.sourcePath}:${item.relation.sourceLine}）` : '';
  return `${sourceLabel(item)}${relation}\n--- 来源 ${id} 开始 ---\n${item.text}\n--- 来源 ${id} 结束 ---`;
}

function selectEvidence({ candidates = [], question = '', interviewPlan, projectPlan, contextBudget = 4000,
  maxSources, formatContext, unretrieved = [] } = {}) {
  const questions = questionRequirements(question, interviewPlan, projectPlan);
  const max = Math.max(1, Math.min(12, maxSources || (questions.length > 2 ? 9 : 6)));
  const unique = new Map();
  for (const input of candidates) {
    const item = input.chunk ? { ...input.chunk, ...input, chunk: undefined } : { ...input };
    if (!item.text || !item.path || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine)) continue;
    item.id = evidenceId(item);
    const old = unique.get(item.id);
    if (!old) unique.set(item.id, item);
    else {
      const winner = (item.score || 0) > (old.score || 0) ? item : old;
      unique.set(item.id, { ...winner, relation: old.relation || item.relation,
        ...((old.validatedQuestionIds || item.validatedQuestionIds) ? { validatedQuestionIds:
          [...new Set([...(old.validatedQuestionIds || old.questionIds || []), ...(item.validatedQuestionIds || item.questionIds || [])])] } : {}),
        questionIds: [...new Set([...(old.questionIds || []), ...(item.questionIds || [])])] });
    }
  }
  const ranked = [...unique.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  // The same demand is checked during allocation, detail selection and final
  // coverage. Cache only within this immutable selection, never across questions.
  const supportMemo = new Map();
  const supports = (item, need, q) => {
    let byNeed = supportMemo.get(q);
    if (!byNeed) supportMemo.set(q, byNeed = new Map());
    let bySource = byNeed.get(need);
    if (!bySource) byNeed.set(need, bySource = new Map());
    if (!bySource.has(item)) bySource.set(item, supportsNeed(item, need, q));
    return bySource.get(item);
  };
  const selected = [], selectedIds = new Set();
  const render = items => formatContext ? formatContext(items, { maxChars: 9000 }) : items.map(formatEvidenceBlock).join('\n\n');
  const add = item => {
    if (selectedIds.has(item.id)) return true;
    const contains = (outer, inner) => outer.projectId === inner.projectId && outer.path === inner.path &&
      outer.text.includes(inner.text) && (outer.startOffset == null || inner.startOffset == null ||
        outer.startOffset <= inner.startOffset && outer.endOffset >= inner.endOffset);
    if (selected.some(source => source.fullParent && contains(source, item))) return true;
    const replaced = item.fullParent ? selected.filter(source => inferDocType(source) === inferDocType(item) && contains(item, source)) : [];
    const remainder = selected.filter(source => !replaced.includes(source));
    if (remainder.length >= max || render([...remainder, item]).length > contextBudget) return false;
    for (const source of replaced) { selected.splice(selected.indexOf(source), 1); selectedIds.delete(source.id); }
    selected.push(item); selectedIds.add(item.id); return true;
  };
  // Round-robin demands before details prevents the first lengthy subquestion
  // or overview from consuming every source slot.
  const demands = questions.flatMap(q => q.evidenceNeeds.map(need => ({ q, need,
    matches: ranked.filter(item => supports(item, need, q)).sort((a, b) =>
      (b.status === 'confirmed' ? 1 : 0) - (a.status === 'confirmed' ? 1 : 0) ||
      (b.score || 0) - (a.score || 0)) })));
  const supplement = item => item.sourceType === 'manual' && ['ownership', 'collaboration'].includes(inferDocType(item)) &&
    !['planned', 'abandoned', 'hypothetical'].includes(item.truthScope) &&
    questions.some(q => /介绍|概览|整体架构|项目.{0,8}架构|overview|architecture/i.test(q.text) &&
      q.scopes.length && inProjectScope(item, q.scopes) && relevant(item, q));
  const maxNeeds = Math.max(0, ...questions.map(q => q.evidenceNeeds.length));
  for (let needIndex = 0; needIndex < maxNeeds; needIndex++) {
    for (const q of questions) {
      const demand = demands.find(d => d.q.id === q.id && d.need === q.evidenceNeeds[needIndex]);
      if (!demand) continue;
      // Comparisons need a source for every bound project, never an unscoped
      // merged answer supported by only the first project's README.
      for (const scope of q.scopes.length ? q.scopes : [null]) {
        const matches = demand.matches.filter(item => !scope || inProjectScope(item, [scope]));
        for (const item of matches) if (add(item)) break;
      }
    }
  }
  // Prefer the next relevant file/linked source before another header or import
  // from the same class. Actual call chains must retain downstream interfaces.
  const details = [...ranked].sort((a, b) =>
    (b.relation?.status === 'resolved' ? 1 : 0) - (a.relation?.status === 'resolved' ? 1 : 0) ||
    (b.score || 0) - (a.score || 0));
  const coveredFiles = new Set(selected.map(item => `${item.projectId}:${item.path}`));
  for (const item of details) {
    const file = `${item.projectId}:${item.path}`;
    if (coveredFiles.has(file)) continue;
    if ((demands.some(d => supports(item, d.need, d.q)) || supplement(item)) && add(item)) coveredFiles.add(file);
  }
  for (const item of details) {
    if (demands.some(d => supports(item, d.need, d.q)) || supplement(item)) add(item);
  }
  // Verify actual formatted visibility, not merely planned source selection.
  const context = render(selected);
  const visible = selected.filter(item => context.includes(item.text) && context.includes(`[来源 ${item.id}]`));
  const missing = [...unretrieved], byQuestion = questions.map(q => {
    const refs = new Set(), gaps = [];
    if (!q.scopes.length && (q.scopeReason === 'generic-question' || q.evidenceNeeds.every(need => need.type === 'general_knowledge'))) {
      return { id: q.id, text: q.text, scopes: [], evidenceNeeds: q.evidenceNeeds, sourceRefs: [], missing: [] };
    }
    for (const need of q.evidenceNeeds) {
      const allMatches = ranked.filter(item => supports(item, need, q));
      const matches = visible.filter(item => supports(item, need, q));
      for (const item of matches) refs.add(item.id);
      const absentScopes = q.scopes.filter(scope => !matches.some(item => inProjectScope(item, [scope])));
      const missingDetails = (need.requires || []).filter(facet => FACETS[facet] && !matches.some(item => FACETS[facet].test(item.text)));
      if (need.type === 'implementation' && /完整(?:代码|函数|实现)|具体(?:怎么|如何)实现|详细实现|implementation details|full (?:code|method)/i.test(q.text) &&
        matches.length && matches.every(item => item.partial && !item.fullParent)) missingDetails.push('complete_source');
      if (!matches.length || absentScopes.length) {
        const gap = { questionId: q.id, text: q.text, type: need.type,
          reason: allMatches.length ? 'budget-or-visibility' : 'no-relevant-typed-evidence', scopes: absentScopes.length ? absentScopes : q.scopes };
        gaps.push(gap); missing.push(gap);
      } else if (missingDetails.length) {
        const gap = { questionId: q.id, text: q.text, type: need.type, reason: 'missing-evidence-details',
          details: missingDetails, scopes: q.scopes };
        gaps.push(gap); missing.push(gap);
      }
    }
    return { id: q.id, text: q.text, scopes: q.scopes, evidenceNeeds: q.evidenceNeeds, sourceRefs: [...refs], missing: gaps };
  });
  return { evidence: visible, byQuestion, missing, context, stats: { selectedSources: visible.length,
    selectedChars: context.length, candidateSources: ranked.length,
    coverage: demands.length ? Math.max(0, (demands.length - missing.filter(m => m.reason !== 'group-limit').length) / demands.length) : 1 } };
}

module.exports = { selectEvidence, questionRequirements, inferNeeds, inferDocType, supportsNeed,
  evidenceId, formatEvidenceBlock, sourceLabel, normalizeNeed };
