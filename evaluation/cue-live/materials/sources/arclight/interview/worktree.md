---
doc_type: implementation
truth_scope: implemented
status: confirmed
topics: ["WorktreeManager", "工作目录", "工作树", "隔离", "Git", "外部资源"]
code_refs: [{path: "samples/worktree_boundary.py", symbol: "session_directory"}]
---
# WorktreeManager 的工作目录与隔离边界

公开技术来源：Astrea-296111/Arclight commit 528704eb373f637830640b3fefcc5cbc95f23a78，mewcode/worktree/manager.py#WorktreeManager。编写此摘要时核对了该版本的 __init__、_run_git、create、enter 和 exit 方法，不把下方合成样例说成上游源码。

WorktreeManager 以 repo_root 初始化，默认 worktree_dir 为 .mewcode/worktrees，维护 active、current_session 和一个 asyncio.Lock。create 在锁内校验 slug；若已有工作树 HEAD 可读则恢复，否则通过 git worktree add 创建工作目录与分支。_run_git 使用 subprocess.run，指定 cwd、60 秒超时、禁止终端凭据提示并关闭 stdin。enter 记录原目录、分支与 HEAD，再保存工作树会话；exit 根据操作保留或移除工作树。

这些代码约束工作目录和会话状态，不是操作系统沙箱，也没有证明外部工具、环境变量或共享资源全部隔离。独立工作树中的修改仍需后续集成验证。samples/worktree_boundary.py 仅演示构造不同会话路径；它不执行 Git、不创建进程隔离，也不复刻完整 WorktreeManager。
