---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: challenge
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.challenge", "projectId": "arclight", "docType": "challenge", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["困难", "难点", "上下文", "一致性", "方案", "排查"], "related": ["arclight.context"], "sources": [{"path": "mewcode/context/manager.py", "symbol": "CompactBoundary", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "challenge", "value": "可从当前实现讨论的工程难点是长输出预算、压缩后近期消息保留，以及 fork 时未完成工具调用的配对。现有方案分别采用持久结果预览、CompactBoundary 与 interrupted 占位。它们是代码可见的设计，应以“实现采用”解释；尚无本人当时排查过程的确认材料。"}]} -->
可从当前实现讨论的工程难点是长输出预算、压缩后近期消息保留，以及 fork 时未完成工具调用的配对。现有方案分别采用持久结果预览、CompactBoundary 与 interrupted 占位。它们是代码可见的设计，应以“实现采用”解释；尚无本人当时排查过程的确认材料。
