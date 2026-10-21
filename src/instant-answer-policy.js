'use strict';

const { shouldCaptureScreen } = require('./prompts');
const INSTANT_LIMITS = Object.freeze({ fixedTokens: 400, historyTokens: 250,
  evidenceTokens: 650, softInputTokens: 2200, maxCandidates: 8, maxSources: 3 });

function resolveInstantPolicy(settings = {}, mode, question = '') {
  const eligible = ['say', 'answerThis', 'ask'].includes(mode) && !shouldCaptureScreen(mode, question);
  const instant = settings.realtimeAnswerMode !== 'standard' && eligible;
  return { instant, executionProfile: instant && settings.instantExperiment !== 'context-only' ? 'instant' : 'standard',
    ragPolicy: settings.instantExperiment === 'rag-off' || instant && settings.instantRagPolicy === 'off' ? 'off'
      : instant ? 'ready-only' : 'standard', limits: INSTANT_LIMITS };
}

function isolateUnknownProject(question, plan, catalog = []) {
  const normalize = text => String(text || '').toLowerCase().replace(/[\s_\-]/g, '');
  const named = [...String(question).matchAll(/([\p{L}\p{N}_.-]{2,64})\s*项目/gu)].map(match =>
    match[1].replace(/^(?:请)?(?:介绍一下|介绍|讲讲|说说|关于|你在|我在|在|你的|我的)/, ''));
  named.push(...[...String(question).matchAll(/(?:你|您|我)在\s*([\p{L}\p{N}_.-]{2,32}?)\s*(?:的|中|里)/gu)].map(match => match[1]));
  const deictic = /^(?:这个|那个|你们|我们|当前的?|刚才(?:那个)?|之前(?:那个|的)?|上一个|第[一二三四五六七八九十\d]+个|简历(?:上的|上|中)?|自己|个人|整个)$/;
  const names = catalog.flatMap(p => [p.name, p.label, p.profile?.label, ...(p.aliases || []), ...(p.profile?.aliases || [])]).filter(Boolean).map(normalize);
  const explicitMentions = (plan.projectMentions || []).filter(m => !m.excluded).map(m => normalize(String(question).slice(m.start, m.end)));
  const unknown = named.find(name => !deictic.test(name) && name.length >= 2 && !names.includes(normalize(name)) &&
    !explicitMentions.some(mention => mention.includes(normalize(name))) && normalize(name) !== normalize(plan.projectLabel));
  if (!unknown) return plan;
  return { ...plan, retrieve: true, scopes: [], projectIds: [], projectLabel: unknown, activeProject: null,
    projectSwitched: !!plan.activeProject, reason: 'unresolved-project', anchor: question,
    subQuestionScopes: (plan.subQuestionScopes || []).map(sub => ({ ...sub, scopes: [] })) };
}

module.exports = { INSTANT_LIMITS, resolveInstantPolicy, isolateUnknownProject };
