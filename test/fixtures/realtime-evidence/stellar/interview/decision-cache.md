---
schema_version: 1
project_id: synthetic-stellar
doc_type: decision
truth_scope: implemented
status: confirmed
topics: ["缓存", "MySQL"]
related_docs:
  - interview/implementation-cache.md
---
# 星桥调度缓存选型与取舍

STELLAR_DECISION：选择 MySQL 缓存，因为业务约束要求多个进程核验同一版本。备选 Redis 没有用于缓存真值；相比备选，代价是额外连接和版本失效处理。验证通过缓存命中、版本冲突和超时测试；此结论限于单机演示。没有采用 Redisson 分布式锁。
