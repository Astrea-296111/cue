---
schema_version: 1
project_id: synthetic-aurora
doc_type: implementation
truth_scope: implemented
status: confirmed
topics:
  - 资源准入
  - MySQL
  - Redis
code_refs:
  - path: server/src/DispatchService.java
    symbol: DispatchService#assign
---

# 极光配送资源准入

骑手临时派单令牌由 Redis Lua 原子租约分配，租约带 dispatchId 与 15 秒 TTL。MySQL 保存派单记录和终态；这里没有使用 MySQL 条件 UPDATE 作为令牌获取方式。

## 调用位置

DispatchService#assign 是派单准入入口。创建记录不会自动发出通知，通知在后续阶段执行。
