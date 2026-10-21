'use strict';
const path = require('node:path');
const { createInterviewRuntime } = require('./interview-agent-runtime');
const FIXTURES = path.resolve(__dirname, '../fixtures/realtime-evidence');

async function createEvidenceRuntime(t, options = {}) {
  const runtime = createInterviewRuntime(t, { ...options, indexSnapshot: options.indexSnapshot ||
    { version: 2, chunkerVersion: 4, metadataSchemaVersion: 3, projects: [], chunks: [], stats: {} } });
  await runtime.ready;
  if (!options.indexSnapshot) {
    const knowledge = runtime.exports('src/project-knowledge.js');
    await knowledge.importProjectFolder(path.join(FIXTURES, 'pine'));
    await knowledge.importProjectFolder(path.join(FIXTURES, 'stellar'));
  }
  runtime.metrics = () => {
    const line = runtime.logs.filter(args => String(args[0]).startsWith('[latency][prompt] ')).at(-1)?.[0];
    return line ? JSON.parse(line.slice('[latency][prompt] '.length)) : null;
  };
  runtime.sdkText = () => runtime.calls.at(-1)?.messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n') || '';
  runtime.evidence = () => runtime.events.filter(event => event.channel === 'llm:evidence').at(-1);
  return runtime;
}

// Development and held-out phrasings live only in test/benchmark code. They are
// never inserted into production aliases or used to tune semantic thresholds.
const CASES = [
  ...['缓存读取如何实现？', '缓存版本校验怎么实现？', '缓存失效以后如何重新加载？', '缓存命中时怎么返回？',
    'CacheService 的缓存读取如何实现？', '缓存读取的 TTL 是多少？', '具体如何实现缓存版本检查？',
    '缓存读取从哪个方法进入？', '缓存版本变化时如何处理？', '缓存失效后的重新加载怎么实现？']
    .map(question => ({ question, facts: ['CACHE'], type: 'implementation' })),
  ...['为什么选择缓存方案？', '缓存选型有什么约束和取舍？', '缓存方案为什么这么选？',
    '缓存选型考虑过什么备选？', '为什么采用这个缓存设计？', '缓存选型的代价是什么？']
    .map(question => ({ question, facts: ['DECISION'], type: 'decision' })),
  ...['缓存这部分你负责什么？', '缓存模块哪些是你本人实现的？', '你在缓存模块的个人贡献是什么？', '你负责缓存的哪些工作？']
    .map(question => ({ question, facts: ['OWNERSHIP'], type: 'ownership' })),
  ...['缓存接口怎么和 Python 同事协作？', '缓存协议变更怎么联调？', '缓存开发的团队分工和协作是什么？', '缓存接口协作如何验证契约？']
    .map(question => ({ question, facts: ['COLLABORATION'], type: 'collaboration' })),
  ...['缓存的测试指标和环境是什么？', '缓存压测的 P95 延迟以及机器配置是什么？',
    '缓存测试吞吐量和组件版本是什么？', '缓存性能测量的单位和测试环境是什么？']
    .map(question => ({ question, facts: ['PERFORMANCE', 'ENVIRONMENT'], type: 'performance' })),
  ...['缓存故障注入遇到的困难是什么？', '缓存重试的难点怎么解决并验证？',
    '缓存测试中最大的挑战是什么？', '缓存超时故障的难点如何排查？']
    .map(question => ({ question, facts: ['CHALLENGE'], type: 'challenge' })),
  { question: '缓存是否已经使用 Kafka？', facts: [], missing: true },
  { question: '发生过什么真实生产事故？', facts: [], missing: true },
  { question: '你担任团队负责人负责管理什么？', facts: [], missing: true },
  { question: 'MissingService 的源码在哪里实现？', facts: [], missing: true },
  { question: '缓存如何实现？为什么这么选？本人负责什么？', facts: ['CACHE', 'DECISION', 'OWNERSHIP'] },
  { question: '缓存怎么实现？怎么与同事协作？测试环境是什么？', facts: ['CACHE', 'COLLABORATION', 'ENVIRONMENT'] },
  { question: '缓存为什么这样选？测试指标是什么？有哪些限制？', facts: ['DECISION', 'PERFORMANCE', 'LIMITATION'] },
  { question: '缓存故障的难点是什么？你负责什么？部署环境是什么？', facts: ['CHALLENGE', 'OWNERSHIP', 'ENVIRONMENT'] }
].map((item, index) => ({ ...item, split: index < 20 ? 'development' : 'heldout',
  project: index % 2 ? '星桥调度' : '松塔订单', prefix: index % 2 ? 'STELLAR' : 'PINE' }));

module.exports = { createEvidenceRuntime, CASES, FIXTURES };
