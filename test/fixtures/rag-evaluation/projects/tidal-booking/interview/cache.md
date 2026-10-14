---
schema_version: 1
project_id: synthetic-tide
doc_type: implementation
truth_scope: implemented
status: confirmed
topics:
  - 缓存
  - Redis
  - 版本
  - TTL
---

# 潮汐预约缓存边界

列表展示缓存 Redis TTL 为 20 秒。写预约后主动删除对应列表键；读取详情先查 MySQL 的 recordVersion，仅接受同版本缓存。缓存不可用时查询 MySQL，不会失去名额账本。

## 原理边界

这里只陈述当前实现，不能从使用 Redis 推断项目使用了分布式锁、Redisson 或持久化模式。
