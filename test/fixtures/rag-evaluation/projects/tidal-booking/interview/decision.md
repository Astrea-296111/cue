---
schema_version: 1
project_id: synthetic-tide
doc_type: decision
truth_scope: implemented
status: confirmed
topics:
  - 资源真值
  - 选型
  - 一致性
---

# 潮汐预约资源真值选型

选择 MySQL 条件 UPDATE 的理由是剩余名额与预约记录需要同一数据库事务保证。对比过 Redis Lua，但放弃它作为库存真值，避免两份状态跨组件协调。

## 约束

该演示只保证单机测试环境的行为，跨地域写入还没有实现。
