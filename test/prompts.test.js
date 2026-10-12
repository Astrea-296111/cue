const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES } = require('../src/prompts');
const { getAnswerPlan, answerShapeInstruction } = require('../src/prompts');

test('assist 默认要求中文、直接回答并支持多种屏幕题', () => {
  const text = MODES.assist.buildSystem(null) + '\n' + MODES.assist.build({ transcript: [], userText: '' });
  assert.match(text, /简体中文/);
  assert.match(text, /项目知识文档/);
  assert.match(text, /AI Coding/);
  assert.match(text, /ACM/);
});

test('say 输出可直接口述的中文答案', () => {
  const text = MODES.say.buildSystem(null) + '\n' + MODES.say.build({ transcript: [], userText: '' });
  assert.match(text, /第一人称/);
  assert.match(text, /直接说出口/);
  assert.match(text, /八股/);
});

test('leetcode 历史模式键已升级为 ACM/屏幕技术题模式，并忽略个人上下文', () => {
  const system = MODES.leetcode.buildSystem('IGNORED_CONTEXT');
  assert.match(system, /ACM/);
  assert.match(system, /标准输入/);
  assert.match(system, /AI Coding/);
  assert.match(system, /Debug/);
  assert.ok(!system.includes('IGNORED_CONTEXT'));
  assert.match(system, /完整 main/);
  assert.match(system, /禁止 LeetCode/);
});

test('followup 输出中文反问', () => {
  const system = MODES.followup.buildSystem(null);
  assert.match(system, /反问/);
  assert.match(system, /技术挑战/);
});

test('所有模式都有 build / buildSystem', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    assert.equal(typeof mode.build, 'function', `${name}.build must be a function`);
    assert.equal(typeof mode.buildSystem, 'function', `${name}.buildSystem must be a function`);
  }
});

const RULES = '回答更短。\n优先使用项目符号。';

test('非屏幕技术题模式会注入用户回答规则', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    if (name === 'leetcode') continue;
    const withRules = mode.buildSystem(null, RULES);
    assert.match(withRules, /用户回答规则/);
    assert.ok(withRules.includes(RULES));
  }
});

test('屏幕技术题模式不应用自定义风格，保证 ACM/调试格式稳定', () => {
  const withRules = MODES.leetcode.buildSystem(null, RULES);
  assert.ok(!withRules.includes(RULES));
  assert.match(withRules, /ACM/);
});

test('planned subquestions receive bounded output room and override the single-point sentence limit', () => {
  const interviewPlan = { type: 'scenario', subQuestions: [
    { text: 'QPS 提升 10 倍怎么优化？' }, { text: '为什么不用分库分表？' }, { text: 'Redis 挂了怎么办？' }
  ] };
  const answerPlan = getAnswerPlan('假设订单量增长10倍，你怎么优化？为什么不用分库分表？Redis挂了怎么办？', interviewPlan);
  assert.equal(answerPlan.questionCount, 3);
  assert.ok(answerPlan.maxTokens > 920);
  assert.equal(MODES.say.resolveMaxTokens({ answerPlan }), answerPlan.maxTokens);
  assert.match(answerShapeInstruction(answerPlan), /3个子问题/);
  assert.match(answerShapeInstruction(answerPlan), /按原顺序逐项回应/);
  const many = getAnswerPlan('请回答这些问题', { subQuestions: Array.from({ length: 40 }, () => ({ text: '怎么实现？' })) });
  assert.equal(many.maxTokens, 1800);
  assert.equal(many.sentenceLimit, 18);
  assert.equal(MODES.say.resolveMaxTokens({ answerPlan: getAnswerPlan('Redis 为什么快？') }), 700);
});

test('Interview Mode preserves grounding and applies to project/scenario questions while Assist keeps code rules', () => {
  const opts = { answerPlan: getAnswerPlan('为什么这么设计？'), projectPlan: { retrieve: true, scopes: ['RepoPilot/'] } };
  const project = MODES.say.buildSystem('SOURCE_EVIDENCE', '', opts);
  assert.match(project, /Interview Mode/);
  assert.match(project, /设计原因、关键实现、相关 trade-off/);
  assert.match(project, /不能把推演方案/);
  assert.match(project, /只有材料证明个人职责/);
  const generic = MODES.say.buildSystem('', '', { projectPlan: { retrieve: false, activeProject: { scopes: ['RepoPilot/'] } } });
  assert.doesNotMatch(generic, /Interview Mode/);
  const screen = MODES.assist.buildSystem('', '', opts);
  assert.doesNotMatch(screen, /Interview Mode/);
  assert.match(screen, /给出修改后的代码/);
  assert.equal(MODES.assist.resolveMaxTokens({ answerPlan: opts.answerPlan }), 4096);
});
