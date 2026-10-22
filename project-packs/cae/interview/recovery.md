---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: challenge
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.recovery", "projectId": "cae", "docType": "challenge", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["困难", "故障", "对账", "恢复", "重启", "超时", "解决"], "related": ["cae.resources"], "sources": [{"path": "docs/monitoring-reconciliation.md", "symbol": "ExecutionMonitor", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "recovery", "value": "执行接收后响应丢失会导致提交结果不确定。ExecutionMonitor 用原 submitRequestId 或 externalExecutionId 查询，HTTP 调用在事务外，应用结果核对 lease owner、generation、身份与当前执行。它不新建 Execution 或重新 submit；404、断联和心跳过期仍保留 UNKNOWN 容量。"}]} -->
执行接收后响应丢失会导致提交结果不确定。ExecutionMonitor 用原 submitRequestId 或 externalExecutionId 查询，HTTP 调用在事务外，应用结果核对 lease owner、generation、身份与当前执行。它不新建 Execution 或重新 submit；404、断联和心跳过期仍保留 UNKNOWN 容量。
