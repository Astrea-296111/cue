---
schema_version: 1
project_id: synthetic-aurora
doc_type: decision
truth_scope: implemented
status: confirmed
topics:
  - 资源真值
  - 选型
  - 一致性
---

# 极光配送资源真值选型

选择 Redis Lua 租约的理由是模拟骑手在线状态变化频繁，短期令牌需要原子获取与自动过期。MySQL 仍保存派单结果，但不承担在线令牌竞争。

## 约束

该演示只保证单机测试环境的行为，跨地域写入还没有实现。
