---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: decision
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.resources", "projectId": "cae", "docType": "decision", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["调度", "资源", "CPU", "内存", "License", "预占", "超卖"], "related": ["cae.recovery"], "sources": [{"path": "docs/architecture.md", "symbol": "resource admission", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "resources", "value": "节点心跳和快速缓存不替代 MySQL 资源账本。CPU、内存和 License 的资源预占在事务中约束，执行结束须先确认远端终态再释放；UNKNOWN 保留资源。这里权衡吞吐与保守正确性，不能把远端短暂不可达当成空闲容量。"}]} -->
节点心跳和快速缓存不替代 MySQL 资源账本。CPU、内存和 License 的资源预占在事务中约束，执行结束须先确认远端终态再释放；UNKNOWN 保留资源。这里权衡吞吐与保守正确性，不能把远端短暂不可达当成空闲容量。
