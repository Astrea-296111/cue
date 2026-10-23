---
schema_version: 1
project_id: arclight
project_name: Arclight
resume_order: 2
aliases: ["mewcode", "终端编程助手"]
source_revision: ci-public-synthetic-v1
code_roots: ["samples"]
doc_type: overview
truth_scope: test_only
status: confirmed
topics: ["概览", "Python", "Agent", "工具", "上下文"]
---
# Arclight 公开实现与 CI 样例

公开技术来源：Astrea-296111/Arclight，commit 528704eb373f637830640b3fefcc5cbc95f23a78，mewcode/agent.py#Agent.run、mewcode/context/manager.py#CompactBoundary、mewcode/agents/fork.py#build_forked_messages。

Arclight 的包名 mewcode，是 Python 终端 AI 编程助手。Agent 接收会话、流式调用模型、分发工具并收集结果继续迭代。上下文管理、权限、子任务、MCP 与会话持久化由独立模块负责。工具事件与最终文本分开；agent 完成不等同于用户任务通过验收。

此目录 samples 是明确合成的最小演示，不是完整上游源码，也不是上游文件的逐字复制。
