'use strict';
const DOMAINS = ['arclight', 'cae', 'general'];
function migrate(raw = {}) {
  if (raw.answerDomain === 'auto' || DOMAINS.includes(raw.answerDomain)) return {};
  const id = String(raw.currentProjectId || '').toLowerCase();
  return { answerDomain: DOMAINS.includes(id) && id !== 'general' ? id : 'general',
    answerDomainMigration: { version: 1, previousProjectId: raw.currentProjectId || '', source: 'currentProjectId' } };
}
function constrain(plan, domain, question, catalog = []) {
  if (!DOMAINS.includes(domain)) return plan; // legacy callers retain their existing contract
  const names = catalog.filter(p => p.kind !== 'knowledge' && [p.name, ...(p.aliases || [])]
    .some(n => n && String(question).toLowerCase().includes(n.toLowerCase())));
  const other = names.find(p => (p.id || p.projectId) !== domain);
  const switchHint = other && domain !== 'general' ? '当前使用所选项目资料；切换按钮可选择其他项目。' : '';
  if (domain === 'general') return { ...plan, answerDomain: domain, switchHint, kind: 'general', retrieve: false,
    retrieveFacts: false, retrieveSources: false, scopes: [], sourceScopes: [], canonicalProjectIds: [], projectIds: [],
    activeProject: null, projectActive: false, projectLabel: '', anchor: '', reason: 'explicit-domain-general', subQuestionScopes: [] };
  const project = catalog.find(p => (p.id || p.projectId) === domain);
  if (!project) return { ...plan, answerDomain: domain, switchHint, kind: 'general', retrieve: false,
    retrieveFacts: false, retrieveSources: false, scopes: [], sourceScopes: [], canonicalProjectIds: [], projectIds: [], activeProject: null, projectActive: false, projectLabel: '', subQuestionScopes: [] };
  const scopes = project.sourceScopes || [project.prefix].filter(Boolean);
  return { ...plan, answerDomain: domain, switchHint, kind: 'project', retrieve: true, retrieveFacts: true,
    retrieveSources: scopes.length > 0, scopes, sourceScopes: scopes, canonicalProjectIds: [domain], projectIds: [domain],
    projectLabel: project.name, reason: 'explicit-answer-domain',
    subQuestionScopes: (plan.subQuestionScopes || []).map(s => ({ ...s, scopes, projectIds: [domain] })),
    activeProject: { scopes, projectIds: [domain], label: project.name, source: 'answer-domain' }, projectActive: true };
}
module.exports = { DOMAINS, migrate, constrain };
