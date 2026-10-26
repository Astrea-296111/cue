# 数字输出补充审阅

除原数字问题并集外，再检查回答正文（去掉编号）含数字的其余输出；与原审阅不重叠。

补充33条。原自动裁判不改，以下是对照来源后的结论。

| 回答 | 审阅 | 结论 |
|---|---|---|
| [qwen/interview-19/r2](qwen/interview-19-r2/answer.txt) | usable | 初始Token与命中率分开，测试集/完整Schema对照明确是建议；77%是18.6到4.2的近似比例。 |
| [qwen/interview-29/r1](qwen/interview-29-r1/answer.txt) | revise | 31.33/43.67被粗略写成31/43，且配置组历史来源不完整，需保留精确值及已有/设计边界。 |
| [qwen/interview-30/r1](qwen/interview-30-r1/answer.txt) | usable | 300题、harness修复与回归共同判定，消融按建议设计说，不提供虚构中间组分数。 |
| [qwen/interview-31/r1](qwen/interview-31-r1/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [qwen/interview-31/r2](qwen/interview-31-r2/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [qwen/interview-39/r2](qwen/interview-39-r2/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [qwen/interview-40/r1](qwen/interview-40-r1/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [qwen/interview-40/r2](qwen/interview-40-r2/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [qwen/interview-41/r1](qwen/interview-41-r1/answer.txt) | usable | Rerank处理候选，50取5是示例，漏召回不能靠重排补回。 |
| [qwen/interview-41/r2](qwen/interview-41-r2/answer.txt) | usable | Rerank处理候选，50取5是示例，漏召回不能靠重排补回。 |
| [qwen/unseen-arclight-06/r1](qwen/unseen-arclight-06-r1/answer.txt) | usable | 23.1耗时与32.16Token仅30组独立探索；任务依赖/共享写/协调成本限制外推。 |
| [qwen/unseen-arclight-06/r2](qwen/unseen-arclight-06-r2/answer.txt) | usable | 23.1耗时与32.16Token仅30组独立探索；任务依赖/共享写/协调成本限制外推。 |
| [qwen/unseen-general-02/r1](qwen/unseen-general-02-r1/answer.txt) | usable | 温度改分布、top-p裁候选概率质量；只变一个参数方便归因，不保证准确率。 |
| [qwen/unseen-general-04/r1](qwen/unseen-general-04-r1/answer.txt) | usable | 退出码/测试记录的程序门禁与文本要求分开。 |
| [qwen/unseen-general-08/r2](qwen/unseen-general-08-r2/answer.txt) | fail | 两次仍可计算区间，只是极宽；“至少30次”不是通用充分门槛，自动漏检。 |
| [deepseek/interview-23/r2](deepseek/interview-23-r2/answer.txt) | usable | 角色、Mailbox及30独立探索的时间/Token范围基本对应；不外推全任务或事务ACK。 |
| [deepseek/interview-29/r1](deepseek/interview-29-r1/answer.txt) | revise | 问的是前一轮benchmark比较，不能以60长会话Token替代；历史细分配置组与四个新组设计要分开。 |
| [deepseek/interview-30/r1](deepseek/interview-30-r1/answer.txt) | fail | 把31.33到43.67说成三个配置组都跑过的结果，新增组别被反写成历史；自动漏检。 |
| [deepseek/interview-31/r1](deepseek/interview-31-r1/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [deepseek/interview-31/r2](deepseek/interview-31-r2/answer.txt) | usable | 控制变量/每次去一个机制/换模型另组的设计成立；300是计划题集，未冒充原始逐题日志。 |
| [deepseek/interview-37/r1](deepseek/interview-37-r1/answer.txt) | usable | 问题拆关键词与向量、两路召回融合是通识设计，示例错误码不是历史实测指标。 |
| [deepseek/interview-39/r1](deepseek/interview-39-r1/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [deepseek/interview-39/r2](deepseek/interview-39-r2/answer.txt) | usable | BM25词项权重及与稠密互补成立；具体ID能否完整命中取决于分词配置，不能保证所有tokenizer。 |
| [deepseek/interview-40/r1](deepseek/interview-40-r1/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [deepseek/interview-40/r2](deepseek/interview-40-r2/answer.txt) | usable | RRF按两路排名累积分数后去重，2/3是例子，不直接加异量纲原分。 |
| [deepseek/interview-41/r2](deepseek/interview-41-r2/answer.txt) | usable | Rerank处理候选，50取5是示例，漏召回不能靠重排补回。 |
| [deepseek/unseen-arclight-06/r1](deepseek/unseen-arclight-06-r1/answer.txt) | usable | 23.1耗时与32.16Token仅30组独立探索；任务依赖/共享写/协调成本限制外推。 |
| [deepseek/unseen-arclight-06/r2](deepseek/unseen-arclight-06-r2/answer.txt) | usable | 23.1耗时与32.16Token仅30组独立探索；任务依赖/共享写/协调成本限制外推。 |
| [deepseek/unseen-cae-07/r1](deepseek/unseen-cae-07-r1/answer.txt) | usable | 同身份不同输入拒绝，新的attempt与500同身份重放分开，符合身份及指纹边界。 |
| [deepseek/unseen-general-02/r1](deepseek/unseen-general-02-r1/answer.txt) | usable | 温度改分布、top-p裁候选概率质量；只变一个参数方便归因，不保证准确率。 |
| [deepseek/unseen-general-02/r2](deepseek/unseen-general-02-r2/answer.txt) | usable | 温度改分布、top-p裁候选概率质量；只变一个参数方便归因，不保证准确率。 |
| [deepseek/unseen-general-07/r2](deepseek/unseen-general-07-r2/answer.txt) | usable | 名字对不等于参数/权限/副作用执行成功；400是明确反例，不是项目实测。 |
| [deepseek/unseen-general-08/r2](deepseek/unseen-general-08-r2/answer.txt) | usable | 两次样本不能支撑稳定高置信结论，可以计算很宽的二项区间，不能夸大。 |
