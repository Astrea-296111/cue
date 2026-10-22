---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.outbox", "projectId": "cae", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["MQ", "RabbitMQ", "Outbox", "Inbox", "幂等", "消息", "重复"], "related": ["cae.recovery"], "sources": [{"path": "docs/mq-and-outbox.md", "symbol": "消息格式和两个 ID", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "outbox", "value": "事务先写业务状态、事件与 Outbox；Publisher 用租约和 confirm 交付，Consumer 用 logical eventId 与 consumer 唯一键去重。deliveryId 标识物理投递，重试保留逻辑事件和执行身份。延迟重投和 Inbox RETRY 共同提交后才 ACK，避免确认与落库之间丢失意图。"}]} -->
事务先写业务状态、事件与 Outbox；Publisher 用租约和 confirm 交付，Consumer 用 logical eventId 与 consumer 唯一键去重。deliveryId 标识物理投递，重试保留逻辑事件和执行身份。延迟重投和 Inbox RETRY 共同提交后才 ACK，避免确认与落库之间丢失意图。
