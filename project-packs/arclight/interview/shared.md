---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.shared", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["共享任务", "依赖", "DAG", "阻塞", "分配"], "related": ["arclight.mailbox"], "sources": [{"path": "mewcode/teams/shared_task.py", "symbol": "SharedTaskStore.update", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "shared", "value": "SharedTaskStore 的 JSON 文件存储任务、assignee、blocks 和 blocked_by，更新后写回；get/list 会重新加载文件。它提供持久任务描述和依赖字段，但该文件读改写本身不是跨进程事务锁，不能据此宣称已保证多进程并发写入一致性。"}]} -->
SharedTaskStore 的 JSON 文件存储任务、assignee、blocks 和 blocked_by，更新后写回；get/list 会重新加载文件。它提供持久任务描述和依赖字段，但该文件读改写本身不是跨进程事务锁，不能据此宣称已保证多进程并发写入一致性。
