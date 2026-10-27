# CUE-QA/v1
## ID: qa.example.idempotency
Project: example-platform | 示例任务平台
Q: 如何避免重复请求创建两条任务？
Aliases: ["同一个任务重复提交怎么办？"]
Meta: {"sourceType":"proposed_design","applicableVersion":"design-v1","enabled":false,"boundaries":["这是设计建议，不代表本人项目已实现。"]}
### A
如果设计这类平台，我会给一次提交分配幂等键，并用数据库唯一约束兜底。同键同参数返回已有任务，不同参数报冲突。
### Detailed
这是设计建议。

幂等键限定用户和业务范围；失败重试另建执行记录。并发重复由数据库约束处理，不能只靠前端禁用按钮。
