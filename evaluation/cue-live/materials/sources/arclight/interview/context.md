---
doc_type: implementation
truth_scope: test_only
status: confirmed
topics: ["上下文", "工具输出", "压缩", "fork", "难点", "会话"]
code_refs: [{path: "samples/context_budget.py", symbol: "pair_pending_calls"}]
---
# 上下文预算与 fork

公开来源：Arclight commit 528704eb373f637830640b3fefcc5cbc95f23a78，mewcode/context/manager.py#CompactBoundary 与 mewcode/agents/fork.py#build_forked_messages。

单个与累计工具输出分别受预算约束，大结果持久化到 .mewcode/session/tool-results 并保留可定位预览。自动压缩保留近期原文窗口、摘要较早前缀；CompactBoundary 带 summary 和 keep 交由会话层持久化。摘要有损，不可将旧模型回答升级为用户亲历。

fork 深拷贝会话历史，给未完成工具调用补 interrupted 结果，再加入新任务；检测 fork 标签阻止嵌套 fork。它隔离会话状态，不保证操作系统或文件系统隔离。SharedTask 和 Mailbox 表示软件 agent 的协作，不代表真人团队。
