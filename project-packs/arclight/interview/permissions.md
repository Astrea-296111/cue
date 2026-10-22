---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: decision
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.permissions", "projectId": "arclight", "docType": "decision", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["权限", "沙箱", "危险", "命令", "规则", "安全"], "related": [], "sources": [{"path": "mewcode/permissions/checker.py", "symbol": "PermissionChecker.check", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "permissions", "value": "PermissionChecker 按层判断：计划模式特例、安全只读命令、危险命令检查、文件路径沙箱、用户规则、模式兜底。命令与文件工具走不同分支，规则允许不代表 OS 层沙箱。应结合对应工具和模式回归测试判断实际权限边界，不能单凭类名宣称所有写操作已禁止。"}]} -->
PermissionChecker 按层判断：计划模式特例、安全只读命令、危险命令检查、文件路径沙箱、用户规则、模式兜底。命令与文件工具走不同分支，规则允许不代表 OS 层沙箱。应结合对应工具和模式回归测试判断实际权限边界，不能单凭类名宣称所有写操作已禁止。
