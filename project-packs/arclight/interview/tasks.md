---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.tasks", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["后台任务", "异步", "取消", "进度"], "related": ["arclight.shared"], "sources": [{"path": "mewcode/agents/task_manager.py", "symbol": "TaskManager.launch", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "tasks", "value": "TaskManager 用 asyncio task 管理后台 agent，记录任务标识、运行状态、结果、取消回调与进度，用通知队列向上层交付完成信息。并发派发减少独立工作的串行等待，但任务返回不能替代集成验证；失败与取消也必须保留为明确结果。"}]} -->
TaskManager 用 asyncio task 管理后台 agent，记录任务标识、运行状态、结果、取消回调与进度，用通知队列向上层交付完成信息。并发派发减少独立工作的串行等待，但任务返回不能替代集成验证；失败与取消也必须保留为明确结果。
