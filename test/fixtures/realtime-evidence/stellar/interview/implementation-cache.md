---
schema_version: 1
project_id: synthetic-stellar
doc_type: implementation
truth_scope: implemented
status: confirmed
topics: ["缓存", "MySQL"]
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
# 星桥调度缓存读取实现

STELLAR_CACHE：星桥调度的缓存读取由 CacheService#read 进入，检查 MySQL 缓存版本，命中时返回，失效后重新加载；TTL 为 45 秒。Redis 不作为缓存版本真值。完整返回与错误处理见对应源码。
