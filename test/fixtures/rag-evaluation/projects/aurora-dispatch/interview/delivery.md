---
schema_version: 1
project_id: synthetic-aurora
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

# 极光配送消息重复

RabbitMQ 命令包含 dispatchId 与 eventId。消费者以 Redis 租约持有者 dispatchId 核验执行身份，再将终态写入 MySQL；重复命令复用原租约，不重新分配骑手。ACK 在终态持久化之后。

## 阶段恢复

配送通知失败时只重试 notification 阶段，沿用原 dispatchId。已经确认的骑手任务不重新派发，也不清除未过期的原租约。
