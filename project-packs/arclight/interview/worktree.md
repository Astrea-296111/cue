---
schema_version: 1
project_id: arclight
project_name: Arclight
doc_type: implementation
truth_scope: implemented
status: verified
---
<!-- cue-fact {"cardId": "arclight.worktree", "projectId": "arclight", "docType": "implementation", "truthScope": "implemented", "status": "verified", "provenance": "CODE", "keywords": ["worktree", "工作区", "git", "分支", "隔离"], "related": [], "sources": [{"path": "mewcode/worktree/manager.py", "symbol": "WorktreeManager", "commit": "528704eb373f637830640b3fefcc5cbc95f23a78"}], "facts": [{"key": "worktree", "value": "WorktreeManager 以仓库根目录初始化，默认工作目录在 .mewcode/worktrees，通过 subprocess 执行 Git，维护 active 和 current_session 并使用 asyncio.Lock。Git 命令有超时，隔离工作目录与后续集成是不同阶段；该机制不证明外部工具或共享资源都被隔离。"}]} -->
WorktreeManager 以仓库根目录初始化，默认工作目录在 .mewcode/worktrees，通过 subprocess 执行 Git，维护 active 和 current_session 并使用 asyncio.Lock。Git 命令有超时，隔离工作目录与后续集成是不同阶段；该机制不证明外部工具或共享资源都被隔离。
