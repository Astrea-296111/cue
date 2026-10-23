'use strict';

const { shouldCaptureScreen } = require('./prompts');
const INSTANT_LIMITS = Object.freeze({ fixedTokens: 400, historyTokens: 250,
  evidenceTokens: 650, softInputTokens: 2200, maxCandidates: 8, maxSources: 3 });

function resolveInstantPolicy(settings = {}, mode, question = '') {
  const eligible = ['say', 'answerThis', 'ask'].includes(mode) && !shouldCaptureScreen(mode, question);
  const instant = settings.realtimeAnswerMode !== 'standard' && eligible;
  const modePolicy = settings.sourceRagPolicies?.[instant ? 'instant' : 'standard'];
  const ragPolicy = settings.instantExperiment === 'rag-off' ? 'off' : modePolicy || (instant ? settings.instantRagPolicy === 'off' ? 'off' : 'ready-only' : 'standard');
  return { instant, factsEnabled: settings.projectFactsEnabled !== false,
    executionProfile: instant && settings.instantExperiment !== 'context-only' ? 'instant' : 'standard',
    ragPolicy: instant && ragPolicy === 'standard' ? 'ready-only' : ['off','ready-only','standard'].includes(ragPolicy) ? ragPolicy : 'ready-only', limits: INSTANT_LIMITS };
}

function isolateUnknownProject(question, plan, catalog = []) {
  if(plan.reason==='topic-exit'||require('./project-query').isClearProjectExit(question))return plan;
  const normalize = text => String(text || '').toLowerCase().replace(/[\s_\-]/g, '');
  const named = [...String(question).matchAll(/([\p{L}\p{N}_.-]{2,64})\s*项目/gu)].map(match => ({
    name: match[1].replace(/^(?:(?:请)?(?:再|那|那么|我们只问|只问|介绍一下|介绍|讲讲|说说|关于|深挖一下|回到|你在|我在|在|你的|我的))+/, '').replace(/(?:这个|那个)$/, ''),
    nounEnd: match.index + match[0].lastIndexOf('项目')
  }));
  const deictic = /^(?:|这个|那个|你的|我的|你们|我们|当前的?|刚才(?:那个)?|之前(?:那个|的)?|上一个|第[一二三四五六七八九十\d]+个|简历(?:上的|上|中)?|自己|个人|整个)$/;
  const names = catalog.flatMap(p => [p.name, p.label, p.profile?.label, ...(p.aliases || []), ...(p.profile?.aliases || [])]).filter(Boolean).map(normalize);
  const explicitMentions = (plan.projectMentions || []).filter(m => !m.excluded).map(m => normalize(String(question).slice(m.start, m.end)));
  // A known name can be followed by a generic description in the same noun
  // phrase ("Arclight 个人实验项目"). That description is not another project.
  // Keep the vocabulary narrow and require an uninterrupted suffix so a real
  // unknown name elsewhere, or after a conjunction, still remains isolated.
  const describesKnown = item => (plan.projectMentions || []).some(mention => !mention.excluded && mention.end <= item.nounEnd &&
    /^(?:\s*的)?\s*(?:个人(?:实验|练习|开源|学习|演示|测试)?|实验|练习|开源|学习|演示|测试|课程|毕业设计)(?:性)?\s*$/.test(String(question).slice(mention.end, item.nounEnd)));
  const unknown = named.find(item => !deictic.test(item.name) && item.name.length >= 2 && !names.includes(normalize(item.name)) &&
    !explicitMentions.some(mention => mention.includes(normalize(item.name))) && normalize(item.name) !== normalize(plan.projectLabel) && !describesKnown(item));
  if (!unknown) return plan;
  return { ...plan, retrieve: true, scopes: [], projectIds: [], projectLabel: unknown.name, activeProject: null,
    projectSwitched: !!plan.activeProject, reason: 'unresolved-project', anchor: question,
    subQuestionScopes: (plan.subQuestionScopes || []).map(sub => ({ ...sub, scopes: [] })) };
}

module.exports = { INSTANT_LIMITS, resolveInstantPolicy, isolateUnknownProject };
