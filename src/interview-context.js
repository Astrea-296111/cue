// interview-context.js
// 面向中文技术面试的上下文路由：优先识别“当前面试官问题”，
// 只有明显追问时才借用前几轮 interviewer 上下文。

const { buildProjectContext } = require('./project-context');
const { selectRelevantText } = require('./conversation-memory');
const { selectManualProjectCards } = require('./project-profile');
const { parseManualProjectProfile, TOPICS } = require('./project-profile');
const { tokenize } = require('./project-search');
const { createHash } = require('crypto');
const { RESUME_PROJECTS, resolveResumeProject } = require('./resume-project-resolver');
const { planProjectRetrieval } = require('./project-query');
const { getProjectCatalog } = require('./project-knowledge');
const { retrieveProjectEvidenceAsync } = require('./retrieval-coordinator');
const { selectEvidence, inferDocType, evidenceId } = require('./evidence-selector');
const { activeProjectContextCache } = require('./project-context');
const { formatRetrievedProjectContext } = require('./project-knowledge');

const CATEGORY_PATTERNS = {
  project: [
    /项目.*(架构|难点|职责|技术选型|为什么|怎么做|怎么实现|性能|优化|故障|压测|qps|延迟|一致性|高可用|扩容|复盘)/i,
    /(介绍|讲讲|说说|展开|深挖).{0,12}(项目|系统|服务|平台)/i,
    /(你|您).{0,8}(项目|简历).{0,20}(怎么|为什么|如何|负责|做了什么)/i,
    /tell me more about (the|your) project/i,
    /walk me through (the|your) project/i,
    /why did you (choose|use)/i,
  ],
  behavioral: [
    /讲一个.*(经历|例子|故事)/i, /有没有.*(经历|例子)/i, /遇到过.*(冲突|失败|压力|困难|挑战)/i,
    /你是怎么.*(处理|推动|协调|解决)/i, /最大的(挑战|失败|成就|收获)/i,
    /tell me about a time/i, /give me an example/i, /describe a situation/i,
    /how did you handle/i, /have you ever/i, /under pressure/i, /tight deadline/i,
  ],
  motivation: [
    /为什么(想来|选择|投|考虑).*(公司|岗位|我们)/i, /为什么离职/i, /职业规划/i,
    /为什么要招你/i, /你的优势/i, /你的缺点/i, /五年.*规划/i,
    /why (do you want|are you interested|this company|this role|us|here)/i,
    /why should we hire/i, /career goals/i,
  ],
  situational: [
    /如果.*你会怎么/i, /假设.*怎么/i, /线上.*(故障|事故|宕机).*怎么/i,
    /怎么做技术选型/i, /怎么排查/i, /如何权衡/i, /如何推进/i,
    /what would you do if/i, /how would you (handle|approach|deal with)/i,
    /production (outage|incident|down)/i,
  ],
  experience: [
    /自我介绍/i, /介绍一下自己/i, /讲讲你的经历/i, /最近一段工作/i, /主要负责什么/i,
    /技术栈/i, /日常工作/i, /简历/i,
    /tell me about yourself/i, /walk me through your (resume|background|experience|role|career)/i,
    /what (were you responsible|did you do|was your role)/i,
  ],
  compensation: [
    /薪资/i, /期望薪资/i, /多久(能|可以)入职/i, /到岗/i, /offer/i, /还有什么问题/i, /反问/i,
    /salary/i, /compensation/i, /notice period/i, /start date/i, /questions for (us|me)/i,
  ],
  technical: [
    /什么是/i, /说一下/i, /讲一下/i, /原理/i, /底层/i, /区别/i, /对比/i, /优缺点/i,
    /jvm/i, /gc/i, /jmm/i, /hashmap/i, /线程池/i, /spring/i, /事务/i,
    /mysql/i, /redis/i, /mq/i, /kafka/i, /rocketmq/i, /rpc/i, /微服务/i, /分布式/i,
    /goroutine/i, /channel/i, /\bgmp\b/i, /context/i, /逃逸分析/i, /pprof/i,
    /\brag\b/i, /react/i, /function calling/i, /tool calling/i, /\bmcp\b/i, /\ba2a\b/i,
    /agent/i, /workflow/i, /memory/i, /embedding/i, /rerank/i, /langgraph/i, /harness/i,
    /system design/i, /design (a|an|the)/i, /difference between/i, /how does .* work/i,
    /algorithm/i, /complexity/i, /data structure/i, /architecture/i, /trade.?off/i,
  ],
};

const FOLLOWUP_RE = /^(那|那么|所以|然后|再|继续|具体|为什么|怎么|如何|这个|这种|这里|刚才|你刚才|你提到|你说|如果是这样|基于这个)|刚才|前面|上一个|你提到|你说的|你刚刚|继续说|展开一下|再详细|那如果|^(and|so|then|why|how|what about|you mentioned|you said|can you elaborate|could you expand)/i;

function classifyText(text) {
  const value = String(text || '').trim();
  if (!value) return 'general';

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some((re) => re.test(value))) return category;
  }

  return 'general';
}

function detectCategory(transcript) {
  const themTurns = (Array.isArray(transcript) ? transcript : [])
    .filter((t) => t && t.channel === 'them' && String(t.text || '').trim())
    .slice(-5);

  if (!themTurns.length) return 'general';

  const latestText = String(themTurns[themTurns.length - 1].text || '').trim();
  const latestCategory = classifyText(latestText);

  // Independent new questions are classified only from the latest interviewer
  // turn so an old project/behavioral question cannot contaminate a new topic.
  if (latestCategory !== 'general') return latestCategory;

  const compact = latestText.replace(/\s+/g, '');
  const looksLikeFollowup =
    FOLLOWUP_RE.test(latestText) ||
    (compact.length <= 12 && /[？?呢吗嘛啊呀]|why|how/i.test(compact));

  if (!looksLikeFollowup) return 'general';

  // Only ambiguous / referential follow-ups inherit a little interviewer context.
  const followupContext = themTurns
    .slice(-3)
    .map((t) => String(t.text || '').trim())
    .join(' ');

  return classifyText(followupContext);
}

const SECTION_PATTERNS = [
  { key: 'name',       re: null, label: null },
  { key: 'summary',    re: /(?:summary|objective|profile|about|个人总结|个人简介|简介)[^\n]*\n([\s\S]{20,500}?)(?=\n[A-Z\u4e00-\u9fa5]|\n\n[A-Z\u4e00-\u9fa5]|$)/i, label: '个人简介' },
  { key: 'experience', re: /(?:experience|work history|employment|工作经历|实习经历)[^\n]*\n([\s\S]{20,2200}?)(?=\n(?:education|skills|projects|certif|awards|教育|技能|项目|证书|荣誉|$))/i, label: '工作经历' },
  { key: 'skills',     re: /(?:skills?|technical skills?|competencies|tech stack|技能|专业技能|技术栈)[^\n]*\n([\s\S]{10,800}?)(?=\n(?:experience|education|projects|certif|awards|work|工作|教育|项目|证书|$))/i, label: '技能' },
  { key: 'education',  re: /(?:education|academic|教育经历|教育背景)[^\n]*\n([\s\S]{10,500}?)(?=\n(?:experience|skills|projects|certif|awards|work|工作|技能|项目|证书|$))/i, label: '教育经历' },
  { key: 'projects',   re: /(?:projects?|portfolio|项目经历|项目)[^\n]*\n([\s\S]{10,1400}?)(?=\n(?:experience|education|skills|certif|awards|work|工作|教育|技能|证书|$))/i, label: '项目经历' },
];

function parseResume(text) {
  if (!text || !text.trim()) return null;
  const clean = text.trim();
  const sections = {};
  const firstLine = clean.split('\n').find((l) => l.trim().length > 1 && l.trim().length < 80);
  if (firstLine) sections.name = firstLine.trim();

  for (const { key, re } of SECTION_PATTERNS) {
    if (!re) continue;
    const match = re.exec(clean);
    if (match && match[1]) {
      sections[key] = match[1]
        .trim()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
    }
  }

  return { sections, raw: clean, parsed: Object.keys(sections).length > 1 };
}

function clip(text, limit) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + '…';
}

function buildResumeBlock(resumeText, limit = 2600) {
  if (!resumeText || !resumeText.trim()) return '';
  const parsed = parseResume(resumeText);
  if (!parsed) return '';

  if (parsed.parsed) {
    const parts = [];
    let remaining = limit;
    const order = ['name', 'summary', 'experience', 'skills', 'projects', 'education'];

    for (const key of order) {
      if (remaining <= 0) break;
      const value = parsed.sections[key];
      if (!value) continue;

      const sectionPattern = SECTION_PATTERNS.find((item) => item.key === key);
      const label = sectionPattern && sectionPattern.label;
      const chunk = label
        ? `${label}：\n${clip(value, Math.min(Math.max(remaining - label.length - 2, 0), 1000))}`
        : clip(value, 80);

      if (chunk) {
        parts.push(chunk);
        remaining -= chunk.length;
      }
    }

    return parts.join('\n\n');
  }

  return clip(parsed.raw, limit);
}

function buildJDBlock(jd, limit = 800) {
  if (!jd || !jd.trim()) return '';
  return '=== 目标岗位 / JD ===\n' + clip(jd.trim().replace(/\s+/g, ' '), limit);
}

// Select a project block before applying existing size limits. Truncating the
// whole resume first can leave only the preceding project's facts.
function selectProjectSection(text, plan) {
  if (!plan?.retrieve || plan.scopes?.length !== 1) return null;
  const label = plan.projectLabel || plan.activeProject?.label || '';
  if (!label) return null;
  const catalog = getProjectCatalog({ preparedOnly: !!plan.preparedOnly });
  const configured = catalog.find(project => plan.scopes.includes(project.prefix) || project.name === label || (project.aliases || []).includes(label));
  const target = configured ? { ...configured, key: configured.projectId || configured.name,
    aliases: configured.aliases || [configured.name] } : resolveResumeProject(label) || { key: label, name: label, aliases: [label] };
  const catalogProjects = catalog.map(project => ({ ...project, key: project.projectId || project.name, aliases: project.aliases || [project.name] }));
  const projects = [...catalogProjects, ...RESUME_PROJECTS.filter(project => !catalogProjects.some(item => item.name === project.name)),
    ...(!catalogProjects.some(project => project.key === target.key) && !RESUME_PROJECTS.some(project => project.key === target.key) ? [target] : [])];
  const parts = [];
  let selected = false, recognized = false;
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.trim().replace(/^#{1,6}\s+/, '').replace(/^\d+[.)、]\s*/, '');
    const project = heading.length <= 160 && projects.find(project =>
      [project.key, project.name, ...project.aliases].some(alias => {
        const value = heading.normalize('NFKC').toLowerCase();
        const name = alias.normalize('NFKC').toLowerCase();
        return value.startsWith(name) && !/[a-z0-9_]/i.test(value[name.length] || '');
      }));
    if (project) {
      recognized = true;
      selected = project.key === target.key || project.name === target.name;
    } else if (/^(?:教育(?:经历|背景)|工作经历|实习经历|技能|专业技能|education|experience|skills)\s*[:：]?$/i.test(heading)) {
      selected = false;
    }
    if (selected) parts.push(line);
  }
  // Unstructured material keeps the existing selection behavior. If project
  // headings exist but the selected project is absent, omit unrelated blocks.
  return recognized ? parts.join('\n').trim() : null;
}

function buildCandidateContext(settings, mode, transcript, projectRelevant = false, query = '', projectPlan = null) {
  if (mode === 'leetcode') return null;

  const category = projectRelevant ? 'project' : detectCategory(transcript || []);
  const resume = settings.resumeText || '';
  const project = selectProjectSection(settings.projectKnowledge, projectPlan) ?? (settings.projectKnowledge || '');
  const jd = settings.jobDescription || '';
  const stories = settings.starStories || '';
  const whyCo = settings.whyCompany || '';
  const whyLeave = settings.whyLeaving || '';
  const workStyle = settings.workStyle || '';
  const salary = settings.salaryTarget || '';
  const questions = settings.questionsToAsk || '';

  const hasResume = resume.trim().length > 0;
  const hasProject = project.trim().length > 0;
  const hasStories = stories.trim().length > 0;
  const hasJD = jd.trim().length > 0;
  const blocks = [];

  const realtime = ['say', 'answerThis', 'assist', 'ask', 'technical'].includes(mode);
  if ((projectRelevant || (!realtime && category === 'project')) && hasProject) {
    const projectLimit = realtime ? 1800 : 3000;
    const selected = selectManualProjectCards(project.trim(), query, projectLimit) ||
      selectRelevantText(project.trim(), query, projectLimit);
    blocks.push(
      '=== 项目面试卡片（用户提供的项目事实与个人职责） ===\n' + selected
    );
  }

  if (hasResume) {
    const relevantResume = ['behavioral', 'experience', 'project', 'motivation'].includes(category) || projectRelevant;
    const resumeLimit = relevantResume ? (realtime ? 1500 : 2600) : (realtime ? 0 : 850);
    const selectedResume = selectProjectSection(resume, projectPlan);
    const rb = resumeLimit ? (selectedResume === null
      ? buildResumeBlock(resume, resumeLimit) : clip(selectedResume, resumeLimit)) : '';
    if (rb) blocks.push('=== 候选人简历 ===\n' + rb);
  }

  if (hasJD && (!realtime || ['behavioral', 'experience', 'project', 'motivation'].includes(category))) {
    blocks.push(buildJDBlock(jd, realtime ? 320 : 650));
  }

  switch (category) {
    case 'project':
      if (!hasProject) {
        blocks.push(
          '（未提供手工项目知识文档。）'
        );
      }
      if (hasStories) {
        const selected = selectProjectSection(stories, projectPlan);
        if (selected) blocks.push('=== 与项目相关的 STAR/亮点 ===\n' + selectRelevantText(selected, query, 900));
      }
      break;

    case 'behavioral':
      if (hasStories) {
        blocks.push(
          '=== STAR 故事 ===\n' +
          selectRelevantText(stories.trim(), query, 2100) +
          '\n回答行为题时优先复用真实故事：背景 -> 任务 -> 我的行动 -> 结果/复盘。'
        );
      } else {
        blocks.push('（未提供 STAR 故事。）');
      }
      if (workStyle) blocks.push('=== 工作方式 / 价值观 ===\n' + clip(workStyle, 450));
      break;

    case 'motivation':
      if (whyCo) blocks.push('=== 为什么这家公司 / 岗位 ===\n' + clip(whyCo, 550));
      if (whyLeave) blocks.push('=== 离职原因 ===\n' + clip(whyLeave, 350));
      if (workStyle) blocks.push('=== 工作偏好 ===\n' + clip(workStyle, 350));
      break;

    case 'situational':
      if (workStyle) blocks.push('=== 决策与协作风格 ===\n' + clip(workStyle, 500));
      if (hasStories) blocks.push('=== 可参考的历史经历 ===\n' + selectRelevantText(stories, query, 750));
      break;

    case 'compensation':
      if (salary) blocks.push('=== 薪资期望 ===\n' + salary);
      if (questions) blocks.push('=== 准备好的反问 ===\n' + clip(questions, 700));
      break;

    case 'technical':
      // Generic technical questions need no synthetic candidate evidence.
      break;

    default:
      if (hasStories) blocks.push('=== 关键经历亮点 ===\n' + selectRelevantText(stories, query, 550));
      if (workStyle) blocks.push('=== 工作方式 ===\n' + clip(workStyle, 300));
      break;
  }

  if (!blocks.length) return null;

  return blocks.join('\n\n');
}

function manualProjectEvidence(settings, plan) {
  if (!plan?.retrieve || !plan.scopes?.length) return [];
  const raw = String(settings.projectKnowledge || '').replace(/\r\n?/g, '\n');
  const selected = selectProjectSection(raw, plan) ?? raw;
  const profile = parseManualProjectProfile(selected);
  const query = plan.query || '', terms = new Set(tokenize(query, true));
  const revision = 'manual:' + createHash('sha256').update(selected).digest('hex').slice(0, 24);
  const ranked = profile.cards.map((card, index) => ({ card, index,
    score: card.terms.filter(term => terms.has(term)).length +
      (TOPICS.some(topic => topic.re.test(query) && card.topics.includes(topic.key)) ? 4 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let remaining = 1800;
  const evidence = [];
  for (const { card, score } of ranked.slice(0, 3)) {
    if (remaining < 100 || (!score && evidence.length)) break;
    const at = raw.indexOf(card.text);
    // Keep exact user-provided source locations instead of assigning the
    // generated Interview Card label a fictional file/line range.
    if (at < 0) continue;
    const text = card.text.slice(0, remaining), startLine = raw.slice(0, at).split('\n').length;
    evidence.push({ sourceType: 'manual', path: 'settings.projectKnowledge', text, startLine,
      endLine: startLine + (text.match(/\n/g) || []).length, topics: card.topics, revision,
      scopes: [...plan.scopes], scopeKey: [...plan.scopes].sort().join('|'),
      projectId: plan.activeProject?.projectId || null, projectName: plan.projectLabel || '',
      partial: text.length < card.text.length });
    remaining -= text.length;
  }
  return evidence;
}

function buildInterviewContextBundle(settings, mode, transcript, request = {}) {
  if (mode === 'leetcode') return { context: null, evidence: [], plan: request.projectPlan || null, stats: {} };
  const plan = request.projectPlan || planProjectRetrieval(transcript, mode, { catalog: getProjectCatalog() });
  const base = buildCandidateContext(settings, mode, transcript, plan.retrieve, plan.query, plan);
  const budget = Number.isFinite(request.contextBudget) ? Math.max(0, request.contextBudget) : null;
  let candidate = base || '';
  if (budget !== null && candidate.length) {
    const candidateBudget = Math.min(candidate.length, plan.retrieve ? Math.min(1200, Math.floor(budget / 3)) : budget);
    // Short factual bundles already fit. Equal section shares would otherwise
    // truncate a project card even with unused space after shorter résumé/JD.
    if (candidate.length > candidateBudget) {
      const sections = candidate.split(/\n\n(?==== )/);
      let room = candidateBudget;
      candidate = sections.map((section, index) => {
        const allocated = Math.max(0, Math.floor((room - (sections.length - index - 1) * 2) / (sections.length - index)));
        const selected = section.slice(0, allocated);
        room -= selected.length + 2;
        return selected;
      }).filter(Boolean).join('\n\n');
    }
  }
  const sourceBudget = budget === null ? undefined : Math.max(0, budget - candidate.length - (candidate ? 2 : 0));
  const { context, evidence, stats } = buildProjectContext(transcript, mode,
    { ...request, projectPlan: plan, projectContextBudget: sourceBudget });
  // Only record evidence that actually reached the prompt. Imported source
  // selection respects the shared budget; hidden manual tails stay unrecorded.
  const visible = evidence.filter(item => context?.includes(item.text));
  const manual = manualProjectEvidence(settings, plan).filter(item => candidate.includes(item.text));
  return { context: [context, candidate].filter(Boolean).join('\n\n') || null,
    evidence: [...visible, ...manual], plan, stats: { ...stats, contextBudget: budget } };
}

function legacySourceEvidence(rawValue, path, plan, { stories = false } = {}) {
  if (!plan?.retrieve || plan.scopes?.length !== 1) return [];
  const raw = String(rawValue || '');
  if (!raw.trim()) return [];
  const bound = selectProjectSection(raw, plan);
  // A legacy story without a project label is not automatically the personal
  // history of every imported project. Keep it available for general behavior
  // questions, and recommend importing labeled Markdown for project drilling.
  if (stories && bound === null) return [];
  const selected = bound ?? raw;
  if (!selected) return [];
  const revision = 'manual:' + createHash('sha256').update(raw).digest('hex').slice(0, 24);
  const cards = parseManualProjectProfile(selected).cards;
  return cards.map(card => {
    const at = raw.indexOf(card.text);
    if (at < 0) return null;
    const item = { sourceType: 'manual', provenance: 'user_authored', path, revision,
      projectId: plan.activeProject?.projectId || (plan.scopes[0].startsWith('@project:') ? plan.scopes[0].slice(9) : null),
      projectName: plan.projectLabel || '', scopes: [...plan.scopes], text: card.text,
      startOffset: at, endOffset: at + card.text.length,
      startLine: raw.slice(0, at).split('\n').length,
      endLine: raw.slice(0, at + card.text.length).split('\n').length,
      truthScope: 'unverified', status: 'draft', headingPath: [card.title], topics: card.topics,
      score: .02, partial: false };
    item.docType = inferDocType(item); item.id = evidenceId(item); return item;
  }).filter(Boolean);
}

async function buildInterviewContextBundleAsync(settings, mode, transcript, request = {}) {
  if (mode === 'leetcode') return { context: null, evidence: [], plan: request.projectPlan || null,
    byQuestion: [], missing: [], stats: {} };
  const plan = request.projectPlan || planProjectRetrieval(transcript, mode,
    { catalog: getProjectCatalog(), interviewPlan: request.interviewPlan });
  // Old installations can have only a hand-written, unstructured project
  // paragraph. Preserve that input without issuing an unscoped index search
  // or inventing an imported project identity for it.
  if (plan.retrieve && !plan.scopes?.length && String(settings.projectKnowledge || '').trim() &&
      !/^#{1,6}\s/m.test(settings.projectKnowledge) && !getProjectCatalog({ preparedOnly: !!plan.preparedOnly }).length) {
    const legacy = buildInterviewContextBundle(settings, mode, transcript, { ...request, projectPlan: plan });
    return { ...legacy, byQuestion: [], missing: [{ reason: 'manual-project-unbound',
      message: '手工资料尚未绑定稳定项目；选型、职责与指标只能依据其明确原文。' }],
      stats: { ...legacy.stats, fallbackReason: 'manual-project-unbound' } };
  }
  const query = request.interviewPlan?.originalText || plan.question || plan.query || '';
  const budget = Number.isFinite(request.contextBudget) ? Math.max(0, request.contextBudget) : 4800;
  let candidate = buildCandidateContext(plan.retrieve ? { ...settings, projectKnowledge: '', starStories: '' } : settings,
    mode, transcript, plan.retrieve, query, plan) || '';
  if (plan.retrieve) candidate = candidate.replace(/\n?（未提供手工项目知识文档。）\n?/g, '').trim();
  const candidateLimit = plan.retrieve ? Math.min(1200, Math.floor(budget / 3)) : budget;
  if (candidate.length > candidateLimit) candidate = selectRelevantText(candidate, query, candidateLimit);
  const sourceBudget = Math.max(0, budget - candidate.length - (candidate ? 2 : 0));
  const retrieved = await retrieveProjectEvidenceAsync({ ...request, question: query, projectPlan: plan,
    contextBudget: sourceBudget, includeCandidates: true, projectContextCache: request.projectContextCache || activeProjectContextCache });
  let selected = retrieved;
  if (plan.retrieve) {
    const manual = [...legacySourceEvidence(settings.projectKnowledge, 'settings.projectKnowledge', plan),
      ...legacySourceEvidence(settings.starStories, 'settings.starStories', plan, { stories: true })];
    if (manual.length) selected = { ...retrieved, ...selectEvidence({ candidates: [...(retrieved.candidates || retrieved.evidence), ...manual],
      question: query, interviewPlan: request.interviewPlan, projectPlan: plan, contextBudget: sourceBudget,
      formatContext: formatRetrievedProjectContext,
      unretrieved: retrieved.missing.filter(item => item.reason === 'group-limit') }) };
  }
  const context = [selected.context, candidate].filter(Boolean).join('\n\n') || null;
  const visible = selected.evidence.filter(item => context?.includes(`[来源 ${item.id}]`) && context.includes(item.text));
  return { context, evidence: visible, plan, byQuestion: selected.byQuestion || [], missing: selected.missing || [],
    revision: retrieved.revision, identity: retrieved.identity,
    ...(request.includeCandidates ? { candidates: retrieved.candidates } : {}),
    stats: { ...retrieved.stats, ...selected.stats, contextBudget: budget, contextChars: context?.length || 0 } };
}

function buildInterviewContext(settings, mode, transcript, request = {}) {
  return buildInterviewContextBundle(settings, mode, transcript, request).context;
}

function buildResumeContext(resumeText, jobDescription, mode) {
  if (!resumeText || !String(resumeText).trim()) return null;

  if (typeof jobDescription === 'number') {
    const cleaned = String(resumeText).trim().replace(/\s+/g, ' ');
    const limit = jobDescription || 1200;
    const clipped = cleaned.length > limit
      ? cleaned.slice(0, limit).trimEnd() + '…'
      : cleaned;

    return [
      '候选人简历参考：',
      clipped,
      '回答候选人背景相关问题时，以这份简历为事实依据。'
    ].join('\n');
  }

  const rb = buildResumeBlock(resumeText, 2000);
  const jb = buildJDBlock(jobDescription || '', 700);
  const parts = [];

  if (rb) parts.push('=== 候选人简历 ===\n' + rb);
  if (jb) parts.push(jb);

  return parts.length ? parts.join('\n\n') : null;
}

module.exports = {
  buildInterviewContext,
  buildInterviewContextBundle,
  buildInterviewContextBundleAsync,
  buildResumeContext,
  detectCategory,
  parseResume
};
