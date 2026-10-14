---
schema_version: 1
project_id: synthetic-tide
doc_type: challenge
truth_scope: test_only
status: confirmed
topics:
  - 并发
  - 身份
  - 复现
  - 验证
---

# 潮汐预约并发故障注入

这是测试环境复现，不是生产事故。

## 背景与行动

故障注入模拟两个并发预约同时读到剩余一份名额。本人复现后把先读后写改成条件 UPDATE，检查受影响行数，在事务里写预约。重复运行 1000 次后没有出现库存负数。

## 验证

结论仅适用于本文描述的注入条件，不能证明所有故障均已解决。
