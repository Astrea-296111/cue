'use strict';

// Shared by both answer modes after reviewing actual provider responses.
const EVIDENCE_BOUNDARIES = '区分当前实现、局部验证、假设和改进建议。幂等键、唯一约束和单库事务不能单独证明外部副作用恰好一次；PID校验不等于分布式fencing，进程标识、租约或时间阈值不自动证明排他性与执行终结。仅使用对应模块的证据，不借解析等其他模块的幂等标记证明资源释放安全。结果未知时，结合资料说明沿同一身份如何查询或核验，不能只说等待确认。测量与验证结论不能扩成所有故障窗口的绝对保证。';

module.exports={EVIDENCE_BOUNDARIES};
