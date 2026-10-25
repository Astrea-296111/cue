'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewRuntime, currentText, imageUrl, deferred } = require('./helpers/interview-agent-runtime');
const { chunkText } = require('../src/project-chunks');

const enter = 'CommandOrControl+Return';
const assist = 'CommandOrControl+Shift+Return';
const tcsAnswer = '平台压缩是 TCS 的最大难点，微信和 Facebook 的 JPEG 二次压缩影响图片恢复率。';
const repoAnswer = 'RepoPilot 的架构是 Agent Loop 与 LangGraph 双运行时，工具执行后进行 AST 验证，再从 checkpoint 恢复。';
const formalSearches = app => app.searches.filter(row => row.method === 'getProjectCandidates');
const lastSystem = app => app.calls.at(-1).messages[0].content;

function assertScoped(app) {
  for (const row of app.searches.filter(row => ['getProjectCandidates', 'searchProjectKnowledge', 'prefetchProjectKnowledge'].includes(row.method))) {
    assert.equal(row.scopes?.length, 1, 'each runtime retrieval must have exactly one authoritative project scope');
    for (const hit of row.rows) {
      if (row.scopes[0].startsWith('@project:')) assert.equal(hit.projectId, row.scopes[0].slice('@project:'.length));
      else assert.ok(hit.path.startsWith(row.scopes[0]));
    }
  }
}

for (const indexVersion of [1, 2]) {
  test(`actual v${indexVersion} runtime keeps bootstrap and explicit project switching isolated`, async t => {
    const app = createInterviewRuntime(t, { indexVersion });
    app.answer(tcsAnswer);
    await app.ask('say', '介绍一下第一个项目 TCS？');
    await app.ask('say', '在这个过程中，你遇到的最大困难是什么？你是怎么解决的？');
    app.answer(repoAnswer);
    await app.ask('say', '关于第二个，你的 agent 项目。这个项目最难的地方在哪里？');
    assert.ok(['src/custom-main.js', 'src/overlay-interaction.js', 'src/application-integration.js', 'main.js', 'src/llm.js', 'src/project-knowledge.js'].every(file => app.loaded.includes(file)));
    assert.equal(app.loaded.includes('src/main.js'), false);
    assert.match(app.value('conversation.recent.at(-1).plan.projectLabel'), /RepoPilot/);
    assert.doesNotMatch(JSON.stringify(app.calls.at(-1).messages), /平台压缩|微信|Facebook|TCS_ONLY|FLASH_ONLY/);
    assert.match(lastSystem(app), /REPO_ONLY/);
    assert.equal(app.calls.at(-1).messages.some(row => row.role === 'assistant'), false);
    app.final('那为什么用了 LangGraph？');
    await app.shortcut(enter);
    assert.match(lastSystem(app), /LangGraph/);
    assert.match(app.value('conversation.recent.at(-1).plan.projectLabel'), /RepoPilot/);
    assertScoped(app);
  });
}

test('real Ctrl+Enter skips empty/incomplete targets and accepts a later complete final', async t => {
  const app = createInterviewRuntime(t);
  await app.shortcut(enter);
  assert.equal(app.calls.length, 0, 'an empty Ctrl+Enter must not reanswer an old or invented target');
  assert.equal(app.value('conversation.recent.length'), 0);
  app.interim('如果平', { utteranceKey: 'live-1' });
  await app.shortcut(enter);
  assert.equal(app.calls.length, 0, 'an unfinished condition is not an answerable target');
  app.final('如果平均每张图的生存概率都一样，还需要动态规划吗？', { utteranceKey: 'live-1' });
  await app.shortcut(enter);
  assert.equal(app.calls.length, 1);
  assert.match(currentText(app.calls[0]), /平均每张图[\s\S]*动态规划/);
});

test('Ctrl+Enter interruption cancels the old SDK stream and commits only its replacement', async t => {
  const app = createInterviewRuntime(t);
  const gate = deferred();
  app.behavior(() => (async function* () {
    await gate.promise;
    yield { choices: [{ delta: { content: 'OLD_LATE_ANSWER' }, finish_reason: 'stop' }] };
  })());
  const old = app.ask('say', 'Redis 数据结构有哪些？');
  await app.waitForCalls(1);
  app.answer('TCP 通过三次握手建立连接。');
  await app.ask('say', 'TCP 如何建立连接？');
  assert.equal(app.requestOptions[0].signal.aborted, true);
  gate.resolve();
  await old;
  await new Promise(setImmediate);
  assert.equal(app.value('conversation.recent.length'), 1);
  assert.match(app.value('conversation.recent[0].question'), /TCP/);
  assert.equal(app.events.some(event => event.text?.includes('OLD_LATE_ANSWER')), false);
  assert.equal(app.value('state.busy'), false);
});

test('clear during real SDK generation isolates late tokens and the new conversation epoch', async t => {
  const app = createInterviewRuntime(t);
  const gate = deferred();
  app.behavior(() => (async function* () {
    await gate.promise;
    yield { choices: [{ delta: { content: 'CLEARED_LATE_ANSWER' }, finish_reason: 'stop' }] };
  })());
  const old = app.ask('say', '介绍 RepoPilot 的架构？');
  await app.waitForCalls(1);
  app.clear();
  assert.equal(app.requestOptions[0].signal.aborted, true);
  app.answer('Redis 使用内存和高效数据结构。');
  await app.ask('say', 'Redis 为什么快？');
  gate.resolve();
  await old;
  await new Promise(setImmediate);
  assert.equal(app.value('conversation.recent.length'), 1);
  assert.match(app.value('conversation.recent[0].question'), /Redis/);
  assert.equal(app.events.some(event => event.text?.includes('CLEARED_LATE_ANSWER')), false);
  assert.doesNotMatch(JSON.stringify(app.calls[1].messages), /REPO_ONLY|CLEARED_LATE/);
});

test('real Assist shortcut uses the new screenshot and the current interviewer code modification', async t => {
  const app = createInterviewRuntime(t);
  app.answer('递归中序遍历：先 left，再访问当前节点，再 right。');
  await app.ask('assist', '写二叉树的递归中序遍历。');
  app.final('改成迭代法实现，不要用递归，使用显式栈。');
  app.answer('用显式 stack 循环处理 left、当前节点和 right。');
  await app.shortcut(assist);
  assert.equal(app.captures, 2);
  assert.notEqual(imageUrl(app.calls[0]), imageUrl(app.calls[1]));
  assert.match(currentText(app.calls[1]), /迭代[\s\S]*显式栈/);
  assert.match(JSON.stringify(app.calls[1].messages), /递归中序遍历/);
  app.captureFailure();
  await app.ask('assist', '再加上空树判断。');
  assert.equal(app.calls.length, 2, 'capture failure must not send a stale screenshot');
  assert.match(app.events.findLast(event => event.channel === 'llm:error').message, /截图失败/);
});

for (const scenario of [
  { name: 'Chinese', question: '假设 RepoPilot 的流量增长十倍，如何扩容？为什么不用分库分表？Redis 挂了怎么办？',
    anchors: [/扩容/, /分库分表/, /Redis/],
    initial: '1. 扩容：首先对无状态服务进行水平扩容，拆分计算密集任务并限制并发，按吞吐和延迟验证流量提升十倍时的瓶颈。\n2. 分库分表：当前先优化查询与索引，只有数据库写入或容量成为瓶颈才选择分库分表，否则跨分片事务和维护成本会增加。',
    followup: '第三个问题呢？',
    completion: '3. Redis 故障：Redis 挂了时先限流和熔断，关键请求降级到数据库回源并限制并发，恢复后逐步预热缓存，避免缓存雪崩和数据库被打满。' },
  { name: 'English', question: 'Suppose traffic for RepoPilot increases tenfold. How would you scale it? Why not use database sharding? What happens if Redis fails?',
    anchors: [/scale/i, /sharding/i, /Redis/i],
    initial: '1. Scale: scale stateless workers horizontally, cap concurrency and measure throughput under tenfold traffic.\n2. Database sharding: defer database sharding until write throughput or storage is a bottleneck because cross-shard transactions and operating costs otherwise outweigh the benefit.',
    followup: 'What about the third question?',
    completion: '3. Redis failure: if Redis fails, apply rate limits and a circuit breaker, serve essential requests from the database with capped concurrency, then warm the cache gradually during recovery.' }
]) {
  test(`${scenario.name} scenario reaches final SDK messages in order and an omitted third answer stays pending until supplemented`, async t => {
    const app = createInterviewRuntime(t);
    app.answer(scenario.initial);
    app.final(scenario.question);
    await app.shortcut(enter);
    const request = app.requests[0];
    assert.equal(request.interviewPlan.subQuestions.length, 3);
    assert.equal(request.checklist.questions.filter(row => row.current).length, 3);
    let previous = -1;
    for (let index = 0; index < scenario.anchors.length; index++) {
      const text = request.interviewPlan.subQuestions[index].text || request.interviewPlan.subQuestions[index];
      assert.match(text, scenario.anchors[index]);
      const position = currentText(app.calls[0]).indexOf(text);
      assert.ok(position > previous, 'the final model turn preserves the ordered planned asks');
      previous = position;
    }
    app.answer(scenario.completion);
    await app.ask('say', scenario.followup);
    const pending = app.requests[1].checklist.pending;
    assert.equal(pending.length, 1, 'only the actually omitted third answer remains pending');
    assert.match(pending[0].text, scenario.anchors[2]);
    assert.ok(currentText(app.calls[1]).includes(pending[0].text), 'the omitted question must be visible in the final SDK message');
    app.answer('该方案需要验证容量、延迟和故障恢复，再根据瓶颈调整。');
    await app.ask('say', '继续解释这个方案。');
    assert.equal(app.requests[2].checklist.pending.some(row => scenario.anchors[2].test(row.text)), false,
      'a normal supplemental answer retires the previously pending Redis ask');
  });
}

test('a new standard project question does not reactivate unknown old asks, while explicit ordinal follow-ups retain the requested ask',async t=>{
  const app=createInterviewRuntime(t,{settings:{realtimeAnswerMode:'standard'}});
  const oldQuestion='RepoPilot 的消息确认边界是什么？';
  app.answer('这段建议没有生成完整。',{finishReason:'length'});
  await app.ask('say',oldQuestion);
  app.candidate('我刚才说 Kafka 是口误，实际是 RabbitMQ 用来派发任务。');
  const nextQuestion='RepoPilot 如何避免 RabbitMQ 重复派发？';
  app.answer('这个问题需要使用幂等执行身份和持久化记录。');
  await app.ask('say',nextQuestion);
  assert.equal(app.requests[1].checklist.pending.length,0);
  assert.ok(app.requests[1].checklist.questions.every(row=>row.current));
  assert.ok(!app.requests[1].projectInterviewState.unresolvedTopics.includes(oldQuestion));
  const nextPrompt=currentText(app.calls[1]);
  assert.ok(nextPrompt.includes(nextQuestion));
  assert.match(nextPrompt,/我刚才说 Kafka 是口误/);
  assert.doesNotMatch(nextPrompt,/此前未确认覆盖|含同话题仍适用的遗漏/);

  const compound='RepoPilot 重试身份如何确定？崩溃恢复后怎样避免重复？';
  app.answer('这次回答也被截断。',{finishReason:'length'});
  await app.ask('say',compound);
  const planned=app.requests[2].interviewPlan.subQuestions;
  assert.equal(planned.length,2);
  assert.equal(app.requests[2].checklist.pending.length,0);
  assert.equal(app.requests[2].checklist.questions.filter(row=>row.current).length,2);
  for(const question of planned)assert.ok(currentText(app.calls[2]).includes(question.text));
  app.answer('持久化记录提供恢复时的状态依据。');
  await app.ask('say','在刚才第二个问题里，为什么需要持久化记录？');
  assert.equal(app.requests[3].checklist.pending.length,0,'a reference inside a new specific question must not request the whole earlier answer');
  app.answer('通过持久化执行身份核对恢复结果，避免重复执行。');
  await app.ask('say','第二个问题呢？');
  assert.equal(app.requests[4].checklist.pending.length,1);
  assert.equal(app.requests[4].checklist.pending[0].text,planned[1].text);
  assert.ok(currentText(app.calls[4]).includes(planned[1].text));
  assert.ok(!app.requests[4].checklist.pending.some(row=>row.text===oldQuestion));
});

for (const finishReason of ['length', null]) {
  test(`SDK finish_reason=${finishReason} cannot mark requested answers covered`, async t => {
    const app = createInterviewRuntime(t);
    app.answer('1. Redis 缓存减少数据库压力，代价是需要处理一致性。\n2. Redis 缓存击穿时对热点键加互斥锁并设置限流。', { finishReason });
    await app.ask('say', 'RepoPilot 为什么使用 Redis？缓存击穿怎么办？');
    app.answer('仍需要补充完整回答。');
    await app.ask('say', '继续把刚才的两个问题答完整。');
    assert.equal(app.requests[1].checklist.pending.length, 2);
    assert.ok(app.requests[1].checklist.pending.every(row => !row.answered));
    assert.ok(app.commits[0].config.completion);
    assert.equal(app.commits[0].config.completion.complete, false);
  });
}

test('generic Redis interlude suspends project state and its explicit return restores scoped evidence', async t => {
  const app = createInterviewRuntime(t);
  app.answer(repoAnswer);
  await app.ask('say', '介绍 RepoPilot 项目的架构？');
  const count = formalSearches(app).length;
  app.answer('Redis 的基础数据类型是 string、hash、list、set 和 sorted set。');
  await app.ask('say', 'Redis 有哪些数据类型？');
  assert.equal(app.requests[1].plan.retrieve, false);
  assert.equal(app.requests[1].projectInterviewState, null);
  assert.equal(formalSearches(app).length, count, 'generic technical questions do not search project sources');
  app.answer('LangGraph 显式建模工具执行的状态，并在 checkpoint 后继续运行验证闭环。');
  await app.ask('say', '回到刚才那个项目，你为什么用 LangGraph？');
  assert.match(app.requests[2].projectInterviewState.project, /RepoPilot/);
  assert.ok(app.requests[2].projectInterviewState.evidence.length > 0);
  assert.doesNotMatch(JSON.stringify(app.requests[2].projectInterviewState), /sorted set|基础数据类型/);
  assert.doesNotMatch(JSON.stringify(app.calls[2].messages), /Redis 的基础数据类型/);
  assertScoped(app);
});

test('30-minute real runtime keeps project facts source-faithful across more than 24 answered turns', async t => {
  const app = createInterviewRuntime(t);
  const factualSpeech = '我在 RepoPilot 实际负责工具验证模块，其他模块由团队成员负责。';
  app.answer(repoAnswer + ' 我独立负责所有模块，QPS 达到 987654321；ASSISTANT_INVENTED_FACT。');
  await app.ask('say', '介绍 RepoPilot 的架构和你的职责？');
  const firstState = app.requests[0].projectInterviewState;
  app.candidate(factualSpeech);
  for (let index = 0; index < 32; index++) {
    app.advance(60_000);
    app.answer(`第 ${index + 1} 次追问：LangGraph 架构使用 Agent Loop 处理工具执行，并利用 checkpoint 与 AST 验证决定重试。`);
    await app.ask('say', index % 2 ? '为什么这样设计？' : '这个架构的取舍是什么？');
  }
  assert.ok(app.value('conversation.recent.length') <= 24);
  assert.ok(app.value('conversation.archive.length') > 0);
  const last = app.requests.at(-1), state = last.projectInterviewState;
  assert.match(state.project, /RepoPilot/);
  assert.ok(state.evidence.length > 0);
  assert.ok(last.stats.historyChars <= last.stats.budget);
  assert.ok(JSON.stringify(state).length < 24_000, 'project state stays compact independently of chat retention');
  assert.doesNotMatch(JSON.stringify(state), /987654321|ASSISTANT_INVENTED_FACT|独立负责所有模块/);
  assert.ok(state.evidence.every(row => row.kind !== 'assistant' && row.projectId && row.path && row.text),
    'state facts cite imported sources rather than summarizing assistant prose');
  const normalizedSpeech = app.commits[1].request.spokenContext;
  assert.match(normalizedSpeech, /我在 RepoPilot 实际负责工具验证模块[,，]其他模块由团队成员负责/,
    'candidate speech keeps its actual source boundary through normal ASR punctuation cleanup');
  assert.ok(app.calls[2].messages.some(row => row.role === 'user' && typeof row.content === 'string' && row.content.includes(normalizedSpeech)),
    'actual candidate speech is carried as a user source, independently of generated assistant history');
  assert.ok(firstState === null || !JSON.stringify(firstState).includes('ASSISTANT_INVENTED_FACT'));
  assertScoped(app);
  app.clear();
  app.answer(tcsAnswer);
  await app.ask('say', '介绍一下 TCS 项目？');
  assert.doesNotMatch(JSON.stringify(app.calls.at(-1).messages), /REPO_ONLY|ASSISTANT_INVENTED_FACT/);
});

test('project Redis decisions and outage follow-ups reselect scoped typed evidence while unknown code needs search', async t => {
  const chunks = [
    { path: 'Order/README.md', startLine: 1, endLine: 5,
      text: '# Order 项目\n项目使用 MySQL。项目选择 Redis，因为缓存降低数据库读压力。\nRedis 不可用时采用熔断限流和数据库回源降级，恢复后逐步预热缓存。\n订单系统架构采用无状态 API 服务和数据库事务。\n代码入口是 OrderController。' }
  ];
  const app = createInterviewRuntime(t, { chunks });
  app.answer('Order 的架构采用 MySQL 和 Redis，由无状态 API 服务处理订单。');
  await app.ask('say', '介绍 Order 项目？');
  let count = formalSearches(app).length;
  app.answer('选择 Redis 是因为缓存降低数据库读压力，但需要处理缓存一致性。');
  await app.ask('say', '为什么选择 Redis？');
  assert.ok(formalSearches(app).length > count, 'a new requirement must be reselected rather than reuse an overview as a decision');
  assert.match(lastSystem(app), /降低数据库读压力/);
  app.answer('Redis失效时先熔断限流，通过数据库回源降级，恢复后逐步预热缓存。');
  await app.ask('say', '如果 Redis 失效怎么办？');
  assert.ok(formalSearches(app).length > count);
  count = formalSearches(app).length;
  await app.ask('say', '这块代码中的 UnknownHandler 怎么实现？');
  assert.equal(formalSearches(app).length, count + 1);
  assertScoped(app);
});

test('source-code question sends a cited Controller-Service-Repository chain to the actual SDK', async t => {
  const files = {
    'Order/README.md': '# Order 项目\n\n订单创建流程入口是 OrderController#createOrder。\n系统用 Controller、Service、Repository 分层处理订单和事务。',
    'Order/OrderController.java': 'package shop;\nimport shop.OrderService;\n@RestController\npublic class OrderController {\n private final OrderService orderService;\n @PostMapping("/orders")\n public Order createOrder(Request request) {\n  return orderService.createOrder(request);\n }\n}',
    'Order/OrderService.java': 'package shop;\nimport shop.OrderRepository;\n@Service\npublic class OrderService {\n private final OrderRepository orderRepository;\n public Order createOrder(Request request) {\n  return orderRepository.save(new Order(request));\n }\n}',
    'Order/OrderRepository.java': 'package shop;\npublic interface OrderRepository extends JpaRepository<Order, Long> {\n Optional<Order> findByOrderNo(String orderNo);\n}'
  };
  const chunks = Object.entries(files).flatMap(([file, text]) => chunkText(file, text));
  const app = createInterviewRuntime(t, { chunks });
  app.answer('Order 项目用分层服务处理订单。');
  await app.ask('say', '介绍 Order 项目？');
  await app.ask('say', '订单创建流程代码在哪里实现？');
  const source = lastSystem(app);
  for (const layer of ['OrderController', 'OrderService', 'OrderRepository']) assert.ok(source.includes(layer + '.java'), layer);
  assert.match(source, /orderService\.createOrder/);
  assert.match(source, /orderRepository\.save/);
  assert.match(source, /interface OrderRepository extends JpaRepository/);
  assert.match(source, /已核对引用|调用关系/);
  assertScoped(app);
});

test('manual ask with a screenshot uses the configured code output budget', async t => {
  const app = createInterviewRuntime(t,{settings:{responseBudgets:{oral:1800,code:5120}}});
  await app.ask('ask', '请修改这段代码，保留输入输出接口');
  assert.ok(imageUrl(app.calls[0]));
  assert.equal(app.calls[0].max_tokens, 5120);
});
