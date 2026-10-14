---
schema_version: 1
project_id: synthetic-tide
doc_type: implementation
truth_scope: implemented
status: confirmed
topics:
  - 资源准入
  - MySQL
  - Redis
code_refs:
  - path: server/src/BookingService.java
    symbol: BookingService#reserve
---

# 潮汐预约资源准入

预约名额由 MySQL 条件 UPDATE 扣减。库存只在 available >= requested 时修改，并在同一事务写入预约；Redis 只缓存展示数据，不负责资源预占。

## 调用位置

BookingService#reserve 是预约准入入口。创建记录不会自动发出通知，通知在后续阶段执行。
