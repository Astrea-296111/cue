---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.fork", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["fork", "隔离", "历史", "子代理", "深拷贝"], "related": ["arclight.context"], "sources": [{"path": "mewcode/agents/fork.py", "symbol": "build_forked_messages", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "fork", "value": "build_forked_messages 深拷贝会话历史，保留环境与长期记忆注入标志，为未完成工具调用补 interrupted 结果，再加入指定任务。检测 fork 标签阻止嵌套 fork。这里隔离的是会话状态，不等同于 OS 进程或文件系统隔离，文件改动仍须按各自工作目录和权限约束。"}]} -->
build_forked_messages 深拷贝会话历史，保留环境与长期记忆注入标志，为未完成工具调用补 interrupted 结果，再加入指定任务。检测 fork 标签阻止嵌套 fork。这里隔离的是会话状态，不等同于 OS 进程或文件系统隔离，文件改动仍须按各自工作目录和权限约束。
