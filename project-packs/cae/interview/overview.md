---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: overview
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.overview", "projectId": "cae", "docType": "overview", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["概览", "整体", "链路", "架构"], "related": ["cae.state"], "sources": [{"path": "README.md", "symbol": "Development", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "overview", "value": "CAE 公开复现用 Java 后端管理 Job 与 Execution，MySQL 保存业务事实，RabbitMQ 传命令，Python Agent 启动独立 mock Solver，解析、后处理和 PPTX 报告后才完成任务。合成 Case 与模拟求解器验证控制面，不复现商业求解算法或公司生产数据。"}]} -->
CAE 公开复现用 Java 后端管理 Job 与 Execution，MySQL 保存业务事实，RabbitMQ 传命令，Python Agent 启动独立 mock Solver，解析、后处理和 PPTX 报告后才完成任务。合成 Case 与模拟求解器验证控制面，不复现商业求解算法或公司生产数据。
