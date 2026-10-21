---
schema_version: 1
project_id: synthetic-pine
doc_type: performance
truth_scope: test_only
status: confirmed
topics: ["缓存", "测试指标"]
related_docs:
  - interview/environment.md
---
# 松塔订单缓存测试指标

PINE_PERFORMANCE：本地 Linux 2 核 CPU、8 GB 内存单机，Redis 与 Java 同机；合成 1000 条输入，4 客户端、持续 60 秒。实测吞吐 120 QPS，客户端 P95 延迟 50 ms，包含网络且不含排队。这里只是测试指标，未提供线上收益或生产 SLA。
