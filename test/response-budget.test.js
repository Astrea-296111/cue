'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');

const last = app => app.calls.at(-1);
const system = app => last(app).messages[0].content;
const current = app => last(app).messages.at(-1).content;
const image = app => Array.isArray(current(app)) && current(app).some(part => part.type === 'image_url');

for (const mode of ['say', 'answerThis', 'ask']) {
  test(`${mode}: final SDK budgets grow from definition to ordinary question to multi-part design`, async t => {
    const app = createInterviewRuntime(t);
    await app.ask(mode, '什么是 Redis？');
    const brief = last(app).max_tokens;
    assert.ok(brief >= 256 && brief <= 500);
    assert.match(current(app), /通常1~3句/);
    assert.doesNotMatch(system(app), /这是简要问题/);
    app.clear();
    await app.ask(mode, 'HashMap 为什么使用红黑树？');
    const ordinary = last(app).max_tokens;
    assert.ok(ordinary > brief && ordinary < 1000);
    app.clear();
    await app.ask(mode, '假设订单系统QPS提升10倍，你怎么优化？为什么不用分库分表？Redis挂了怎么办？');
    const complex = last(app).max_tokens;
    assert.ok(complex > ordinary && complex <= 1800);
    const messages = JSON.stringify(last(app).messages);
    assert.equal((messages.match(/这是复杂问题/g) || []).length, 1, 'Response shape is sent once');
    for (const question of ['QPS提升10倍', '不用分库分表', 'Redis挂了']) assert.ok(messages.includes(question));
    assert.match(current(app), /3个子问题/);
    assert.match(current(app), /按原顺序逐项回应/);
  });
}

test('a lengthy interviewer introduction does not enlarge a short definition budget', async t => {
  const app = createInterviewRuntime(t);
  const setup = '现在我们进入基础概念环节，接下来逐个讨论，不涉及之前的项目。' + '请先听清后面这一道问题。'.repeat(20);
  await app.ask('say', setup + '\n什么是 Redis？');
  assert.ok(last(app).max_tokens <= 500);
  assert.ok(current(app).includes(setup), 'The budget changes; the interviewer context stays intact');
});

test('concept definitions with extra requests expand, while an explicit short answer stays short', async t => {
  const app = createInterviewRuntime(t);
  await app.ask('say', '什么是系统设计？');
  const definition = last(app).max_tokens;
  assert.ok(definition <= 500);
  app.clear();
  await app.ask('say', '什么是Redis以及如何保证一致性');
  assert.ok(last(app).max_tokens > definition);
  assert.match(current(app), /2个子问题/);
  app.clear();
  await app.ask('say', '请用一句话解释系统架构');
  assert.ok(last(app).max_tokens <= 500);
  app.clear();
  await app.ask('say', '详细解释系统架构的完整链路');
  assert.ok(last(app).max_tokens >= 1000);
});

test('screen explanation, complex analysis and code editing receive different final budgets', async t => {
  const app = createInterviewRuntime(t);
  await app.ask('assist', '解释一下屏幕代码的时间复杂度');
  const brief = last(app).max_tokens;
  assert.ok(image(app));
  assert.ok(brief >= 1000 && brief < 2000);
  app.clear();
  await app.ask('assist', '详细解释屏幕上的系统架构，为什么这样设计？有哪些取舍？');
  const complex = last(app).max_tokens;
  assert.ok(image(app));
  assert.ok(complex > brief && complex < 4096);
  app.clear();
  await app.ask('assist', '把屏幕上的 Java 二叉树中序递归遍历改成迭代实现，保留方法签名');
  assert.ok(image(app));
  assert.equal(last(app).max_tokens, 4096);
  assert.match(system(app), /历史助手代码不能覆盖当前屏幕代码/);
  assert.match(system(app), /给出修改后的代码或完整受影响的方法/);
  assert.doesNotMatch(JSON.stringify(last(app).messages), /通常[13]~[35]句/);
});

test('manual screenshot questions use screen budgets and instructions instead of oral limits', async t => {
  const app = createInterviewRuntime(t);
  await app.ask('ask', '解释屏幕上这段代码的时间复杂度');
  const explanation = last(app).max_tokens;
  assert.ok(image(app));
  assert.ok(explanation < 4096);
  assert.doesNotMatch(JSON.stringify(last(app).messages), /通常[13]~[35]句/);
  app.clear();
  await app.ask('ask', '修改屏幕上的代码，保留输入输出接口');
  assert.ok(image(app));
  assert.equal(last(app).max_tokens, 4096);
  assert.match(system(app), /当前屏幕中的代码是修改基准/);
});

test('screen-only requests retain code headroom when image complexity is not known locally', async t => {
  const app = createInterviewRuntime(t);
  for (const mode of ['assist', 'leetcode']) {
    app.clear();
    await app.ask(mode);
    assert.ok(image(app));
    assert.equal(last(app).max_tokens, 4096);
  }
});

test('follow-up and recap budgets also reach the SDK and recap grows with the interview record', async t => {
  const app = createInterviewRuntime(t);
  await app.ask('followup');
  assert.equal(last(app).max_tokens, 500);
  await app.ask('recap');
  const short = last(app).max_tokens;
  for (let i = 0; i < 30; i++) app.candidate('候选人回答记录。'.repeat(70));
  await app.ask('recap');
  assert.ok(last(app).max_tokens > short && last(app).max_tokens <= 3200);
  assert.match(system(app), /Cue 历史建议不能当作候选人实际说过/);
});

test('concise rules preserve custom preferences, source grounding and complete small factual bundles', async t => {
  const facts = '本人负责工具调用与结果验证；验证失败后恢复到 checkpoint。MANUAL_COMPLETE';
  const rules = '采用自然口语。每个观点一行。';
  const app = createInterviewRuntime(t, { settings: {
    projectKnowledge: 'RepoPilot 项目\n' + facts,
    resumeText: '候选人\n项目：RepoPilot', jobDescription: '后端工程师', aiRules: rules
  } });
  await app.ask('say', '介绍 RepoPilot 项目的架构？');
  const text = system(app);
  assert.ok(text.includes(facts), 'Removing repeated rules must not cause facts to be clipped');
  assert.ok(text.includes('REPO_ONLY'));
  assert.equal(text.split(rules).length - 1, 1);
  assert.equal(text.split('项目知识文档与项目事实规则：').length - 1, 1);
  assert.match(text, /只有材料证明个人职责/);
  assert.match(text, /不得虚构指标、组件、事故或经历/);
  assert.match(text, /不是项目事实来源/);
  assert.match(text, /事实约束和题型格式优先/);
  assert.doesNotMatch(text, /任何超过2句|技术面试回答要求|优先级很高/);
  assert.ok(app.commits.at(-1).config.evidence.some(item => item.sourceType === 'manual' && item.text.includes('MANUAL_COMPLETE')));
});
