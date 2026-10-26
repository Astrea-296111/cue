'use strict';
// Subjects are independent. Never infer an input-token experiment from an unrelated MCP/benchmark question.
const SUBJECTS = [
  ['metric.cae.batch.accept.p95', /281|批次.*(?:受理|延迟)|受理.*(?:批次|P95)/i],
  ['metric.cae.replay', /500|重放|重复.*(?:进程|启动)/i],
  ['metric.cae.recovery.p95', /12\.6|30轮|恢复.*(?:收敛|耗时)|收敛.*(?:恢复|P95)/i],
  ['metric.cae.input', /120组|46组|74组|输入.*(?:预检|回归|拦截)/i],
  ['metric.cae.report', /报告.*(?:分钟|整理|耗时|指标)|45.*(?:5|8)/i],
  ['metric.arc.context', /31\.57|60项|累计输入|长会话|(?:压缩|上下文).*(?:Token|成本|实验)/i],
  ['metric.arc.mcp', /50.*MCP|18\.6|4\.2|初始.*(?:工具|注入)|MCP.*(?:初始|注入|Token)/i],
  ['metric.arc.parallel', /独立探索|多代理.*(?:耗时|并行|实验)|探索.*(?:对照|并行)/i],
  ['metric.arc.swe', /300.{0,10}(?:道|题|修复)|修复题|评测成绩|SWE|Sweetie.?Bench|benchmark|31\.33|43\.67|解决率|消融|骁龙实验|跑过.*(?:基准|评测)|分数多少/i]
];
function matches(question, projectIds) { return SUBJECTS.filter(([id,re]) => re.test(question) && projectIds.includes(id.includes('.cae.') ? 'cae' : 'arclight')).map(([id])=>id); }
function build(cards) { return new Map(SUBJECTS.map(([id])=>[id,cards.find(c=>c.cardId===id)]).filter(([,card])=>card)); }
module.exports = { matches, build, SUBJECTS };
