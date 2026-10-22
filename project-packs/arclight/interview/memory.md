---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.memory", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["记忆", "长期", "偏好", "session", "恢复"], "related": [], "sources": [{"path": "mewcode/memory/auto_memory.py", "symbol": "MEMORY_EXTRACTION_PROMPT", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "memory", "value": "auto_memory 把值得长期保留的信息划为用户偏好、纠正反馈、项目知识和参考资料，并维护 .mewcode/memories.md。自动摘要的旧回答属于模型生成内容，不能自动升级为用户亲历或源码事实。恢复会话仍需保留工具配对和上下文版本。"}]} -->
auto_memory 把值得长期保留的信息划为用户偏好、纠正反馈、项目知识和参考资料，并维护 .mewcode/memories.md。自动摘要的旧回答属于模型生成内容，不能自动升级为用户亲历或源码事实。恢复会话仍需保留工具配对和上下文版本。
