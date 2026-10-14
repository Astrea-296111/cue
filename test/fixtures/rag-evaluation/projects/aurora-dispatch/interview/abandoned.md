---
schema_version: 1
project_id: synthetic-aurora
doc_type: decision
truth_scope: abandoned
status: confirmed
topics:
  - 历史
  - 弃用
  - 选型
---

# 极光配送弃用路径

曾考虑所有在线状态都放 MySQL，但放弃数据库轮询方案；当前在线令牌由 Redis Lua 租约处理，MySQL 保留终态。
