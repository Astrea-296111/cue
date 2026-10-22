---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.state", "projectId": "cae", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["状态机", "CAS", "version", "终态", "Job", "Execution"], "related": ["cae.recovery"], "sources": [{"path": "docs/state-machine.md", "symbol": "Job state machine", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "state", "value": "Job 业务状态和 Agent 执行事实分离。更新检查观察到的 status 与 version，状态、事件、Outbox 在同一事务提交；Solver 成功后仍需解析和报告，不能直接标 Job SUCCESS。重复当前状态幂等，终态拒绝延迟 RUNNING，UNKNOWN 恢复同一次执行而非重投。"}]} -->
Job 业务状态和 Agent 执行事实分离。更新检查观察到的 status 与 version，状态、事件、Outbox 在同一事务提交；Solver 成功后仍需解析和报告，不能直接标 Job SUCCESS。重复当前状态幂等，终态拒绝延迟 RUNNING，UNKNOWN 恢复同一次执行而非重投。
