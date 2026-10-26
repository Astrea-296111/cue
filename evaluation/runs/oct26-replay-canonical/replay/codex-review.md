# 完整真人前缀开发回放审阅

164次真实生成，审阅并集76条：全部20个自动失败、数字题、至少29个自动通过。此run早于PR26/PR27，不能当作最终代码全量验收。原judge保持。

四份采样参数答案均绑定temperature/top-p；Mailbox与MCP机制改进，但仍有缓存口径、P&E/探索/SWE混用和账号历史编造。也检出若干自动通过中的错误，不能把144/164自动通过当成最终人工通过率。

| 回答 | 原自动 | 审阅 | 结论 |
|---|---|---|---|
| [deepseek/interview-01/r1](deepseek/interview-01-r1/answer.txt) | True | usable | 平台定位、后端职责与数值算法边界符合cae-01及简历，不能由代码量推贡献。 |
| [deepseek/interview-01/r2](deepseek/interview-01-r2/answer.txt) | True | usable | 平台定位、后端职责与数值算法边界符合cae-01及简历，不能由代码量推贡献。 |
| [qwen/interview-01/r1](qwen/interview-01-r1/answer.txt) | True | usable | 平台定位、后端职责与数值算法边界符合cae-01及简历，不能由代码量推贡献。 |
| [qwen/interview-01/r2](qwen/interview-01-r2/answer.txt) | True | usable | 平台定位、后端职责与数值算法边界符合cae-01及简历，不能由代码量推贡献。 |
| [deepseek/interview-02/r1](deepseek/interview-02-r1/answer.txt) | False | usable | GNN/CNN研究与平台后端分开，未说LLM替代求解器；粗预测流程按示例范围讲，不证明本人实现所有模型。 |
| [deepseek/interview-02/r2](deepseek/interview-02-r2/answer.txt) | True | usable | GNN/CNN研究与平台后端分开，未说LLM替代求解器；粗预测流程按示例范围讲，不证明本人实现所有模型。 |
| [qwen/interview-02/r1](qwen/interview-02-r1/answer.txt) | True | usable | GNN/CNN研究与平台后端分开，未说LLM替代求解器；粗预测流程按示例范围讲，不证明本人实现所有模型。 |
| [qwen/interview-02/r2](qwen/interview-02-r2/answer.txt) | True | usable | GNN/CNN研究与平台后端分开，未说LLM替代求解器；粗预测流程按示例范围讲，不证明本人实现所有模型。 |
| [deepseek/interview-03/r1](deepseek/interview-03-r1/answer.txt) | True | usable | 宽泛确认句可直接确认，不需主动铺训练边界；比第一轮多点答题提纲更自然。 |
| [deepseek/interview-03/r2](deepseek/interview-03-r2/answer.txt) | True | usable | 宽泛确认句可直接确认，不需主动铺训练边界；比第一轮多点答题提纲更自然。 |
| [qwen/interview-03/r1](qwen/interview-03-r1/answer.txt) | True | usable | 宽泛确认句可直接确认，不需主动铺训练边界；比第一轮多点答题提纲更自然。 |
| [qwen/interview-03/r2](qwen/interview-03-r2/answer.txt) | True | usable | 宽泛确认句可直接确认，不需主动铺训练边界；比第一轮多点答题提纲更自然。 |
| [deepseek/interview-04/r1](deepseek/interview-04-r1/answer.txt) | True | usable | 资源与训练/位置处理约束分开；通识同义词不应被参考卡逐字要求卡住。 |
| [deepseek/interview-04/r2](deepseek/interview-04-r2/answer.txt) | True | usable | 资源与训练/位置处理约束分开；通识同义词不应被参考卡逐字要求卡住。 |
| [qwen/interview-04/r1](qwen/interview-04-r1/answer.txt) | True | usable | 资源与训练/位置处理约束分开；通识同义词不应被参考卡逐字要求卡住。 |
| [qwen/interview-04/r2](qwen/interview-04-r2/answer.txt) | True | usable | 资源与训练/位置处理约束分开；通识同义词不应被参考卡逐字要求卡住。 |
| [deepseek/interview-05/r1](deepseek/interview-05-r1/answer.txt) | True | revise | 自注意力与并行解释基本成立，但需限定训练/prefill，不把全部显存一概说成平方增长。 |
| [deepseek/interview-05/r2](deepseek/interview-05-r2/answer.txt) | True | revise | 自注意力与并行解释基本成立，但需限定训练/prefill，不把全部显存一概说成平方增长。 |
| [qwen/interview-05/r1](qwen/interview-05-r1/answer.txt) | True | revise | 自注意力与并行解释基本成立，但需限定训练/prefill，不把全部显存一概说成平方增长。 |
| [qwen/interview-05/r2](qwen/interview-05-r2/answer.txt) | True | revise | 自注意力与并行解释基本成立，但需限定训练/prefill，不把全部显存一概说成平方增长。 |
| [deepseek/interview-06/r1](deepseek/interview-06-r1/answer.txt) | True | usable | 四份均已答temperature/top-p，不再错误复述Transformer；调参例子不等于准确率保证。 |
| [deepseek/interview-06/r2](deepseek/interview-06-r2/answer.txt) | True | usable | 四份均已答temperature/top-p，不再错误复述Transformer；调参例子不等于准确率保证。 |
| [qwen/interview-06/r1](qwen/interview-06-r1/answer.txt) | True | revise | 实体已绑定正确；高温配低top-p不能保证不跑偏，准确率仍需测试。 |
| [qwen/interview-06/r2](qwen/interview-06-r2/answer.txt) | True | revise | 实体已绑定正确；0.7–1.0不普遍平衡准确性，调参例子应保留条件。 |
| [deepseek/interview-07/r1](deepseek/interview-07-r1/answer.txt) | True | usable | 温度作用于采样分布，0不保证完全一致或正确；未说修改模型权重。 |
| [deepseek/interview-07/r2](deepseek/interview-07-r2/answer.txt) | True | usable | 温度作用于采样分布，0不保证完全一致或正确；未说修改模型权重。 |
| [qwen/interview-07/r1](qwen/interview-07-r1/answer.txt) | True | usable | 温度作用于采样分布，0不保证完全一致或正确；未说修改模型权重。 |
| [qwen/interview-07/r2](qwen/interview-07-r2/answer.txt) | True | usable | 温度作用于采样分布，0不保证完全一致或正确；未说修改模型权重。 |
| [deepseek/interview-08/r1](deepseek/interview-08-r1/answer.txt) | True | usable | ReAct与P&E的解释成立；可澄清PNE转写，不应强求额外未问的所有范式。 |
| [deepseek/interview-08/r2](deepseek/interview-08-r2/answer.txt) | False | usable | ReAct与P&E的解释成立；可澄清PNE转写，不应强求额外未问的所有范式。 |
| [qwen/interview-08/r1](qwen/interview-08-r1/answer.txt) | True | usable | ReAct与P&E的解释成立；可澄清PNE转写，不应强求额外未问的所有范式。 |
| [qwen/interview-11/r1](qwen/interview-11-r1/answer.txt) | False | revise | 给了工具串联和循环边界，但对公开Claude Code的设计解释偏浅，应区分自己的设计建议。 |
| [qwen/interview-12/r2](qwen/interview-12-r2/answer.txt) | False | usable | Skill步骤与程序完成条件分层，切题；这份原判口述自然度过严。 |
| [deepseek/interview-14/r1](deepseek/interview-14-r1/answer.txt) | True | usable | 60长会话累计输入31.57与总成本分开；分层摘要/落盘/回读符合来源。 |
| [deepseek/interview-14/r2](deepseek/interview-14-r2/answer.txt) | True | usable | 60长会话累计输入31.57与总成本分开；分层摘要/落盘/回读符合来源。 |
| [qwen/interview-14/r1](qwen/interview-14-r1/answer.txt) | True | usable | 60长会话累计输入31.57与总成本分开；分层摘要/落盘/回读符合来源。 |
| [qwen/interview-14/r2](qwen/interview-14-r2/answer.txt) | False | fail | 明确说不含缓存与摘要开销，历史这两项归属未知，即使卡片给出边界仍未遵守。 |
| [deepseek/interview-18/r1](deepseek/interview-18-r1/answer.txt) | True | usable | 50MCP初始注入18.6k到4.2k，关键词/select后返回完整Schema，未误裁Schema。 |
| [deepseek/interview-18/r2](deepseek/interview-18-r2/answer.txt) | True | usable | 50MCP初始注入18.6k到4.2k，关键词/select后返回完整Schema，未误裁Schema。 |
| [qwen/interview-18/r1](qwen/interview-18-r1/answer.txt) | True | usable | 50MCP初始注入18.6k到4.2k，关键词/select后返回完整Schema，未误裁Schema。 |
| [qwen/interview-18/r2](qwen/interview-18-r2/answer.txt) | True | usable | 50MCP初始注入18.6k到4.2k，关键词/select后返回完整Schema，未误裁Schema。 |
| [deepseek/interview-19/r1](deepseek/interview-19-r1/answer.txt) | False | revise | 需直接说命中率是否已有同口径数据；不从Token下降推准确率。 |
| [qwen/interview-19/r1](qwen/interview-19-r1/answer.txt) | False | revise | 需直接说命中率是否已有同口径数据；不从Token下降推准确率。 |
| [qwen/interview-19/r2](qwen/interview-19-r2/answer.txt) | False | revise | 需直接说命中率是否已有同口径数据；不从Token下降推准确率。 |
| [deepseek/interview-20/r1](deepseek/interview-20-r1/answer.txt) | True | usable | 没有补造命中率，A/B与Recall@k按未来设计讲；60题等新分配不是历史测试。 |
| [deepseek/interview-20/r2](deepseek/interview-20-r2/answer.txt) | True | usable | 没有补造命中率，A/B与Recall@k按未来设计讲；60题等新分配不是历史测试。 |
| [qwen/interview-20/r1](qwen/interview-20-r1/answer.txt) | False | revise | 没有补造命中率，A/B与Recall@k按未来设计讲；60题等新分配不是历史测试。 原始长度超过260，本地裁句不能算通过。 |
| [qwen/interview-20/r2](qwen/interview-20-r2/answer.txt) | True | usable | 没有补造命中率，A/B与Recall@k按未来设计讲；60题等新分配不是历史测试。 |
| [deepseek/interview-21/r1](deepseek/interview-21-r1/answer.txt) | True | usable | 常驻发现、服务前缀、完整Schema及Pydantic边界对应源码；不保证工具语义一定选对。 |
| [deepseek/interview-21/r2](deepseek/interview-21-r2/answer.txt) | True | usable | 常驻发现、服务前缀、完整Schema及Pydantic边界对应源码；不保证工具语义一定选对。 |
| [qwen/interview-21/r1](qwen/interview-21-r1/answer.txt) | True | usable | 常驻发现、服务前缀、完整Schema及Pydantic边界对应源码；不保证工具语义一定选对。 |
| [qwen/interview-21/r2](qwen/interview-21-r2/answer.txt) | True | usable | 常驻发现、服务前缀、完整Schema及Pydantic边界对应源码；不保证工具语义一定选对。 |
| [deepseek/interview-22/r1](deepseek/interview-22-r1/answer.txt) | True | revise | 按用途/服务归类可作为方案，但任务阶段分类须标为建议，不能当已核查源码的统计表。 |
| [deepseek/interview-22/r2](deepseek/interview-22-r2/answer.txt) | True | revise | 按用途/服务归类可作为方案，但任务阶段分类须标为建议，不能当已核查源码的统计表。 |
| [qwen/interview-22/r1](qwen/interview-22-r1/answer.txt) | False | revise | 按用途/服务归类可作为方案，但任务阶段分类须标为建议，不能当已核查源码的统计表。 |
| [qwen/interview-22/r2](qwen/interview-22-r2/answer.txt) | True | revise | 按用途/服务归类可作为方案，但任务阶段分类须标为建议，不能当已核查源码的统计表。 |
| [deepseek/interview-23/r1](deepseek/interview-23-r1/answer.txt) | False | usable | 主Agent整合、按独立验证拆分、文件Mailbox协作与共享状态的设计可用，不等于事务ACK。 |
| [deepseek/interview-25/r1](deepseek/interview-25-r1/answer.txt) | False | revise | P&E单多Agent子实验须与独立探索、整体SWE成绩分开；没有同条件数据时不补显著性。 |
| [deepseek/interview-25/r2](deepseek/interview-25-r2/answer.txt) | True | fail | 一面否认特指P&E子实验，一面仍把新增三个配置组说成现有对比，自动裁判漏检。 |
| [qwen/interview-25/r1](qwen/interview-25-r1/answer.txt) | False | fail | 编造超过8轮错误率显著上升的实验结论；来源没有这个阈值。 |
| [qwen/interview-25/r2](qwen/interview-25-r2/answer.txt) | True | fail | 把动态Agent Loop确认成固定P&E，再用30组独立探索回答特指子实验，混了口径，自动漏检。 |
| [deepseek/interview-27/r1](deepseek/interview-27-r1/answer.txt) | True | fail | 新增“60项固定MCP工具常规化任务”的已做实验，没有来源；60长会话分母被改写，自动漏检。 |
| [deepseek/interview-27/r2](deepseek/interview-27-r2/answer.txt) | True | usable | 300题、指定Qwen、31.33到43.67以及测试判定口径可核对；编辑复核与本人历史应分开。 |
| [qwen/interview-27/r1](qwen/interview-27-r1/answer.txt) | True | usable | 300题、指定Qwen、31.33到43.67以及测试判定口径可核对；编辑复核与本人历史应分开。 |
| [qwen/interview-27/r2](qwen/interview-27-r2/answer.txt) | True | usable | 300题、指定Qwen、31.33到43.67以及测试判定口径可核对；编辑复核与本人历史应分开。 |
| [deepseek/interview-28/r1](deepseek/interview-28-r1/answer.txt) | True | usable | SWE成绩、12.34个百分点及94/131算术换算可核对，不混60长会话的Token分母。 |
| [deepseek/interview-28/r2](deepseek/interview-28-r2/answer.txt) | True | usable | SWE成绩、12.34个百分点及94/131算术换算可核对，不混60长会话的Token分母。 |
| [qwen/interview-28/r1](qwen/interview-28-r1/answer.txt) | True | usable | SWE成绩、12.34个百分点及94/131算术换算可核对，不混60长会话的Token分母。 |
| [qwen/interview-28/r2](qwen/interview-28-r2/answer.txt) | True | usable | SWE成绩、12.34个百分点及94/131算术换算可核对，不混60长会话的Token分母。 |
| [qwen/interview-31/r1](qwen/interview-31-r1/answer.txt) | False | revise | 对照设计可用，94/131只是由声明比例推导，不是有逐题日志的既有对照；复现目标不等于已稳定复现。 |
| [deepseek/interview-32/r2](deepseek/interview-32-r2/answer.txt) | False | revise | 没有编采购人是进步，但自费订阅/API渠道仍未经确认，且扩到了未问评测。 |
| [qwen/interview-32/r1](qwen/interview-32-r1/answer.txt) | False | fail | 统一harness中比较通过率/工具选择准确率没有来源；真人只说主观模型体验，不能扩成定量实验。 |
| [qwen/interview-32/r2](qwen/interview-32-r2/answer.txt) | False | fail | 团队申请/报销、公司数据隔离等采购及合规历史均无来源。 |
| [deepseek/interview-33/r2](deepseek/interview-33-r2/answer.txt) | False | fail | “可以你继续问”未回答明确的RAG技术问题，是确认句规则误触发。 |
| [qwen/interview-33/r2](qwen/interview-33-r2/answer.txt) | False | revise | RAG具名技术问不能因前半句API是吧而变成一句确认；已补定向回归。 |
| [qwen/interview-38/r2](qwen/interview-38-r2/answer.txt) | False | revise | 召回题应讲关键词/向量/融合，后两点却转成评测与旧代码返还，偏题。 |
