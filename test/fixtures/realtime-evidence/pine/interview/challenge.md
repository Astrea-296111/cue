---
schema_version: 1
project_id: synthetic-pine
doc_type: challenge
truth_scope: test_only
status: confirmed
topics: ["缓存", "故障", "重试"]
---
# 松塔订单缓存故障注入难点

PINE_CHALLENGE：测试环境的困难是超时后重复重试。我定位到 requestId 变化造成重复处理，修复为复用请求身份，并通过 200 次故障注入测试验证没有重复确认；当前验证不覆盖生产事故。
