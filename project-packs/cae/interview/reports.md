---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.reports", "projectId": "cae", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["解析", "版本", "报告", "PPTX", "PNG", "工况", "Subcase"], "related": ["cae.boundary"], "sources": [{"path": "docs/post-and-reports.md", "symbol": "reports", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "reports", "value": "解析器版本保留独立指标记录和不可变 JSON/CSV。后处理生成合成 PNG、PPTX 草稿并保留 parser、工况和 Subcase；报告仍需人工 Lead review/Admin approval。下载校验注册字节与 SHA，报表阶段重试复用原始 Solver 执行。"}]} -->
解析器版本保留独立指标记录和不可变 JSON/CSV。后处理生成合成 PNG、PPTX 草稿并保留 parser、工况和 Subcase；报告仍需人工 Lead review/Admin approval。下载校验注册字节与 SHA，报表阶段重试复用原始 Solver 执行。
