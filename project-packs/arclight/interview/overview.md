---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: overview
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.overview", "projectId": "arclight", "docType": "overview", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["架构", "整体", "链路", "简介"], "related": ["arclight.context"], "sources": [{"path": "mewcode/agent.py", "symbol": "Agent.run", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "overview", "value": "Arclight 的包名是 mewcode，是 Python 终端 AI 编程助手。Agent 接收会话、流式调用模型，分发工具并收集结果继续迭代；上下文管理、权限、子任务、MCP、会话持久化由独立模块承担。工具调用与最终文本是不同事件，不能把子 agent 的完成状态当作用户任务已通过验收。"}]} -->
Arclight 的包名是 mewcode，是 Python 终端 AI 编程助手。Agent 接收会话、流式调用模型，分发工具并收集结果继续迭代；上下文管理、权限、子任务、MCP、会话持久化由独立模块承担。工具调用与最终文本是不同事件，不能把子 agent 的完成状态当作用户任务已通过验收。
