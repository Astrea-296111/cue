---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.mailbox", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["邮箱", "通信", "协作", "消息", "通知"], "related": [], "sources": [{"path": "mewcode/teams/mailbox.py", "symbol": "Mailbox.write", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "mailbox", "value": "Mailbox 为每个 agent 建立目录，消息以时间戳和 id 命名 JSON，读取时按文件名排序并跳过坏 JSON。协议包含普通文本、关闭请求和响应；该机制描述软件 agent 的通信，不是开发团队人数、真人分工或生产消息队列交付保证。"}]} -->
Mailbox 为每个 agent 建立目录，消息以时间戳和 id 命名 JSON，读取时按文件名排序并跳过坏 JSON。协议包含普通文本、关闭请求和响应；该机制描述软件 agent 的通信，不是开发团队人数、真人分工或生产消息队列交付保证。
