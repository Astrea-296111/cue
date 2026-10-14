'use strict';

// Resolve resume-style references before vector retrieval.
// Interviewers often say "第一个项目/论文项目/你简历里的项目".
// These are identity references, not semantic search queries.

const RESUME_PROJECTS = [
  {
    order: 1,
    key: 'TCS',
    name: '阈值覆盖共享的鲁棒 JPEG 隐写框架',
    aliases: ['第一个项目','第1个项目','第一个论文','论文项目','隐写项目','jpeg隐写','阈值覆盖共享','TCS','threshold cover sharing','cover sharing'],
    prefix: 'TCS'
  },
  {
    order: 2,
    key: 'RepoPilot',
    name: 'RepoPilot｜面向代码仓库的自动修复 Agent',
    aliases: ['第二个项目','第2个项目','代码修复项目','agent项目','agent 项目','coding agent','RepoPilot','repo pilot'],
    prefix: 'RepoPilot'
  },
  {
    order: 3,
    key: 'FlashFlow',
    name: 'FlashFlow',
    aliases: ['第三个项目','秒杀项目','flashflow','库存项目'],
    prefix: 'FlashFlow'
  }
];

function normalizedWithOffsets(text) {
  let value = '', position = 0;
  const starts = [], ends = [];
  for (const character of String(text || '')) {
    const folded = character.normalize('NFKC').toLowerCase();
    for (let i = 0; i < folded.length; i++) { starts.push(position); ends.push(position + character.length); }
    value += folded;
    position += character.length;
  }
  return { value, starts, ends };
}

function aliasMentions(text, alias, preparedText) {
  const normalized = preparedText || normalizedWithOffsets(text);
  const name = String(alias || '').normalize('NFKC').toLowerCase().trim();
  if (!name) return [];
  const mentions = [];
  let at = normalized.value.indexOf(name);
  while (at >= 0) {
    // Keep Chinese adjacency but avoid matching an English identifier prefix.
    const bounded = (!/[a-z0-9_]/i.test(name[0]) || !/[a-z0-9_]/i.test(normalized.value[at - 1] || '')) &&
      (!/[a-z0-9_]/i.test(name.at(-1)) || !/[a-z0-9_]/i.test(normalized.value[at + name.length] || ''));
    if (bounded) mentions.push({ start: normalized.starts[at], end: normalized.ends[at + name.length - 1], alias });
    at = normalized.value.indexOf(name, at + Math.max(1, name.length));
  }
  return mentions;
}

function configuredCatalog(catalog) {
  return Array.isArray(catalog) && catalog.some(project => project.hasManifest || Number.isInteger(project.resumeOrder));
}

function chineseOrdinal(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return digits[value] ?? null;
}

function projectOrdinalMentions(text) {
  const value = String(text || '');
  const result = [];
  for (const match of value.matchAll(/第\s*([零〇一二两三四五六七八九十\d]+)\s*(?:个|项)?\s*(项目|课题|论文)?/g)) {
    const after = value.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (!match[2] && /^(?:问题|点|种|条|步|次|轮)/.test(after.trim())) continue;
    const surrounding = value.slice(Math.max(0, match.index - 16), match.index + match[0].length + 24);
    if (!match[2] && !/项目|课题|论文/.test(surrounding)) continue;
    const order = chineseOrdinal(match[1]);
    if (Number.isInteger(order) && order > 0) result.push({ start: match.index, end: match.index + match[0].length, order });
  }
  for (const match of value.matchAll(/\b(?:the\s+)?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+project\b/gi)) {
    const order = ({ first: 1, second: 2, third: 3, fourth: 4, fifth: 5 })[match[1].toLowerCase()] || Number.parseInt(match[1], 10);
    result.push({ start: match.index, end: match.index + match[0].length, order });
  }
  return result;
}

function identity(project) { return project.projectId || project.prefix || project.key || project.name; }

function resolveProjectMentions(text, catalog = []) {
  const projects = Array.isArray(catalog) ? catalog : [];
  const configured = configuredCatalog(projects);
  const preparedText = normalizedWithOffsets(text);
  const mentions = projects.flatMap(project => [...new Set([project.name, ...(project.aliases || [])])]
    .flatMap(alias => aliasMentions(text, alias, preparedText).map(mention => ({ ...mention, project, kind: 'name' }))));
  for (const ordinal of projectOrdinalMentions(text)) {
    const matches = configured
      ? projects.filter(project => project.resumeOrder === ordinal.order)
      : RESUME_PROJECTS.filter(project => project.order === ordinal.order).flatMap(legacy => {
        const actual = projects.filter(project => [project.name, ...(project.aliases || [])].some(alias =>
          [legacy.key, legacy.name, ...legacy.aliases].some(name => aliasMentions(alias, name).length)));
        return actual.length ? actual : [legacy];
      });
    // Conflicting ordinals never guess an identity (import validation reports them).
    if (matches.length === 1) mentions.push({ ...ordinal, project: matches[0], kind: 'ordinal' });
  }
  if (!configured) {
    for (const legacy of RESUME_PROJECTS) {
      const matching = projects.filter(project => [project.name, ...(project.aliases || [])].some(alias =>
        [legacy.key, legacy.name].some(name => aliasMentions(alias, name).length)));
      const project = matching[0] || legacy;
      for (const alias of legacy.aliases.filter(alias => !/^第/.test(alias))) {
        for (const mention of aliasMentions(text, alias, preparedText)) mentions.push({ ...mention, project, kind: 'legacy-name' });
      }
    }
  }
  return mentions.sort((a, b) => a.start - b.start || b.end - a.end || (a.kind === 'name' ? -1 : 1))
    .filter((mention, index, all) => !all.slice(0, index).some(old => old.start === mention.start && old.end === mention.end && identity(old.project) === identity(mention.project)))
    .map(mention => ({ ...mention, excluded: /(?:不是(?:说|问|指)?|不聊|不谈|不说|不问|别聊|别谈|不讨论|(?:不|别|不要|无需|先不)(?:结合|涉及|针对|联系|套用)|不要(?:再)?(?:聊|讲|谈|说|问))\s*(?:那个|这个)?\s*$/
      .test(String(text || '').slice(Math.max(0, mention.start - 16), mention.start)) }));
}

function resolveResumeProject(text, catalog) {
  const mention = resolveProjectMentions(text, catalog).find(item => !item.excluded);
  if (!mention) return null;
  const project = mention.project;
  return { ...project, key: project.key || project.projectId || project.name, order: project.resumeOrder ?? project.order ?? null };
}

module.exports = { RESUME_PROJECTS, resolveResumeProject, resolveProjectMentions, projectOrdinalMentions, aliasMentions, configuredCatalog };
