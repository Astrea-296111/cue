---
schema_version: 1
project_id: synthetic-pine
doc_type: implementation
truth_scope: implemented
status: confirmed
topics: ["缓存", "Redis"]
code_refs:
  - path: src/CacheService.java
    symbol: CacheService#read
related_docs:
  - interview/decision-cache.md
  - interview/ownership.md
  - interview/collaboration.md
  - interview/performance.md
  - interview/environment.md
---
# 松塔订单缓存读取实现

PINE_CACHE：松塔订单的缓存读取由 CacheService#read 进入，检查 Redis 缓存版本，命中时返回，失效后重新加载；TTL 为 30 秒。MySQL 不作为缓存版本真值。完整返回与错误处理见对应源码。
