---
schema_version: 1
project_id: cae
project_name: CAE
resume_order: 1
aliases: ["cae-job-platform", "仿真任务平台"]
source_revision: ci-public-synthetic-v1
code_roots: ["samples"]
doc_type: overview
truth_scope: test_only
status: confirmed
topics: ["架构", "概览", "Java", "Job", "Execution"]
---
# CAE 公开复现与 CI 样例

公开技术来源：Astrea-296111/cae-job-platform，commit c50dd29d1b1981e299d2ce4821e0a1ef745aa48e，README.md#Development、docs/state-machine.md、docs/mq-and-outbox.md。Java 后端管理 Job 和 Execution，MySQL 保存业务事实，RabbitMQ 传命令，Python Agent 启动独立 mock Solver；解析、后处理和 PPTX 报告后才完成任务。公开替身验证控制面，不复现商业求解算法或公司生产数据。

此目录 samples 是明确合成的最小演示，不是完整上游源码，也不是上游文件的逐字复制。它只提供可导入、可检索、可定位的 CI 测试源文件。
