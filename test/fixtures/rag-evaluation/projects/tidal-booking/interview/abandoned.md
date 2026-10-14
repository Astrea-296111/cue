---
schema_version: 1
project_id: synthetic-tide
doc_type: decision
truth_scope: abandoned
status: confirmed
topics:
  - 历史
  - 弃用
  - 选型
---

# 潮汐预约弃用路径

曾试过用 Redis Lua 管理预约库存，后来放弃。当前实现为 MySQL 条件 UPDATE；Lua 方案不是已采用技术。
