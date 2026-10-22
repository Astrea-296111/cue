---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: limitation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.boundary", "projectId": "cae", "docType": "limitation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["边界", "局限", "商业", "Solver", "替换", "改进"], "related": [], "sources": [{"path": "docs/real-system-mapping.md", "symbol": "Public adapters", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "boundary", "value": "独立 MockSolver、Matplotlib 与 python-pptx 是公开替身。企业替换边界是 SolverAdapter、HyperViewAdapter、BatchSchedulerAdapter，必须保留执行身份、幂等、不可变产物和人工审批；商业实现、许可证和真实工程有效性不随仓库提供。"}]} -->
独立 MockSolver、Matplotlib 与 python-pptx 是公开替身。企业替换边界是 SolverAdapter、HyperViewAdapter、BatchSchedulerAdapter，必须保留执行身份、幂等、不可变产物和人工审批；商业实现、许可证和真实工程有效性不随仓库提供。
