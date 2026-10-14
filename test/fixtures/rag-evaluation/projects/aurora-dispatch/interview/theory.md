---
schema_version: 1
project_id: synthetic-aurora
doc_type: theory
truth_scope: general_knowledge
status: confirmed
topics:
  - 原理
  - 缓存
  - 幂等
---

# 通用知识：消息与缓存

至少一次投递允许重复，业务幂等需要稳定身份与持久去重。Redis 缓存穿透可采用参数校验、空值缓存或布隆过滤器，但这些原理不能证明任意项目已采用对应方案。
