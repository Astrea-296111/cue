---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.cancel", "projectId": "cae", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["取消", "竞态", "完成", "回调", "单调"], "related": [], "sources": [{"path": "docs/monitoring-reconciliation.md", "symbol": "RemoteExecutionStateService", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "cancel", "value": "取消意图独立持久化，RPC 失败或身份不符仍保留意图和资源，恢复后继续取消。Solver 完成可能先胜出；回调、轮询与取消确认汇合到 RemoteExecutionStateService，通过身份与终态单调检查阻止旧 attempt 覆盖新执行。"}]} -->
取消意图独立持久化，RPC 失败或身份不符仍保留意图和资源，恢复后继续取消。Solver 完成可能先胜出；回调、轮询与取消确认汇合到 RemoteExecutionStateService，通过身份与终态单调检查阻止旧 attempt 覆盖新执行。
