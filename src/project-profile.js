'use strict';

const { tokenize } = require('./project-search');

const INTERVIEW_INTENTS = [
  { key: 'overview', re: /介绍|概览|整体|架构|流程|是什么|背景/i },
  { key: 'tradeoff', re: /为什么|为何|选型|取舍|不用|替代|trade.?off/i },
  { key: 'failure', re: /故障|失败|问题|事故|线上|排查|恢复/i },
  { key: 'performance', re: /性能|优化|qps|延迟|吞吐|压测/i },
  { key: 'responsibility', re: /负责|贡献|做了什么|实现|设计/i }
];

function detectInterviewIntent(query) {
  const value = String(query || '');
  return INTERVIEW_INTENTS.filter(x => x.re.test(value)).map(x => x.key);
}

const TOPICS = [
  { key: 'overview', label: '项目概览', re: /项目|系统|平台|服务|overview|readme|简介|背景|目标/i },
  { key: 'architecture', label: '架构与核心链路', re: /架构|链路|流程|调用|模块|architecture|workflow|pipeline|controller|service/i },
  { key: 'responsibility', label: '我的职责', re: /负责|职责|主导|参与|设计|实现|优化|owner|responsib|implemented|designed/i },
  { key: 'database', label: '数据库与数据一致性', re: /mysql|postgres|数据库|事务|索引|mvcc|一致性|transaction|repository|dao/i },
  { key: 'cache', label: '缓存与 Redis', re: /redis|缓存|cache|分布式锁|lock/i },
  { key: 'mq', label: '消息与异步', re: /kafka|rocketmq|rabbitmq|消息|mq|队列|异步|event/i },
  { key: 'reliability', label: '可靠性与故障处理', re: /重试|幂等|熔断|限流|超时|故障|降级|retry|idempot|circuit|timeout|ratelimit/i },
  { key: 'performance', label: '性能与优化', re: /性能|优化|qps|延迟|吞吐|压测|performance|latency|throughput/i },
  { key: 'security', label: '认证与权限', re: /认证|鉴权|权限|jwt|oauth|security|auth/i },
  { key: 'deploy', label: '部署与可观测', re: /docker|kubernetes|k8s|部署|监控|日志|指标|prometheus|grafana|deploy|observ/i },
  { key: 'testing', label: '测试与质量', re: /测试|单测|集成测试|test|junit|pytest|quality/i },
  { key: 'tradeoff', label: '技术选型与取舍', re: /选型|取舍|为什么选|trade.?off|choose|choice/i }
];

const TECH_NAMES = [
  'Java', 'Go', 'Python', 'JavaScript', 'TypeScript', 'Spring Boot', 'Spring Cloud',
  'MySQL', 'PostgreSQL', 'Redis', 'MongoDB', 'Elasticsearch', 'Kafka', 'RocketMQ',
  'RabbitMQ', 'Docker', 'Kubernetes', 'K8s', 'gRPC', 'WebSocket', 'REST', 'RAG',
  'LangChain', 'LangGraph', 'MCP', 'LLM', 'React', 'Vue', 'Node.js'
];

function clean(value) { return String(value || '').trim(); }
function clip(value, limit) {
  const text = clean(value);
  return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
}
function termSet(value) { return new Set(tokenize(value, true)); }
function overlap(a, b) {
  let score = 0;
  for (const term of a) if (b.has(term)) score++;
  return score;
}

function classifyCard(text, title = '') {
  const combined = `${title}\n${text}`;
  const found = TOPICS.filter(topic => topic.re.test(combined));
  return found.length ? found.map(x => x.key) : ['overview'];
}

function parseManualProjectProfile(text) {
  const raw = clean(text);
  if (!raw) return { raw: '', cards: [] };
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const cards = [];
  let title = '项目资料';
  let body = [];
  const flush = () => {
    const value = clean(body.join('\n'));
    if (!value) { body = []; return; }
    cards.push({ title, text: value, topics: classifyCard(value, title), terms: [...termSet(`${title}\n${value}`)] });
    body = [];
  };
  for (const line of lines) {
    const md = /^\s*#{1,6}\s+(.{2,60})\s*$/.exec(line);
    const plain = /^\s*([^：:]{2,28})[：:]\s*$/.exec(line);
    if (md || plain) {
      flush();
      title = clean((md || plain)[1]);
    } else if (!line.trim() && body.join('\n').length > 900) {
      flush();
    } else {
      body.push(line);
    }
  }
  flush();
  if (!cards.length) cards.push({ title: '项目资料', text: raw, topics: classifyCard(raw), terms: [...termSet(raw)] });
  return { raw, cards };
}

function selectManualProjectCards(text, query, limit = 1800) {
  const profile = parseManualProjectProfile(text);
  if (!profile.cards.length) return '';
  const qTerms = termSet(query);
  const intents = detectInterviewIntent(query);
  const ranked = profile.cards.map((card, index) => {
    const topicBoost = TOPICS.some(topic => topic.re.test(query) && card.topics.includes(topic.key)) ? 4 : 0;
    const intentBoost = intents.some(intent => card.topics.includes(intent)) ? 3 : 0;
    return { card, index, score: overlap(new Set(card.terms), qTerms) + topicBoost + intentBoost };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  let output = '';
  for (const row of ranked) {
    if (output.length >= limit) break;
    if (row.score === 0 && output) break;
    const label = `【${row.card.title}】\n`;
    const room = limit - output.length - label.length - 2;
    if (room < 100) break;
    output += (output ? '\n\n' : '') + label + clip(row.card.text, Math.min(room, 900));
  }
  return output || clip(profile.raw, limit);
}

function buildSourceProjectProfile(name, chunks = []) {
  const sample = chunks.slice(0, 1200);
  const technologyText = sample.map(c => `${c.path}\n${c.symbol || ''}\n${String(c.text || '').slice(0, 1200)}`).join('\n');
  const technologies = TECH_NAMES.filter(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(technologyText)).slice(0, 24);
  const cards = [];
  for (const topic of TOPICS) {
    const matches = sample
      .filter(chunk => topic.re.test(`${chunk.path}\n${chunk.symbol || ''}\n${chunk.text || ''}`))
      .slice(0, 3)
      .map(chunk => ({ path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine,
        symbol: chunk.symbol || '', text: clip(chunk.text, 520) }));
    if (matches.length) cards.push({ key: topic.key, title: topic.label, evidence: matches });
  }
  return { name: clean(name) || 'Project', technologies, cards };
}

function selectSourceProfileCards(profile, query, limit = 1100) {
  if (!profile || !Array.isArray(profile.cards) || !profile.cards.length) return '';
  const qTerms = termSet(query);
  const ranked = profile.cards.map((card, index) => {
    const topic = TOPICS.find(x => x.key === card.key);
    const score = overlap(termSet(`${card.title} ${card.key}`), qTerms) + (topic?.re.test(query) ? 5 : 0);
    return { card, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.filter((x, i) => x.score > 0 || i === 0).slice(0, 2);
  let out = '';
  for (const { card } of selected) {
    for (const ev of card.evidence || []) {
      const label = `【${profile.name} · ${card.title}】${ev.path}:${ev.startLine}-${ev.endLine}${ev.symbol ? ' ' + ev.symbol : ''}\n`;
      const room = limit - out.length - label.length - 2;
      if (room < 90) break;
      out += (out ? '\n\n' : '') + label + clip(ev.text, Math.min(420, room));
    }
  }
  if (profile.technologies?.length && out.length < limit - 80) {
    out += `${out ? '\n\n' : ''}技术栈线索：${profile.technologies.join('、')}`;
  }
  return clip(out, limit);
}

module.exports = {
  TOPICS,
  detectInterviewIntent,
  parseManualProjectProfile,
  selectManualProjectCards,
  buildSourceProjectProfile,
  selectSourceProfileCards
};
