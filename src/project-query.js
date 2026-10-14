'use strict';

// Shared by final retrieval and STT prefetch. Generic technology names alone do
// not imply a question about the candidate's implementation.
const PROJECT_REFERENCE = /你们|你在|你的.{0,12}(项目|系统|服务|平台|工作)|贵团队|本项目|该项目|这个项目|那个项目|项目里|项目中|项目的|项目.{0,22}(架构|实现|选型|难点|优化|负责|职责|团队|合作|独立)|(?:介绍|讲讲|说说|展开).{0,10}项目|(?:这个|那个|该)(?:系统|服务|平台|接口|模块)|\b(?:your|our|this|that)\s+(?:project|system|service|implementation|team)\b|\bin your\b/i;
const PROJECT_CONTINUATION = /(?:项目|课题|论文).{0,24}(?:独立|团队|合作|负责|职责|贡献|难点|挑战|过程|怎么做|如何做|实现|结果|指标|效果)|(?:独立完成|团队合作|你具体负责|你的职责|你的贡献|这个过程中|在这个过程|最大的困难|最大的挑战)/i;
const REFERENTIAL = /你刚才|你提到|你说的|刚才提到|前面说的|上一个项目|刚才那个项目|回到.{0,8}项目|\byou (?:mentioned|said)\b/i;
const SHORT_FOLLOWUP = /^(?:那|那么|所以|再|然后)?(?:具体)?(?:为什么|怎么做|怎么实现|如何实现|怎么保证|如何保证|有什么难点|有什么取舍|展开一下|详细说说|继续说|然后呢)[呢吗啊呀？?。!！\s]*$|^(?:why|how|can you elaborate|could you expand)[?!.\s]*$/i;
const OVERVIEW = /(?:介绍|讲讲|说说|概述).{0,10}(?:项目|系统|架构)|整体架构|总体架构|技术栈|项目概况|架构概览|\b(?:overview|tech stack|overall architecture|walk me through)\b/i;
const SPECIFIC = /幂等|回调|重试|限流|熔断|一致性|死锁|事务|缓存|支付|具体实现|\b(?:retry|idempotenc\w*|callback|cache|circuit|transaction)\b/i;
const CODE_SYMBOL = /\b(?:[A-Z][a-z0-9]+){2,}\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[a-z]+_[a-z_]+\b/;
const { resolveProjectMentions, aliasMentions } = require('./resume-project-resolver');
const { isCodeChangeRequest } = require('./question-resolver');

const TOPIC_SWITCH = /换个|换一(?:个|道)|下一个问题|接下来.{0,5}(?:聊|讲|问)|不聊|先不说|新话题|\b(?:new topic|next question|switch to)\b/i;
const GENERIC_QUESTION = /^(?:(?:那|那么|再|请|你)(?:就|给我)?\s*)?(?:什么是|介绍(?:一下)?|讲讲|说说|讲一下|解释(?:一下)?).{0,10}(?:redis|mysql|java|jvm|gc\b|hashmap|线程|事务|索引|spring|kafka|goroutine|channel|gmp\b|http|tcp|操作系统|计算机网络)|^(?:redis|mysql|java|jvm|spring|hashmap|线程|事务|索引|kafka|http|tcp).{0,18}(?:是什么|有哪些|有几种|哪些|支持什么|的区别|有什么区别|数据结构|数据类型|底层原理|为什么快|为何快)|^(?:what is|explain|tell me about)\s+(?:redis|mysql|java|http|tcp|hashmap)\b/i;
const CLEAR_NON_PROJECT = /自我介绍|为什么(?:投|选择|想来|申请).{0,16}(?:公司|岗位|职位|我们|这里)|职业规划|期望薪资|薪资|多久(?:能|可以)到岗|什么时候到岗|你的优点|你的缺点|优势是什么|缺点是什么|为什么离职|学校|专业|研究方向|算法题|leetcode|手撕|写(?:一段|个)?代码|反问|还有什么想问|\b(?:tell me about yourself|career goals|salary|compensation|why this company|why this role|leetcode)\b/i;
const NEW_UNNAMED_PROJECT = /另一个项目|另外一个项目|下一个项目|换个项目|换一个项目/i;
// A technology list cannot enumerate every interview topic. Explicit discourse
// cues detach principles from project facts regardless of the technology name.
const DETACH_PROJECT = /(?:不|别|无需|不要|先不)(?:结合|涉及|针对|联系|套用)[^，,。？！?!;；\n]{0,24}(?:项目|你的实现|实际实现)|(?:不|别|不要|先不)(?:谈|聊)\s*(?:这个|那个|当前|刚才的)?\s*项目|(?:脱离|跳出)[^，,。？！?!;；\n]{0,12}项目|\b(?:without (?:the |your )?project|independent(?:ly)? of (?:the |your )?project)\b/i;
const GENERIC_OPENING = /^(?:(?:那|那么|现在|接下来|另外|再)\s*)?(?:单独(?:问|聊|讲)(?:一下)?|一般(?:来说|而言)|从(?:通用|一般)(?:原理|概念|角度)|就(?:一般|通用)(?:原理|情况))|(?:只|单纯)(?:问|讨论|讲).{0,12}(?:通用|一般|原理|概念)|\b(?:in general|generally speaking|as a general (?:concept|principle)|a separate (?:conceptual|general) question)\b/i;

function isLikelyFollowUp(text) {
  const value = String(text || '').trim();
  if (!value || TOPIC_SWITCH.test(value) || isClearProjectExit(value)) return false;
  if (REFERENTIAL.test(value) || SHORT_FOLLOWUP.test(value) || PROJECT_CONTINUATION.test(value) || isCodeChangeRequest(value)) return true;
  const explicitTechnicalQuestion = GENERIC_QUESTION.test(value) ||
    /(?:redis|mysql|java|jvm|hashmap|spring|kafka|goroutine|http|tcp|线程).{0,20}(?:数据类型|数据结构|几种|哪些|支持什么|线程状态|底层原理|区别|是什么|定义)/i.test(value);
  if (explicitTechnicalQuestion && !PROJECT_REFERENCE.test(value)) return false;
  if (/^(那|那么|所以|然后|再|继续|具体|为什么|怎么|如何|这个|这种|这里|刚才|你刚才|你提到|你说|只有|还有|后[一二三四五六七八九十\d]|前[一二三四五六七八九十\d]|第[一二三四五六七八九十\d])|刚才|前面|上一个|展开|接着|\b(?:you mentioned|you said|what about|why|how|continue|the second|the last)\b/i.test(value)) return true;
  return value.replace(/\s/g, '').length <= 20 && /[？?呢吗嘛]|详细|举例/.test(value);
}

function buildPrefetchQuery(payload) {
  const text = typeof payload === 'string'
    ? payload.trim()
    : (typeof payload?.text === 'string' ? payload.text.trim() : '');
  if (!text) return '';
  const previous = Array.isArray(payload?.previous)
    ? payload.previous.map((item) => String(item || '').trim()).filter(Boolean).slice(-2)
    : [];
  return isLikelyFollowUp(text) && previous.length
    ? [text, ...previous].join('\n')
    : text;
}

function namedProjects(text, catalog) {
  return (catalog || []).filter(project => [project.name, ...(project.aliases || [])]
    .some(alias => aliasMentions(text, alias).length));
}

function resolveProjects(text, catalog) {
  const seen = new Set();
  return resolveProjectMentions(text, catalog).filter(mention => !mention.excluded).map(mention => mention.project).filter(project => {
    const id = project.projectId || project.prefix || project.key || project.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function interviewerTurns(transcript) {
  return (Array.isArray(transcript) ? transcript : [])
    .filter(t => t && t.channel === 'them' && String(t.text || '').trim());
}

function withCurrentQuestion(transcript, userText) {
  const turns = Array.isArray(transcript) ? transcript.slice() : [];
  const text = String(userText || '').trim();
  if (!text) return turns;
  const last = interviewerTurns(turns).at(-1);
  if (!last || String(last.text).trim() !== text) {
    turns.push({ channel: 'them', text, provisional: true, ts: Date.now() });
  }
  return turns;
}

function directProjectQuestion(text) {
  if (PROJECT_REFERENCE.test(text) || PROJECT_CONTINUATION.test(text)) return true;
  // A code identifier is only a hint when the question asks about implementation.
  if (/\b(?:HashMap|ConcurrentHashMap|ArrayList|LinkedList|ThreadLocal|CompletableFuture|StringBuilder)\b/i.test(text)) return false;
  return CODE_SYMBOL.test(text) && /实现|方法|类|接口|代码|\b(?:method|class|implement\w*)\b/i.test(text);
}

function activeSnapshot(plan) {
  if (!plan) return null;
  if (plan.activeProject && Array.isArray(plan.activeProject.scopes) && plan.activeProject.scopes.length) {
    return { ...plan.activeProject, scopes: plan.activeProject.scopes.slice() };
  }
  if (plan.retrieve && Array.isArray(plan.scopes) && plan.scopes.length) {
    return {
      scopes: plan.scopes.slice(),
      anchor: plan.anchor || plan.question || plan.query || '',
      question: plan.question || '',
      label: plan.projectLabel || ''
    };
  }
  return null;
}

function sameProjectScopes(left = [], right = []) {
  return left.length > 0 && left.length === right.length && left.every(scope => right.includes(scope));
}

function isClearProjectExit(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (CLEAR_NON_PROJECT.test(value)) return true;
  if (DETACH_PROJECT.test(value)) return true;
  if (GENERIC_OPENING.test(value) && !PROJECT_REFERENCE.test(value) && !PROJECT_CONTINUATION.test(value)) return true;
  if (GENERIC_QUESTION.test(value) && !PROJECT_REFERENCE.test(value) && !PROJECT_CONTINUATION.test(value)) return true;
  return false;
}

function planProjectRetrieval(transcript, mode = 'say', options = {}) {
  const turns = interviewerTurns(transcript);
  const text = String(turns.at(-1)?.text || '').trim();
  if (!['say', 'answerThis', 'assist', 'ask'].includes(mode)) {
    return { retrieve: false, query: text, reason: 'mode', overview: false, scopes: [], activeProject: activeSnapshot(options.activeProjectPlan || options.previousPlan) };
  }
  const catalog = options.catalog || [];
  let previous = options.previousPlan || null;
  let activeProject = activeSnapshot(options.activeProjectPlan) || activeSnapshot(previous);
  const previousProject = activeProject;
  let explicitlyResolved = false;
  const manualProjectId = options.manualProjectId || options.currentProjectId || null;
  const manualProject = catalog.find(project => project.projectId === manualProjectId || project.prefix === manualProjectId);
  const manualSelectionChanged = !!manualProject && (!!options.manualProjectChanged || previous?.manualProjectId !== manualProjectId);
  if (manualProject && (!activeProject || manualSelectionChanged)) {
    activeProject = { scopes: [manualProject.prefix], anchor: manualProject.name, question: '', label: manualProject.name,
      projectIds: [manualProject.projectId].filter(Boolean), source: 'manual-default' };
  }

  for (const turn of turns) {
    const current = String(turn.text || '').trim();
    const named = resolveProjects(current, catalog);
    // An interface/code reference after a generic algorithm question continues
    // that code discussion; it does not create an unnamed project thread.
    const unboundCodeFollowup = previous?.retrieve === false && !activeProject && !named.length &&
      !/项目|课题|论文|\bproject\b/i.test(current);
    const direct = named.length > 0 || (!unboundCodeFollowup && directProjectQuestion(current));
    const followup = isLikelyFollowUp(current);
    const newUnnamedProject = NEW_UNNAMED_PROJECT.test(current) && !named.length;
    const hardSwitch = TOPIC_SWITCH.test(current);
    const clearExit = isClearProjectExit(current);
    const explicitProjectContinuation = PROJECT_CONTINUATION.test(current) || REFERENTIAL.test(current) && /项目|课题|论文/.test(current);

    if (newUnnamedProject) activeProject = null;
    if (named.length) {
      explicitlyResolved = true;
      activeProject = {
        scopes: named.map(project => project.prefix),
        anchor: current.slice(0, 500),
        question: current,
        label: named.map(project => project.name || project.prefix).filter(Boolean).join(' / '),
        projectIds: named.map(project => project.projectId).filter(Boolean),
        source: 'explicit'
      };
    }

    // While an interviewer is drilling into one project, project identity is a
    // discourse state, not something every sentence repeats. A clearly generic
    // question suspends (but does not erase) that project thread, so ‘只有五种吗’
    // follows Redis instead of jumping back to the old project. An explicit
    // ‘回到刚才那个项目/项目里你负责什么’ can resume the suspended thread.
    const wasProjectActive = manualProject && previous?.manualProjectId !== manualProjectId
      ? true : previous ? previous.projectActive !== false : !!activeProject;
    const useActiveProject = !!activeProject && !named.length && !newUnnamedProject && !clearExit &&
      (!hardSwitch || explicitProjectContinuation || PROJECT_REFERENCE.test(current)) &&
      (wasProjectActive || explicitProjectContinuation);
    const inheritPrevious = !!previous?.retrieve && !hardSwitch && !newUnnamedProject && !clearExit &&
      (followup || (direct && !named.length));
    const retrieve = named.length > 0 || !clearExit && (direct || useActiveProject || inheritPrevious);
    const scopes = named.length
      ? named.map(project => project.prefix)
      : (useActiveProject ? activeProject.scopes.slice() : (inheritPrevious ? previous.scopes || [] : []));

    const inheritsProject = scopes.length > 0 && !named.length && (useActiveProject || inheritPrevious);
    const inheritTopic = previous && followup && !hardSwitch && !newUnnamedProject;
    const anchor = named.length ? current.slice(0, 500)
      : inheritsProject ? (activeProject?.anchor || previous?.anchor || current.slice(0, 500))
        : (direct && !inheritPrevious) ? current.slice(0, 500)
          : (inheritTopic ? previous.anchor || previous.question || previous.query : current.slice(0, 500));

    // Scope selection is separate from keyword matching: old answers are hints,
    // never evidence. Project identity is allowed to persist, assistant claims are not.
    const hints = inheritsProject || inheritPrevious
      ? [previous?.question || '', activeProject?.anchor || anchor]
      : [];
    const query = [current, ...hints.map(value => String(value || '').slice(0, 350))]
      .filter(Boolean).join('\n');

    const reason = named.length ? 'named-project'
      : inheritsProject ? 'active-project-followup'
        : inheritPrevious ? 'project-followup'
          : direct ? 'project-reference'
            : clearExit || hardSwitch ? 'topic-exit'
              : 'independent-question';
    const projectActive = named.length > 0 || inheritsProject || (direct && scopes.length > 0)
      ? true
      : (clearExit || hardSwitch || newUnnamedProject ? false : (previous?.projectActive ?? !!activeProject));

    previous = {
      retrieve,
      query,
      question: current,
      anchor,
      scopes,
      activeProject: activeProject ? { ...activeProject, scopes: activeProject.scopes.slice() } : null,
      projectLabel: activeProject?.label || '',
      projectIds: catalog.filter(project => scopes.includes(project.prefix)).map(project => project.projectId).filter(Boolean),
      manualProjectId,
      projectActive,
      reason,
      overview: retrieve && OVERVIEW.test(current) && !SPECIFIC.test(current)
    };
  }

  const plan = previous || {
    retrieve: false,
    query: text,
    question: text,
    anchor: '',
    scopes: [],
    activeProject: activeProject ? { ...activeProject, scopes: activeProject.scopes.slice() } : null,
    projectActive: false,
    reason: 'no-question',
    overview: false
  };
  plan.previousProject = previousProject;
  plan.catalog = catalog;
  plan.projectMentions = resolveProjectMentions(text, catalog).map(({ start, end, kind, project, excluded }) => ({
    start, end, kind, excluded, projectId: project.projectId || null, name: project.name, scope: project.prefix
  }));
  if (options.interviewPlan) plan.subQuestionScopes = scopeInterviewQuestions(options.interviewPlan, plan, catalog);
  plan.projectSwitched = !!previousProject && (explicitlyResolved || manualSelectionChanged) && !!plan.activeProject &&
    !sameProjectScopes(previousProject.scopes, plan.activeProject.scopes);
  if ((plan.reason === 'project-followup' || plan.reason === 'active-project-followup') && options.answerHint &&
      /第.{0,3}点|后.{0,3}种|前.{0,3}种|那个|这个|继续|展开|你提到|你说/.test(text)) {
    plan.query = plan.query + '\n上轮回答中的检索线索：\n' + String(options.answerHint).slice(0, 400);
  }
  return plan;
}

// Names in setup clauses remain available to later asks. A generic subquestion
// suspends facts only for that ask, even when another ask is about a project.
function scopeInterviewQuestions(interviewPlan, projectPlan, catalog = projectPlan.catalog || []) {
  const originalText = String(interviewPlan?.originalText || projectPlan.question || '');
  const mentions = resolveProjectMentions(originalText, catalog).filter(mention => !mention.excluded);
  return [...(interviewPlan?.subQuestions || []), ...(interviewPlan?.omittedSubQuestions || [])].map(question => {
    const own = mentions.filter(mention => mention.start >= question.start && mention.start < question.end);
    const before = mentions.filter(mention => mention.end <= question.start);
    const preceding = before.at(-1);
    const generic = !own.length && isClearProjectExit(question.text);
    const fallbackScopes = mentions.length && !preceding && !own.length
      ? (!projectPlan.projectSwitched ? projectPlan.previousProject?.scopes || [] : [])
      : projectPlan.scopes || [];
    const projectChoices = own.length ? own.map(mention => mention.project)
      : !generic && preceding ? [preceding.project]
        : !generic ? catalog.filter(project => fallbackScopes.includes(project.prefix)) : [];
    const scopes = generic ? [] : [...new Set(projectChoices.length ? projectChoices.map(project => project.prefix) : fallbackScopes)];
    return { questionId: question.id, start: question.start, end: question.end, scopes,
      projectIds: [...new Set(projectChoices.map(project => project.projectId).filter(Boolean))],
      reason: generic ? 'generic-question' : own.length ? 'explicit-question-project' : preceding ? 'preceding-project-mention'
        : scopes.length ? 'active-project' : 'unresolved-project' };
  });
}

module.exports = {
  planProjectRetrieval,
  withCurrentQuestion,
  isLikelyFollowUp,
  namedProjects,
  buildPrefetchQuery,
  directProjectQuestion,
  isClearProjectExit,
  sameProjectScopes,
  resolveProjects,
  scopeInterviewQuestions
};
