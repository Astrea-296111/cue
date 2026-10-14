---
schema_version: 1
project_id: synthetic-aurora
doc_type: challenge
truth_scope: test_only
status: confirmed
topics:
  - 并发
  - 身份
  - 复现
  - 验证
---

# 极光配送并发故障注入

这是测试环境复现，不是生产事故。

## 背景与行动

故障注入模拟发送后客户端超时，重复重投导致同一个派单请求获取新令牌。本人改为冻结 dispatchId，并核验租约持有者；重试复用原身份。500 次注入后没有重复确认同一请求。

## 验证

结论仅适用于本文描述的注入条件，不能证明所有故障均已解决。
