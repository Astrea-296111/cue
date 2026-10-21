'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewRuntime, currentText, deferred } = require('./helpers/interview-agent-runtime');

const shortcut = 'CommandOrControl+L';
const last = app => app.calls.at(-1);
function assertTextOnly(app) {
  assert.equal(app.captures, 0, 'Ctrl+L must not call screen capture');
  for (const call of app.calls) {
    assert.ok(call.messages.every(message => typeof message.content === 'string'), 'Final SDK messages must contain text only');
  }
}

test('Ctrl+L solves the resolved coding question with code headroom even when capture would fail', async t => {
  const app = createInterviewRuntime(t);
  app.captureFailure();
  app.final('给定一个整数数组，请用 Java 实现两数之和，返回下标，不能重复使用同一个元素。');
  await app.shortcut(shortcut);
  assert.equal(app.calls.length, 1);
  assert.match(currentText(last(app)), /Java.*两数之和/);
  assert.match(currentText(last(app)), /不能重复使用同一个元素/);
  assert.match(last(app).messages[0].content, /代码题给可运行代码或完整受影响函数，不受口述句数限制/);
  assert.match(last(app).messages[0].content, /本轮没有截图/);
  assert.doesNotMatch(last(app).messages[0].content, /当前屏幕中的代码是修改基准/);
  assert.equal(last(app).max_tokens, 4096);
  assert.equal(app.commits.at(-1).request.mode, 'technical');
  assertTextOnly(app);
});

test('Ctrl+L retains earlier code for an iterative follow-up and drops it on an independent concept', async t => {
  const app = createInterviewRuntime(t);
  const code = '```java\n// TREE_RECURSIVE_BASELINE\nvoid inorder(TreeNode root) { if(root == null) return; inorder(root.left); visit(root); inorder(root.right); }\n```';
  app.answer(code);
  app.final('请用 Java 实现二叉树的中序递归遍历。');
  await app.shortcut(shortcut);
  app.final('改成迭代法实现');
  await app.shortcut(shortcut);
  assert.match(currentText(last(app)), /改成迭代法实现/);
  assert.ok(last(app).messages.some(message => message.role === 'assistant' && message.content.includes('TREE_RECURSIVE_BASELINE')));
  assert.match(JSON.stringify(last(app).messages), /Java.*中序/);
  app.final('什么是 Redis？');
  await app.shortcut(shortcut);
  assert.match(currentText(last(app)), /什么是 Redis/);
  assert.doesNotMatch(JSON.stringify(last(app).messages), /TREE_RECURSIVE_BASELINE/);
  assert.equal(last(app).messages.some(message => message.role === 'assistant'), false);
  assert.ok(last(app).max_tokens <= 640, 'A short concept question must not require a full code budget');
  assertTextOnly(app);
});

test('switching from Assist to Ctrl+L retains relevant code but never reuses a screenshot', async t => {
  const app = createInterviewRuntime(t);
  app.answer('```java\n// ASSIST_CODE_BASELINE\nvoid visit(TreeNode root) {}\n```');
  app.final('请用 Java 实现二叉树的中序递归遍历。');
  await app.shortcut('CommandOrControl+Shift+Return');
  assert.equal(app.captures, 1);
  app.captureFailure();
  app.final('改成迭代法实现');
  await app.shortcut(shortcut);
  assert.equal(app.captures, 1, 'Only the preceding Assist request may capture');
  assert.ok(last(app).messages.every(message => typeof message.content === 'string'));
  assert.match(JSON.stringify(last(app).messages), /ASSIST_CODE_BASELINE/);
  assert.doesNotMatch(JSON.stringify(last(app).messages), /image_url|data:image/);
});

test('Ctrl+L never captures even when the interviewer explicitly mentions screen code', async t => {
  const app = createInterviewRuntime(t);
  app.captureFailure();
  app.final('解释一下屏幕上这段代码的时间复杂度。');
  await app.shortcut(shortcut);
  assert.equal(app.calls.length, 1);
  assert.match(last(app).messages[0].content, /缺少关键题意或待修改代码时明确指出缺口/);
  assert.ok(last(app).max_tokens < 4096);
  assertTextOnly(app);
});

test('empty and partial Ctrl+L remain responsive without inventing a question', async t => {
  const app = createInterviewRuntime(t);
  await app.shortcut(shortcut);
  assert.equal(app.calls.length, 0);
  assert.equal(app.value('conversation.recent.length'), 0);
  app.interim('如果平', { utteranceKey: 'partial' });
  await app.shortcut(shortcut);
  assert.equal(app.calls.length, 0);
  app.final('如果平均每张图的生存概率都一样，还需要动态规划吗？', { utteranceKey: 'partial' });
  await app.shortcut(shortcut);
  assert.equal(app.calls.length, 1);
  assert.match(currentText(last(app)), /动态规划/);
  assertTextOnly(app);
});

test('Ctrl+L reuses semantic splitting for complete questions, noise and multiple questions', async t => {
  const app = createInterviewRuntime(t);
  app.final('你能用 Java 实现二叉树中序遍历吗？时间复杂度是多少？在这个过程');
  await app.shortcut(shortcut);
  assert.match(currentText(last(app)), /中序遍历/);
  assert.match(currentText(last(app)), /时间复杂度/);
  assert.doesNotMatch(JSON.stringify(last(app).messages), /在这个过程/);
  app.final('ops');
  await app.shortcut(shortcut);
  assert.match(currentText(last(app)), /中序遍历/);
  assert.doesNotMatch(currentText(last(app)), /\bops\b/);
  app.final('为什么用 Function Call？为什么用 React 框架？');
  await app.shortcut(shortcut);
  assert.match(currentText(last(app)), /Function Call/);
  assert.match(currentText(last(app)), /React/);
  assertTextOnly(app);
});

for (const indexVersion of [1, 2]) {
  test(`Ctrl+L v${indexVersion} keeps project routing scoped across switches and a Redis interlude`, async t => {
    const app = createInterviewRuntime(t, { indexVersion });
    app.answer('TCS_OLD_ANSWER 平台压缩、微信、Facebook、JPEG 是上一项目的问题。');
    await app.ask('say', '介绍一下第一个项目 TCS？');
    app.answer('RepoPilot 使用 LangGraph 管理工具执行和 checkpoint 恢复。');
    app.final('关于第二个，你的 agent 项目。这个项目为什么使用 LangGraph？');
    await app.shortcut(shortcut);
    assert.match(app.value('conversation.recent.at(-1).plan.projectLabel'), /RepoPilot/);
    assert.match(last(app).messages[0].content, /REPO_ONLY/);
    assert.doesNotMatch(JSON.stringify(last(app).messages), /TCS_OLD_ANSWER|TCS_ONLY|平台压缩|JPEG/);
    app.final('那为什么用了 LangGraph？');
    await app.shortcut(shortcut);
    assert.match(app.value('conversation.recent.at(-1).plan.projectLabel'), /RepoPilot/);
    app.final('什么是 Redis？');
    await app.shortcut(shortcut);
    assert.doesNotMatch(JSON.stringify(last(app).messages), /REPO_ONLY|TCS_OLD_ANSWER/);
    app.final('回到刚才那个项目，你为什么用 LangGraph？');
    await app.shortcut(shortcut);
    assert.match(app.value('conversation.recent.at(-1).plan.projectLabel'), /RepoPilot/);
    assert.match(last(app).messages[0].content, /REPO_ONLY/);
    for (const row of app.searches) assert.equal(row.scopes?.length, 1, `${row.method} must be scoped`);
    assertTextOnly(app);
  });
}

test('Ctrl+L interrupts a previous generation and commits only its replacement', async t => {
  const app = createInterviewRuntime(t);
  const gate = deferred();
  app.behavior(() => (async function* () {
    await gate.promise;
    yield { choices: [{ delta: { content: 'OLD_LATE_CODE' }, finish_reason: 'stop' }] };
  })());
  const old = app.ask('say', 'Redis 数据结构有哪些？');
  await app.waitForCalls(1);
  app.answer('```java\nint add(int a, int b) { return a + b; }\n```');
  app.final('请用 Java 实现一个整数加法函数。');
  await app.shortcut(shortcut);
  assert.equal(app.requestOptions[0].signal.aborted, true);
  gate.resolve();
  await old;
  await new Promise(setImmediate);
  assert.equal(app.value('conversation.recent.length'), 1);
  assert.equal(app.commits.at(-1).request.mode, 'technical');
  assert.match(app.value('conversation.recent[0].question'), /整数加法/);
  assert.equal(app.events.some(event => event.text?.includes('OLD_LATE_CODE')), false);
  assert.equal(app.value('state.busy'), false);
  assertTextOnly(app);
});
