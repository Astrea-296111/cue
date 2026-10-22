---
schema_version: 1
project_id: cae
project_name: CAE
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "cae.frontend", "projectId": "cae", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["SSE", "前端", "通知", "权限", "登录"], "related": [], "sources": [{"path": "docs/frontend.md", "symbol": "workbench/SSE", "commit": "c50dd29d1b1981e299d2ce4821e0a1ef745aa48e"}], "facts": [{"key": "frontend", "value": "Vue 工作台经认证显示任务、执行、日志、指标、图片与报告；SSE 发出已提交事件后前端重新 GET 权威结果。界面隐藏按钮不代替后端角色授权，报表审核和节点管理仍须验证服务端权限。"}]} -->
Vue 工作台经认证显示任务、执行、日志、指标、图片与报告；SSE 发出已提交事件后前端重新 GET 权威结果。界面隐藏按钮不代替后端角色授权，报表审核和节点管理仍须验证服务端权限。
