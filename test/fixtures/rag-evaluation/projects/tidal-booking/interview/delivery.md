---
schema_version: 1
project_id: synthetic-tide
doc_type: implementation
truth_scope: implemented
status: confirmed
topics:
  - RabbitMQ
  - 重复
  - 重试
  - ACK
  - 恢复
---

# 潮汐预约消息重复

RabbitMQ 命令包含 bookingId 与 eventId。消费者把 eventId 写入 MySQL inbox 唯一键，重复投递只返回已保存结果，不再次扣名额。ACK 在事务提交之后。

## 阶段恢复

生成提醒失败时只重试 reminder 阶段，沿用原 bookingId 和 eventId。已经成功的名额扣减不重做，也不重新创建预约。
