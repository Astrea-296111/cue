'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REDACTED = '[REDACTED]';
const sensitiveKey = /^(?:(?:x[-_])?api[-_]?keys?|(?:qwen|deepseek)[-_]api[-_]?key|authorization|proxy-authorization|password|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|cookie|set-cookie)$/i;
const round = value => Number.isFinite(value) ? +value.toFixed(2) : null;

/** Reports contain approved fixture answers, never transport headers or credentials. */
function sanitizeText(value, { secrets = [], workspaceRoot, tempRoots = [] } = {}) {
  let result = String(value ?? '');
  const variants = secrets.filter(value => typeof value === 'string' && value)
    .flatMap(secret => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]);
  for (const secret of [...new Set(variants)].sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join(REDACTED);
  }
  result = result
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer ' + REDACTED)
    .replace(/\b((?:QWEN|DEEPSEEK)_API_KEY\s*[=:]\s*)[^\s,;"'<>]+/gi, '$1' + REDACTED)
    .replace(/(["']?\b(?:authorization|proxy-authorization|x-api-key|api[-_]?key)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi, '$1' + REDACTED)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED);
  for (const root of [workspaceRoot, ...tempRoots].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // Also cover native Windows paths when a report is produced on Linux.
    for (const variant of new Set([String(root), String(root).replace(/\\/g, '/')])) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped + '[^\\s"\'<>|]*', 'g'), '[local path]');
    }
  }
  return result
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]*/g, '[local path]')
    .replace(/(^|[\s("'=])\/(?:workspace|tmp|private|Users|home|root|var|etc|opt|mnt|run|data|app|builds|github|dev)(?:\/[^\s"'<>|]*)?/gm, '$1[local path]');
}

function sanitizeReport(value, options = {}) {
  if (typeof value === 'string') return sanitizeText(value, options);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => sanitizeReport(item, options));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = sanitizeText(key, options);
    result[safeKey] = sensitiveKey.test(key) ? REDACTED : sanitizeReport(item, options);
  }
  return result;
}

// Nearest-rank percentiles: an observed measurement, with no interpolation.
function distribution(values) {
  const sorted = values.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const percentile = fraction => sorted.length ? round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]) : null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
}

const usageFields = ['actualInputTokens', 'actualOutputTokens', 'actualTotalTokens', 'cachedInputTokens', 'actualReasoningTokens'];
function summarizeCases(cases, kind) {
  const attempts = cases.flatMap(item=>item.attempts?.length?item.attempts:[item]);
  const attempted = attempts.filter(item => item.attempted === true);
  const scored = kind === 'mock' ? [] : cases.filter(item => item.attempted === true && item.quality && item.quality.scored !== false &&
    (typeof item.quality.deterministic?.passed === 'boolean' || ['passed-listed-checks', 'needs-review', 'failed'].includes(item.quality.qualityStatus)));
  const timeoutCount = attempted.filter(item => /^(?:first-content-timeout|total-timeout|timeout)$/i.test(item.error?.code || '')).length;
  const callFailureCount = attempted.filter(item => {
    if (item.transportStatus) return item.transportStatus === 'failed';
    return !!item.error && !/^(?:quality|pipeline|evidence|fixture|approval|configuration|config|budget)(?:[-_]|$)/i.test(item.error.code || '');
  }).length;
  const usage = {};
  for (const key of usageFields) {
    const observed = attempts.map(item => item.usage?.[key] ?? item.metrics?.[key])
      .filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    usage[key] = observed.length ? observed.reduce((sum, value) => sum + value, 0) : null;
  }
  return {
    caseCount: cases.length,
    requestCount: attempted.length,
    retryCount: cases.reduce((n,item)=>n+Math.max(0,(item.attempts?.length||1)-1),0),
    timeoutCount,
    timeoutRate: attempted.length ? timeoutCount / attempted.length : null,
    callFailureCount,
    callFailureRate: attempted.length ? callFailureCount / attempted.length : null,
    qualityScoredCases: scored.length,
    deterministicPassedCases: scored.length ? scored.filter(item => item.quality.deterministic?.passed === true).length : null,
    qualityNeedsReviewCases: scored.length ? scored.filter(item => item.quality.qualityStatus === 'needs-review').length : null,
    coveredListedChecksCases: scored.length ? scored.filter(item => item.quality.qualityStatus === 'passed-listed-checks').length : null,
    passedCases: cases.filter(item => item.status === 'passed').length,
    failedCases: cases.filter(item => item.status === 'failed').length,
    uncompletedCases: cases.filter(item => !['passed', 'failed'].includes(item.status)).length,
    firstContentMs: distribution(cases.map(item => item.metrics?.firstContentMs)),
    triggerToFirstContentMs: distribution(cases.map(item => item.metrics?.triggerToFirstContentMs)),
    doneMs: distribution(cases.map(item => item.metrics?.doneMs)),
    firstSentenceMs: distribution(cases.map(item=>item.metrics?.firstSentenceMs)),
    rendererDeliveryMs: distribution(cases.map(item=>item.metrics?.rendererDeliveryMs)),
    renderConfirmedMs: distribution(cases.map(item=>item.metrics?.renderConfirmedMs)),
    requestDispatchMs: distribution(cases.map(item=>item.metrics?.requestDispatchMs)),
    audioEndToFinalMs: distribution(cases.map(item=>item.metrics?.audioEndToFinalMs)),
    lateBodyRate: attempted.length ? attempted.filter(item=>(item.metrics?.triggerToFirstContentMs??item.metrics?.firstContentMs)>8000).length/attempted.length : null,
    usage,
    usageObservedCases: cases.filter(item => usageFields.some(key => typeof (item.usage?.[key] ?? item.metrics?.[key]) === 'number')).length,
    usageObservedAttempts: attempts.filter(item => usageFields.some(key => typeof (item.usage?.[key] ?? item.metrics?.[key]) === 'number')).length
  };
}

function summarize(report) {
  const providers = (report.providers || []).map(provider => ({
    id: provider.id, model: provider.model || null, status: provider.status,
    ...summarizeCases(provider.cases || [], report.kind)
  }));
  const allCases=(report.providers || []).flatMap(provider => provider.cases || []);
  const statistics=summarizeCases(allCases,report.kind);
  const generationCalls=Number.isFinite(report.budget?.attemptedCalls)?report.budget.attemptedCalls:statistics.requestCount;
  const judgeCalls=Number.isFinite(report.judging?.attempts)?report.judging.attempts:0;
  const dynamicActorCalls=Number.isFinite(report.dynamicActors?.attempts)?report.dynamicActors.attempts:0;
  const thresholds={contextPreparationP95Ms:200,rendererDeliveryP50Ms:1500,rendererDeliveryP95Ms:3000,firstSentenceP95Ms:5000,lateBodyRate:0.01,requestSuccessRate:0.99};
  return { kind: report.kind, status: report.status, mode: report.mode,...statistics, providers,
    calls:{generation:generationCalls,judges:judgeCalls,dynamicActors:dynamicActorCalls,total:generationCalls+judgeCalls+dynamicActorCalls},
    performance:{thresholds,physicalRenderingVerified:statistics.renderConfirmedMs.count>0,
      rendererDelivery:statistics.rendererDeliveryMs.count?statistics.rendererDeliveryMs.p50<=1500&&statistics.rendererDeliveryMs.p95<=3000:null,
      firstSentence:statistics.firstSentenceMs.count?statistics.firstSentenceMs.p95<=5000:null,
      lateBody:statistics.lateBodyRate==null?null:statistics.lateBodyRate<=0.01,
      requestSuccess:statistics.callFailureRate==null?null:1-statistics.callFailureRate>=0.99,
      sampleNote:'Observed finite sample only; virtual renderer IPC is not a physical first-screen measurement.'},
    byMode:[...new Set(allCases.map(item=>item.mode).filter(Boolean))].map(mode=>({mode,...summarizeCases(allCases.filter(item=>item.mode===mode),report.kind)})) };
}

const cell = value => String(value ?? '未知').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const ms = value => typeof value === 'number' ? `${value} ms` : '未知';
const rate = value => typeof value === 'number' ? `${round(value * 100)}%` : '未知';
const ids = value => (value || []).map(cell).join(', ') || '无';
function fenced(value, language = '') {
  const text = String(value ?? '');
  const runs = text.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}

function overview(report, summary) {
  const label = report.kind === 'mock'
    ? '**MOCK：使用本地合成传输，没有调用外部模型。**'
    : '**LIVE：真实外部 API 评测模式；实际调用与成功以请求数和状态为准，缺配置或调用失败计为失败。**';
  const lines = ['# CUE 模型评测', '', label, '',
    `状态：**${cell(report.status)}** · 模式：${cell(report.mode)} · 开始：${cell(report.startedAt)} · 结束：${cell(report.finishedAt)}`,
    '', `提交：${cell(report.build?.commit)} · Node：${cell(report.build?.node)} · 公开夹具审批：${cell(report.approval?.id)}`,
    '', `用例：${summary.caseCount} · 通过：${summary.passedCases} · 失败：${summary.failedCases} · 未完成：${summary.uncompletedCases}`,
    '', `已发起请求：${summary.requestCount} · 调用失败：${summary.callFailureCount}（${rate(summary.callFailureRate)}） · 超时：${summary.timeoutCount}（${rate(summary.timeoutRate)}）`,
    '', `全部推理尝试：${summary.calls.total}（生产问答 ${summary.calls.generation}、裁判 ${summary.calls.judges}、动态候选人/追问 ${summary.calls.dynamicActors}）。失败重试全部计入。`,
    '', '首正文只统计非空正文，reasoning 和空白不计入。p50/p95 使用已观测值的 nearest-rank；未知指标保留为未知。', '',
    '| 服务 | 模型 | 状态 | 无阻断错误 / 用例 | 首正文 p50 / p95 | 触发到首正文 p50 / p95 | 完整响应 p50 / p95 | 实际输入 / 输出 token |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const provider of summary.providers) {
    lines.push(`| ${cell(provider.id)} | ${cell(provider.model)} | ${cell(provider.status)} | ${provider.passedCases} / ${provider.caseCount} | ${ms(provider.firstContentMs.p50)} / ${ms(provider.firstContentMs.p95)} | ${ms(provider.triggerToFirstContentMs.p50)} / ${ms(provider.triggerToFirstContentMs.p95)} | ${ms(provider.doneMs.p50)} / ${ms(provider.doneMs.p95)} | ${cell(provider.usage.actualInputTokens)} / ${cell(provider.usage.actualOutputTokens)} |`);
  }
  lines.push('', '| 服务 | 已发起请求 | 调用失败数 / 失败率 | 超时数 / 超时率 |',
    '| --- | --- | --- | --- |');
  for (const provider of summary.providers) lines.push(`| ${cell(provider.id)} | ${provider.requestCount} | ${provider.callFailureCount} / ${rate(provider.callFailureRate)} | ${provider.timeoutCount} / ${rate(provider.timeoutRate)} |`);
  lines.push('', '| 服务 | 真实质量已检查用例 | 确定契约通过 | 需要人工复核 | 列举规则覆盖 |',
    '| --- | --- | --- | --- | --- |');
  for (const provider of summary.providers) lines.push(`| ${cell(provider.id)} | ${provider.qualityScoredCases} | ${cell(provider.deterministicPassedCases)} | ${cell(provider.qualityNeedsReviewCases)} | ${cell(provider.coveredListedChecksCases)} |`);
  lines.push('', `确定契约通过：${cell(summary.deterministicPassedCases)} · 需要人工复核：${cell(summary.qualityNeedsReviewCases)} · 列举规则覆盖：${cell(summary.coveredListedChecksCases)}`, '',
    '状态 passed 只表示没有阻断错误。确定契约通过和列举规则覆盖均只覆盖预先列出的检查，不能证明模型回答质量完全通过或所有陈述均有证据；需要人工复核的内容单独列出。Mock 不计入真实模型质量统计，没有真实检查结果时保留为未知。', '',
    '调用失败率、超时率仅以实际发起的请求为分母；质量规则失败不算调用失败。没有请求时比率为未知。', '',
    `usage 有记录的用例：${summary.usageObservedCases}/${summary.caseCount}。token 为服务端实际 usage，不以本地估算冒充。`, '',
    '## 调用预算', '', fenced(JSON.stringify(report.budget || {}, null, 2), 'json'), '', '## 失败列表', '');
  if (!report.failures?.length) lines.push('无。');
  else for (const failure of report.failures) lines.push(`- ${cell(failure.provider)} / ${cell(failure.caseId)}：${cell(failure.code)} — ${cell(failure.message)}`);
  return lines;
}

function markdown(report) {
  const safe = sanitizeReport(report);
  const lines = overview(safe, summarize(safe));
  lines.push('', '## 逐题完整回答', '');
  for (const provider of safe.providers || []) {
    if (provider.error) lines.push(`服务 ${cell(provider.id)} 错误：${cell(provider.error.message || provider.error)}`, '');
    for (const item of provider.cases || []) {
      lines.push(`### ${cell(provider.id)} / ${cell(item.id)}`, '',
        `状态：${cell(item.status)} · 会话：${cell(item.sessionId)} · 回答模式：${cell(item.mode)}`, '',
        '问题：', '', fenced(item.question), '', '回答：', '', fenced(item.answer || ''), '',
        `项目：${ids(item.projectIds)}`, '', `实际发送事实 ID：${ids(item.sentFactIds)}`, '', `实际发送源码 ID：${ids(item.sentSourceIds)}`, '',
        '指标、完成状态和规则检查：', '', fenced(JSON.stringify({ metrics: item.metrics || {}, usage: item.usage || {},
          completion: item.completion || {}, quality: item.quality || {}, ...(item.error ? { error: item.error } : {}) }, null, 2), 'json'), '');
      if(item.dialogueEvents) lines.push('真实事件回放：','',fenced(JSON.stringify(item.dialogueEvents,null,2),'json'),'');
      if(item.actualMessages) lines.push('实际发送的上下文：','',fenced(JSON.stringify(item.actualMessages,null,2),'json'),'');
      if(item.attempts) lines.push('全部尝试（包含失败与重试）：','',fenced(JSON.stringify(item.attempts,null,2),'json'),'');
      if(item.judging) lines.push('独立裁判：','',fenced(JSON.stringify(item.judging,null,2),'json'),'');
    }
  }
  lines.push('## 相关代码位置', '');
  for (const position of safe.codePositions || []) lines.push(`- ${cell(position.path)}${position.line ? ':' + cell(position.line) : ''}：${cell(position.role)}`);
  return lines.join('\n') + '\n';
}

function atomicWrite(target, content) {
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeReports(report, { outputDir, summaryPath, sanitize = {} } = {}) {
  if (!outputDir) throw new Error('Report output directory is required.');
  const safe = sanitizeReport(report, sanitize);
  const summary = summarize(safe);
  const document = { ...safe, summary };
  fs.mkdirSync(outputDir, { recursive: true });
  atomicWrite(path.join(outputDir, 'report.json'), JSON.stringify(document, null, 2) + '\n');
  atomicWrite(path.join(outputDir, 'report.md'), markdown(document));
  if (summaryPath) fs.appendFileSync(summaryPath, overview(document, summary).join('\n') + '\n\n', { encoding: 'utf8', mode: 0o600 });
  return document;
}

module.exports = { sanitizeText, sanitizeReport, summarize, markdown, writeReports };
