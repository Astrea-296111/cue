// Realtime interview prompts: short by default, expandable when the question is truly complex.
// Keep the current interviewer turn authoritative; project/resume context is factual support only.

const { appendAiRules } = require('./profile-context');
const { isLikelyFollowUp } = require('./project-query');

const cleanText = value => String(value || '').trim();

function formatTranscript(turns, limit) {
  const list = Array.isArray(turns) ? turns : [];
  const recent = limit ? list.slice(-limit) : list;
  return recent.filter(t => t && cleanText(t.text))
    .map(t => `${t.channel === 'them' ? '面试官' : '候选人'}：${cleanText(t.text)}`).join('\n');
}

function latestInterviewerTurn(turns) {
  const list = Array.isArray(turns) ? turns : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.channel === 'them' && cleanText(list[i].text)) return list[i];
  }
  return null;
}

function formatRealtimeConversation(turns, options = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const current = latestInterviewerTurn(list);
  if (!current) return '=== 当前面试官问题 ===\n（尚未识别到面试官问题）';
  const currentText = cleanText(current.text);
  const sections = [options.partial
    ? '=== 当前已识别的面试官发言（用户主动触发，发言可能尚未结束） ==='
    : '=== 当前轮面试官提问（同一语义场景的连续发言已合并） ===', currentText];
  if (isLikelyFollowUp(currentText)) {
    const previousThem = list.filter(t => t?.channel === 'them' && t !== current && cleanText(t.text)).slice(-2);
    if (previousThem.length) sections.push('=== 追问背景（只用于消解指代，不主动重答旧题） ===', formatTranscript(previousThem));
  }
  return sections.join('\n\n');
}

function clipContext(contextBlock, limit) {
  const text = cleanText(contextBlock);
  if (!text || !limit || text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + '…';
}

function buildSystem(base, contextBlock, contextLimit = 3600) {
  const context = clipContext(contextBlock, contextLimit);
  return context ? `${context}\n\n${base}` : base;
}

function applyRules(prompt, aiRules, mode) {
  if (mode === 'leetcode') return prompt;
  const result = appendAiRules(prompt, aiRules);
  return ['say', 'answerThis'].includes(mode) ? `${result}\n\n${ORAL_ANSWER_RULES}` : result;
}

function countQuestionSignals(text) {
  const q = cleanText(text);
  const explicit = (q.match(/[?？]/g) || []).length;
  const connectors = (q.match(/(?:另外|还有|再问|第二个|第三个|以及|同时|然后.{0,6}(?:怎么|为什么|什么)|and\s+(?:why|how|what))/gi) || []).length;
  return Math.max(explicit, connectors + (explicit ? 0 : 1));
}

function getAnswerPlan(question = '', interviewPlan = null) {
  const q = cleanText(question);
  const questionCount = Array.isArray(interviewPlan?.subQuestions) ? interviewPlan.subQuestions.length : 0;
  const multi = questionCount >= 2 || countQuestionSignals(q) >= 2;
  const complexPattern = /系统设计|架构|完整链路|整体流程|端到端|深入|详细|展开|怎么设计|如何设计|怎么实现|如何实现|排查|定位|优化|权衡|取舍|一致性|高并发|高可用|容灾|性能问题|项目里.+(?:怎么|如何)|为什么.+(?:选择|设计|不用)|从头|完整讲|walk\s+me\s+through|system\s+design|trade-?off|architecture/i;
  const simplePattern = /^(?:什么是|说一下|简单说|简单介绍|区别|有什么区别|是否|能不能|是不是|解释一下|what is|difference between|define)\b/i;
  let complex = multi || complexPattern.test(q) || q.length >= 72;
  if (!multi && simplePattern.test(q) && q.length < 48) complex = false;
  return complex
    ? { level: 'complex', sentenceLimit: Math.min(18, 9 + Math.max(0, questionCount - 2) * 2),
      target: '先用1~2句给主干，再围绕问题本身展开；优先覆盖每个有效子问。',
      maxTokens: Math.min(1800, 920 + Math.max(0, questionCount - 2) * 180), questionCount }
    : { level: 'brief', sentenceLimit: 5, target: '直接回答，通常3~5句；能3句讲清就不要凑到5句；复杂的点可以多举例子。', maxTokens: 700 };
}

function answerShapeInstruction(plan) {
  const p = plan || getAnswerPlan('');
  if (p.questionCount >= 2) {
    return `这是复杂问题：本轮有${p.questionCount}个子问题（含同话题仍适用的遗漏）：先给方案主干，再按原顺序逐项回应；当前新问优先，每个子问至少覆盖结论和最关键的理由或做法。` +
      `先保证全部覆盖，再展开细节；通常控制在${p.sentenceLimit}句以内，不能为了沿用单点题句数限制而漏答。`;
  }
  return p.level === 'complex'
    ? '这是复杂问题：第一两句先把方案/结论主干说清楚，再只展开与问题直接相关的关键机制、流程或取舍。可以明显比普通题多说，但不要延伸到没问的知识点。'
    : '这是简要问题：用3~5句直接回答，第一句就命中问题；只补最必要的原因、区别或例子。';
}

function interviewShapeInstruction({ interviewPlan, projectPlan } = {}) {
  if (!(projectPlan?.retrieve && projectPlan.scopes?.length) && interviewPlan?.type !== 'scenario') return '';
  return '\nInterview Mode：用高级候选人的方式回答当前项目/设计问题。' +
    '先给结论，再解释设计原因、关键实现、相关 trade-off，以及确有必要的不足或优化方向。' +
    '按当前问题需要选择这些层次，不要求每个子问凑齐五段。已有项目背景不重复介绍；项目状态仅帮助延续讨论，事实仍以本轮来源证据为准。' +
    '假设性场景应说“如果/我会”，不能把推演方案、假设流量或助手建议说成实际项目经历。\n';
}

function contextCharsFor(mode, answerPlan) {
  if (mode === 'say' || mode === 'answerThis') return answerPlan?.level === 'complex' ? 4800 : 3600;
  return { assist: 4800, ask: 5000, followup: 6000, recap: 14000, leetcode: 0 }[mode] ?? 3600;
}

const REALTIME_CONTEXT_RULES = `
实时上下文规则：
1. 当前轮面试官提问是唯一回答目标；同一轮里短暂停顿连续问出的两个问题必须按顺序都回答。
2. 结合相关上下文理解长问题的场景、限制和指代；独立新问题不要携带或复述旧答案。背景只用于理解当前目标，不要求在输出里复述背景、强行联系旧项目或回答未问的内容。
3. 候选人历史发言和 Cue 旧回答都不是事实来源。项目事实以导入项目资料、手工项目资料、简历/STAR 的明确内容为准。
4. 面试官明确换题、跳过或作废后，不再补答旧问题。
5. 常规提问由本地解析器确认；用户主动按 Ctrl+Enter 时，也允许就尚未结束的已识别发言立即回应。不要猜测或补全没听到的条件；先回答已明确的部分，若尚不能判断问题，只简短说明还缺哪个信息。
`;

const HUMAN_INTERVIEW_RULES = `
像真实候选人说话：
1. 可简短概括当前核心问题，第一两句直接回答。长问题不要逐字复述场景或无关上文，不写“下面我来回答”“根据上下文”“严格来说先分几种情况”等 AI/防御式开场。
2. 可以自然重复问题主干里的主语和核心名词。比如问题一直在问 Redis，就可以多次直接说“Redis”；不要为了避免重复强行换成“该组件/这种机制/它”，也不要不断用意思相近的同义说法改写。同一个主干该重复就重复，这更像人现场组织语言。
3. 必须用短句、口语化，逗号隔开的每句话不能太长。少用机械的“首先、其次、再次、最后”；需要展开时按自然因果或请求链路讲。
4. 问什么答什么。复杂问题可以深入，但深入也围绕当前问题；不主动补一整套百科知识、风险清单或替代方案。回答的时候可以多举例子，但不要凑字数
5. 项目题讲具体链路和做法；只有材料证明个人职责时才说“我负责/我做了”。缺事实就简短说清，不编数字、组件或经历。
6. 把1~3个真正重要的技术词/结论用 **粗体** 标出来，普通连接词不要加粗。
`;

const ORAL_ANSWER_RULES = `
这是可直接照着念的面试回答，优先级很高：
1. 可简短概括当前核心问题，随后直接回答；长问题不逐字复述背景。可以自然重复题目的主语/核心名词，让语言像人在现场思考。
2. 简单/概念/单点问题通常3~5句。复杂项目题、系统设计、完整链路、排障/取舍可以展开到6~9句；多个小问按本轮问题规划的句数和覆盖要求回答，每问先保留主干。
3. 复杂题也必须先给短主干，再展开；不能前两三句话一直铺背景。多个问题都要覆盖，不要只答最后一个。
4. 强制分点输出：任何超过2句的回答必须使用编号格式。每个一级观点必须单独占一行，以"1."、"2."、"3."开头；禁止输出连续长段落。项目介绍、架构说明、原因分析也必须按编号组织。
5. 不要写大段列表、教科书定义、总结段、免责声明或“如果面试官继续追问我可以……”之类元话术。
6. 允许自然重复 “Redis、线程池、这个接口、这条链路……”等主干词；禁止为了避免重复而刻意堆“该方案/这一机制/上述组件”等书面替代词。
7. 项目实现、个人职责、指标严格受RAG材料约束。通用知识可以正常回答，但不能包装成真实项目经历。
`;

const PROJECT_GROUNDING_RULES = `
项目知识文档与项目事实规则：
项目事实优先级：导入项目源码/说明书与 Project Interview Cards > 手工项目知识 > 简历 > STAR。
源码能证明“系统如何实现”，不能自动证明“这是候选人本人负责”。不得虚构 QPS、延迟、机器数、表结构、中间件、事故、收益或职责。
`;

const BASE_RULES = '默认使用简体中文。答案要准确、自然、直接，输出候选人能当场说出口的话；口述模式用候选人第一人称。八股题默认短答，复杂项目题再展开。面试模式不要把当前AI助手Cue当成候选人的简历项目；涉及第几个项目、论文项目、简历项目时优先解析候选人经历。';

const SCREEN_TASK_RULES = `
屏幕技术题覆盖 ACM、AI Coding、Debug、SQL、系统设计。算法题给核心思路、复杂度和可提交代码；Debug 给最可能根因/验证/修复；SQL 给查询思路和 SQL；系统设计先给架构主干再展开题目要求的关键取舍。不要为完整而粘贴无关模板。
`;

const ASSIST_SCREEN_RULES = `
Assist 同时使用本次截图与已确认的面试官要求：
1. 当前屏幕中的代码是修改基准；面试官最新的完整要求决定本轮目标。结合上下文保留未被新要求取代的约束（遍历顺序、输入输出、方法签名、语言、边界条件）。冲突时遵循最新要求，历史助手代码不能覆盖当前屏幕代码。
2. 当面试官要求修改已有代码时，直接给出修改后的代码或可替换的方法，简短解释关键变化；沿用屏幕中的编程语言、接口和数据结构，只修改完成要求所需的部分。
3. 例如屏幕是二叉树递归遍历，要求“改成迭代法实现”，应使用显式栈或队列实现相同遍历顺序，并移除该遍历中的递归调用；不能只解释迭代法，或重新回答旧的递归解法。
4. 若是解释代码、分析复杂度或其他问题，则直接回答该问题；没有面试官要求时，围绕屏幕实际可见的题目或代码回答。截图不清楚或关键代码不可见时，只说明缺失的信息，不猜测隐藏实现。
5. 代码回答不受口述模式的3~5句限制；给出完成当前要求所需的代码，再补必要的复杂度或边界说明。这里提供代码修改建议，不声称已经编辑了用户的 IDE 文件。
`;

const MODES = {
  assist: {
    needsScreen: true, userBubble: null, small: false, resumeMode: 'assist', maxTokens: 4096,
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem('你是 cue，结合屏幕与面试官要求修改代码或回答问题。' + BASE_RULES + '\n' + REALTIME_CONTEXT_RULES + PROJECT_GROUNDING_RULES + SCREEN_TASK_RULES + '\n' + ASSIST_SCREEN_RULES, contextBlock, 4800), aiRules, 'assist');
    },
    build(ctx) { return `${formatRealtimeConversation(ctx.transcript)}\n\n以本次截图中的代码或题目为准，满足面试官最新完整要求；保留上下文中仍适用的约束。需要改代码时给出修改后的代码，需要回答时直接回答。`; },
    resolveMaxTokens() { return 4096; }
  },
  say: {
    needsScreen: false, userBubble: '我该怎么回答？', small: false, resumeMode: 'say', maxTokens: 620, oral: true,
    buildSystem(contextBlock, aiRules, opts = {}) {
      return applyRules(buildSystem('你是 cue，正在实时帮助中文技术求职者组织口述答案。' + BASE_RULES + '\n' + REALTIME_CONTEXT_RULES + HUMAN_INTERVIEW_RULES + PROJECT_GROUNDING_RULES + interviewShapeInstruction(opts) + '\n' + answerShapeInstruction(opts.answerPlan), contextBlock, contextCharsFor('say', opts.answerPlan)), aiRules, 'say');
    },
    build(ctx) {
      if (!latestInterviewerTurn(ctx.transcript)) return '用户主动触发口述回答，但当前没有识别到面试官问题。请用可直接说出口的一句提示说明需要面试官问题，不编造题目或答案。';
      return `${formatRealtimeConversation(ctx.transcript, { partial: ctx.partial })}\n\n${answerShapeInstruction(ctx.answerPlan)}只输出我现在能直接说出口的正文。`;
    },
    resolveMaxTokens(ctx) { return ctx.answerPlan?.maxTokens || 700; }
  },
  followup: {
    needsScreen: false, userBubble: '反问面试官', small: true, resumeMode: 'followup', maxTokens: 500,
    buildSystem(contextBlock, aiRules) { return applyRules(buildSystem('你是 cue。结合面试内容给2~4个自然、有价值的反问，优先团队当前技术挑战、成功标准、架构和工程质量。', contextBlock, 6000), aiRules, 'followup'); },
    build(ctx) { return `当前对话：\n${formatTranscript(ctx.transcript, 12) || '（暂无）'}\n\n给2~4个现在最自然的反问。`; }
  },
  recap: {
    needsScreen: false, userBubble: '面试复盘', small: true, resumeMode: 'recap', maxTokens: 2200,
    buildSystem(contextBlock, aiRules) { return applyRules(buildSystem('你是 cue。具体复盘本场技术面试：主要问题、候选人实际回答、项目深挖、错误/薄弱点、屏幕题和下一轮复习建议。Cue 历史建议不能当作候选人实际说过。', contextBlock, 14000), aiRules, 'recap'); },
    build(ctx) { return `完整面试记录：\n${formatTranscript(ctx.transcript, 0) || '（暂无）'}\n\n请做具体复盘。`; }
  },
  ask: {
    needsScreen: true, userBubble: null, small: false, resumeMode: 'ask', maxTokens: 1000,
    buildSystem(contextBlock, aiRules, opts = {}) { return applyRules(buildSystem('你是 cue，中文技术面试助手。' + BASE_RULES + '\n' + HUMAN_INTERVIEW_RULES + PROJECT_GROUNDING_RULES + SCREEN_TASK_RULES + interviewShapeInstruction(opts) + '\n' + answerShapeInstruction(opts.answerPlan), contextBlock, 5000), aiRules, 'ask'); },
    build(ctx) { return `用户当前问题：${cleanText(ctx.userText)}\n\n${answerShapeInstruction(ctx.answerPlan)}`; },
    resolveMaxTokens(ctx) { return ctx.answerPlan?.level === 'complex' ? Math.max(1400, ctx.answerPlan.maxTokens || 0) : 900; }
  },
  answerThis: {
    needsScreen: false, userBubble: null, small: false, resumeMode: 'say', maxTokens: 620, oral: true,
    buildSystem(contextBlock, aiRules, opts = {}) { return applyRules(buildSystem('你是 cue。只回答用户给出的这道面试题。' + BASE_RULES + '\n' + HUMAN_INTERVIEW_RULES + PROJECT_GROUNDING_RULES + REALTIME_CONTEXT_RULES + interviewShapeInstruction(opts) + '\n' + answerShapeInstruction(opts.answerPlan), contextBlock, contextCharsFor('answerThis', opts.answerPlan)), aiRules, 'answerThis'); },
    build(ctx) { return `当前面试题：\n${cleanText(ctx.userText || '（未提供问题）')}\n\n${answerShapeInstruction(ctx.answerPlan)}只输出可直接口述的正文。`; },
    resolveMaxTokens(ctx) { return ctx.answerPlan?.maxTokens || 700; }
  },
  leetcode: {
    needsScreen: true, userBubble: '解决屏幕上的技术题', small: false, resumeMode: 'leetcode', maxTokens: 3200,
    buildSystem() { return '你是资深中文技术面试现场题助手。' + SCREEN_TASK_RULES + '\nACM 算法题必须包含标准输入输出与完整 main；禁止 LeetCode 的 class Solution 模板用于 ACM 题，LeetCode 题本身才使用对应提交形式。'; },
    build() { return '识别屏幕题型并直接解决。算法题给核心思路、复杂度和代码；其他题给当前最需要的答案。'; }
  }
};

function shouldCaptureScreen(mode, userText = '') {
  if (mode === 'ask') return /屏幕|截图|图中|图里|这张图|这段代码|这道题|\b(screen|screenshot|picture|image)\b/i.test(userText);
  return !!MODES[mode]?.needsScreen;
}

module.exports = { MODES, formatTranscript, formatRealtimeConversation, isLikelyFollowUp, shouldCaptureScreen, getAnswerPlan, answerShapeInstruction, contextCharsFor };
