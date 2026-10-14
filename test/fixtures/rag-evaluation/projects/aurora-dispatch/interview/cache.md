---
schema_version: 1
project_id: synthetic-aurora
doc_type: implementation
truth_scope: implemented
status: confirmed
topics:
  - 缓存
  - Redis
  - 版本
  - TTL
---

# 极光配送缓存边界

骑手在线展示 Redis TTL 为 5 秒；令牌键独立，不把展示缓存当租约真值。MySQL 中保存终态，业务不能把在线缓存过期推导为派单成功。

## 原理边界

这里只陈述当前实现，不能从使用 Redis 推断项目使用了分布式锁、Redisson 或持久化模式。
