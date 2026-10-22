---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: performance
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.performance", "projectId": "cae", "docType": "performance", "truthScope": "implemented", "status": "verified", "provenance": "LOCAL-BENCH", "keywords": ["性能", "压测", "数字", "指标", "批次", "100"], "related": [], "sources": [{"path": "docs/benchmark.md", "symbol": "实际测量", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "performance", "value": "文档记录单台云环境公开复现：100 子任务批次全部成功，端到端 98.583 秒；API 接受只测一个样本。MySQL/Redis/RabbitMQ 与三个 mock Worker 共用 4 核配额和 32GiB 上限。这是 LOCAL-BENCH，不能当作公司线上 KPI 或外推集群吞吐。"}]} -->
文档记录单台云环境公开复现：100 子任务批次全部成功，端到端 98.583 秒；API 接受只测一个样本。MySQL/Redis/RabbitMQ 与三个 mock Worker 共用 4 核配额和 32GiB 上限。这是 LOCAL-BENCH，不能当作公司线上 KPI 或外推集群吞吐。
