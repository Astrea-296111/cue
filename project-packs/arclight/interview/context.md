---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.context", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["上下文", "压缩", "token", "预算", "长输出"], "related": ["arclight.fork"], "sources": [{"path": "mewcode/context/manager.py", "symbol": "CompactBoundary", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "context", "value": "上下文管理分别约束单个和累计工具输出，将大结果落到 .mewcode/session/tool-results 并保留可定位预览。自动压缩保留近期原文窗口、摘要较早前缀，CompactBoundary 携带 summary 和 keep 交给会话层持久化。摘要是有损表示，近期消息与工具结果配对应保持一致。"}]} -->
上下文管理分别约束单个和累计工具输出，将大结果落到 .mewcode/session/tool-results 并保留可定位预览。自动压缩保留近期原文窗口、摘要较早前缀，CompactBoundary 携带 summary 和 keep 交给会话层持久化。摘要是有损表示，近期消息与工具结果配对应保持一致。
