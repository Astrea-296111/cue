---
schema_version: 1
project_id: synthetic-aurora
doc_type: performance
truth_scope: test_only
status: confirmed
topics:
  - 性能
  - 吞吐量
  - 延迟
  - 测试环境
---

# 极光配送测试指标

此处不是上线收益，不是线上 SLA。

## 测量环境

本地 Linux 虚拟机 4 vCPU、8 GiB RAM；单个 Java 实例；MySQL 8 与 Redis 7 在同机容器；使用合成输入，持续 60 秒，6 个客户端线程。

| 指标 | 数值 | 单位 | 环境与口径 |
| --- | --- | --- | --- |
| 吞吐量 | 96 | 次派单/秒 | 仅成功业务请求，60 秒合成负载 |
| P95 | 71 | ms | 客户端端到端延迟，不含排队等待 |

负载脚本并未模拟真实用户规模，没有生产成本节省、用户数或收益数字。
