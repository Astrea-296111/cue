---
doc_type: implementation
truth_scope: test_only
status: confirmed
topics: ["状态机", "Outbox", "对账", "资源", "报告", "性能"]
code_refs: [{path: "samples/ExecutionLedger.java", symbol: "applyObservedState"}]
---
# 状态与恢复

以下摘要来自公开 cae-job-platform commit c50dd29d1b1981e299d2ce4821e0a1ef745aa48e 的 docs/state-machine.md、docs/monitoring-reconciliation.md、docs/architecture.md 与 docs/mq-and-outbox.md。

Job 业务状态与 Agent 执行事实分离。状态、事件和 Outbox 在同一事务提交；消费者用 logical eventId 与 consumer 唯一键去重，deliveryId 仅代表物理投递。UNKNOWN 保留资源，执行接收后响应丢失时使用原 submitRequestId 或 externalExecutionId 查询，不能直接新建执行或重新提交。远端查询在事务外，应用结果需要核对 lease owner、generation、执行身份与当前执行。

# 产物与本地测量

docs/post-and-reports.md 说明解析保留版本和不可变 JSON/CSV，报告经过 Lead review/Admin approval，重试复用原 Solver 执行。docs/benchmark.md 记录单环境 LOCAL-BENCH：100 子任务全部成功，端到端 98.583 秒；MySQL、Redis、RabbitMQ 和三个 mock Worker 共用 4 核配额和 32GiB 上限。API 接受只有一个样本。不得把这组公开复现测量写成生产 KPI。
