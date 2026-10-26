# 数字输出补充审阅

除原数字问题并集外，再检查回答正文（去掉编号）含数字的其余输出；与原审阅不重叠。

补充27条。原自动裁判不改，以下是对照来源后的结论。

| 回答 | 审阅 | 结论 |
|---|---|---|
| [qwen/interview-29/r1](qwen/interview-29-r1/answer.txt) | fail | 再次用60长会话回答其他Agent benchmark比较，指代错误；后续已补实体冻结回归。 |
| [qwen/interview-29/r2](qwen/interview-29-r2/answer.txt) | fail | 把新设计的基础ReAct/单代理/关上下文分组说成已有内部消融结果。 |
| [qwen/interview-30/r1](qwen/interview-30-r1/answer.txt) | usable | 300题、harness修复与回归共同判定，消融按建议设计说，不提供虚构中间组分数。 |
| [qwen/interview-30/r2](qwen/interview-30-r2/answer.txt) | usable | 300题、harness修复与回归共同判定，消融按建议设计说，不提供虚构中间组分数。 |
| [qwen/interview-31/r2](qwen/interview-31-r2/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [qwen/interview-39/r1](qwen/interview-39-r1/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [qwen/interview-39/r2](qwen/interview-39-r2/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [qwen/interview-40/r1](qwen/interview-40-r1/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [qwen/interview-40/r2](qwen/interview-40-r2/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [qwen/interview-41/r2](qwen/interview-41-r2/answer.txt) | usable | Rerank处理候选，50取5是示例，漏召回不能靠重排补回。 |
| [deepseek/interview-11/r1](deepseek/interview-11-r1/answer.txt) | usable | 公开Agent工具循环及我会设置的Max step是理解/方案，不冒充内部实现。 |
| [deepseek/interview-12/r1](deepseek/interview-12-r1/answer.txt) | usable | 执行器硬约束与Skill提醒分层，8–15是建议上限而非已测历史。 |
| [deepseek/interview-19/r2](deepseek/interview-19-r2/answer.txt) | usable | 初始Token与命中率分开，测试集/完整Schema对照明确是建议；77%是18.6到4.2的近似比例。 |
| [deepseek/interview-23/r2](deepseek/interview-23-r2/answer.txt) | usable | 角色、Mailbox及30独立探索的时间/Token范围基本对应；不外推全任务或事务ACK。 |
| [deepseek/interview-29/r1](deepseek/interview-29-r1/answer.txt) | fail | 用60长会话输入Token对照替代前文SWE300，指代错误；后续修正。 |
| [deepseek/interview-29/r2](deepseek/interview-29-r2/answer.txt) | fail | 新增三配置组被说成SWE300实际已测；整体成绩不能证明这些具体组完成。 |
| [deepseek/interview-30/r1](deepseek/interview-30-r1/answer.txt) | usable | 300题、harness修复与回归共同判定，消融按建议设计说，不提供虚构中间组分数。 |
| [deepseek/interview-30/r2](deepseek/interview-30-r2/answer.txt) | usable | 300题、harness修复与回归共同判定，消融按建议设计说，不提供虚构中间组分数。 |
| [deepseek/interview-31/r1](deepseek/interview-31-r1/answer.txt) | revise | 前文SWE整体成绩与只切工具暴露的设计混在一起，应明确单开关是新增实验而非旧成绩的归因。 |
| [deepseek/interview-31/r2](deepseek/interview-31-r2/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [deepseek/interview-36/r2](deepseek/interview-36-r2/answer.txt) | usable | 按需消解指代保留原问，24年只是示例，不当个人履历新事实。 |
| [deepseek/interview-37/r1](deepseek/interview-37-r1/answer.txt) | usable | 问题拆关键词与向量、两路召回融合是通识设计，示例错误码不是历史实测指标。 |
| [deepseek/interview-39/r1](deepseek/interview-39-r1/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [deepseek/interview-39/r2](deepseek/interview-39-r2/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [deepseek/interview-40/r2](deepseek/interview-40-r2/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [deepseek/interview-40/r1](deepseek/interview-40-r1/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [deepseek/interview-41/r2](deepseek/interview-41-r2/answer.txt) | usable | Rerank处理候选，50取5是示例，漏召回不能靠重排补回。 |
