---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.mcp", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["MCP", "工具", "发现", "注册", "连接"], "related": [], "sources": [{"path": "mewcode/mcp/manager.py", "symbol": "MCPManager", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "mcp", "value": "MCP 管理器负责连接配置中的服务并将远端工具包装后注册；服务连接、环境变量解析和工具搜索属于可插拔工具链。连接失败与工具返回失败应区分，远端服务能力不能由本地目录存在推断。这里没有验证任何用户私有 MCP 服务或其凭据可用。"}]} -->
MCP 管理器负责连接配置中的服务并将远端工具包装后注册；服务连接、环境变量解析和工具搜索属于可插拔工具链。连接失败与工具返回失败应区分，远端服务能力不能由本地目录存在推断。这里没有验证任何用户私有 MCP 服务或其凭据可用。
