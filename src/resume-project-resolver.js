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
    aliases: ['第二个项目','第2个项目','代码修复项目','agent项目','coding agent','RepoPilot','repo pilot'],
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

function resolveResumeProject(text) {
  const value = String(text || '').normalize('NFKC').toLowerCase();
  for (const project of RESUME_PROJECTS) {
    if (project.aliases.some(a => value.includes(String(a).toLowerCase()))) return project;
  }
  return null;
}

module.exports = { RESUME_PROJECTS, resolveResumeProject };
