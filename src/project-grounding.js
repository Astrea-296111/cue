'use strict';

// Shared by both answer modes after reviewing actual provider responses.
const EVIDENCE_BOUNDARIES = '区分当前实现、局部验证、假设和建议。证据只证明其对应模块和条件；记录存在、去重、租约或进程标识不能单独证明外部执行已完成或恰好一次。源码或资料未明确时，不得编造索引字段、SQL、租约时长、测试脚本、实验步骤或已实现机制；可用“我会”说明建议。外部进程启动不能与数据库事务天然原子提交；先查询不存在再启动存在并发竞态，普通锁或租约到期不能证明旧进程停止。结果未知时先查询有权威的执行状态，无法确认时保留未知，不盲目重启、不承诺绝对不重复。';

const EXPERIENCE_FALLBACK='材料不足时用“我会”说明可行做法与限制；涉及实际经历、贡献或结果而没有依据时明确不确定，不把建议说成已经做过。需要例子时用简短、具体的假设说明。';

module.exports={EVIDENCE_BOUNDARIES,EXPERIENCE_FALLBACK};
