# 268条首轮真实回答的逐条来源审阅

Codex逐条原文与源码审阅，不是外部人工签字；原自动裁判文件保持不变。全53条自动失败、全部数字/指标问题以及至少43条自动通过样本的并集，共152条。抽样结论不能当成全268条人工通过率。

{'fail': 30, 'revise': 32, 'transport-failure': 3, 'usable': 87}

发现自动漏检：缓存归属、45→5–8与76.3%混算、同身份不同输入、prefill瓶颈，以及将新增消融组说成历史；也发现裁判因缺少候选人profile或强求未问指标造成误判。修复与后续run分别记录，不覆盖这里的失败。

| 回答 | 原自动 | 审阅 | 结论 |
|---|---|---|---|
| [deepseek/interview-01/r1](deepseek/interview-01-r1/answer.txt) | True | revise | 第3点是追问方向，不是本题答案；平台职责主体成立，但需删多余下一问提示。 |
| [deepseek/interview-01/r2](deepseek/interview-01-r2/answer.txt) | False | revise | 平台定位、Java后端职责可由cae-01及候选人简历支撑；intro不应因裁判没收到profile而把真实简历数字判成编造。 原始回答超过260可见字符，本地裁句不改变长度失败。 |
| [qwen/interview-01/r1](qwen/interview-01-r1/answer.txt) | False | transport-failure | 首次内容超时，没有可用答案；保留原失败，不重生成替换。 |
| [qwen/interview-01/r2](qwen/interview-01-r2/answer.txt) | False | usable | 平台定位、Java后端职责可由cae-01及候选人简历支撑；intro不应因裁判没收到profile而把真实简历数字判成编造。 |
| [deepseek/interview-02/r1](deepseek/interview-02-r1/answer.txt) | True | usable | 传统GNN/CNN仿真预测与平台后端分开，未说LLM替代求解器；与资料职责边界相符。 |
| [deepseek/interview-02/r2](deepseek/interview-02-r2/answer.txt) | True | usable | 传统GNN/CNN仿真预测与平台后端分开，未说LLM替代求解器；与资料职责边界相符。 |
| [qwen/interview-02/r1](qwen/interview-02-r1/answer.txt) | True | usable | 传统GNN/CNN仿真预测与平台后端分开，未说LLM替代求解器；与资料职责边界相符。 |
| [qwen/interview-02/r2](qwen/interview-02-r2/answer.txt) | True | usable | 传统GNN/CNN仿真预测与平台后端分开，未说LLM替代求解器；与资料职责边界相符。 |
| [deepseek/interview-03/r1](deepseek/interview-03-r1/answer.txt) | False | revise | 只是确认能否继续提问，回答主动展开训练边界/答题提纲或反问下一问；应一句自然确认。 |
| [deepseek/interview-03/r2](deepseek/interview-03-r2/answer.txt) | True | revise | 只是确认能否继续提问，回答主动展开训练边界/答题提纲或反问下一问；应一句自然确认。 |
| [qwen/interview-03/r1](qwen/interview-03-r1/answer.txt) | False | revise | 只是确认能否继续提问，回答主动展开训练边界/答题提纲或反问下一问；应一句自然确认。 |
| [qwen/interview-03/r2](qwen/interview-03-r2/answer.txt) | False | revise | 只是确认能否继续提问，回答主动展开训练边界/答题提纲或反问下一问；应一句自然确认。 |
| [deepseek/interview-04/r1](deepseek/interview-04-r1/answer.txt) | True | usable | 资源/计算与训练长度/位置处理两个原因成立；位置编码是通识同义细化，不应因非逐字引用判错。 |
| [deepseek/interview-04/r2](deepseek/interview-04-r2/answer.txt) | True | usable | 资源/计算与训练长度/位置处理两个原因成立；位置编码是通识同义细化，不应因非逐字引用判错。 |
| [qwen/interview-04/r1](qwen/interview-04-r1/answer.txt) | False | usable | 资源/计算与训练长度/位置处理两个原因成立；位置编码是通识同义细化，不应因非逐字引用判错。 |
| [qwen/interview-04/r2](qwen/interview-04-r2/answer.txt) | True | usable | 资源/计算与训练长度/位置处理两个原因成立；位置编码是通识同义细化，不应因非逐字引用判错。 |
| [deepseek/interview-05/r1](deepseek/interview-05-r1/answer.txt) | True | usable | 自注意力、多头或前馈/残差构成解释基本成立；这是通识，不作为个人实现证明。 |
| [deepseek/interview-05/r2](deepseek/interview-05-r2/answer.txt) | True | usable | 自注意力、多头或前馈/残差构成解释基本成立；这是通识，不作为个人实现证明。 |
| [qwen/interview-05/r1](qwen/interview-05-r1/answer.txt) | True | usable | 自注意力、多头或前馈/残差构成解释基本成立；这是通识，不作为个人实现证明。 |
| [qwen/interview-05/r2](qwen/interview-05-r2/answer.txt) | True | fail | “所有位置并行/不依赖前一步”没有区分训练prefill与自回归decode，会误导生成机制；自动通过漏检。 |
| [deepseek/interview-06/r1](deepseek/interview-06-r1/answer.txt) | False | fail | 截至此输出点原文已给temperature与top-p；回答却解释Transformer/语法指代，实体绑定错误。 |
| [deepseek/interview-06/r2](deepseek/interview-06-r2/answer.txt) | False | fail | 截至此输出点原文已给temperature与top-p；回答却解释Transformer/语法指代，实体绑定错误。 |
| [qwen/interview-06/r1](qwen/interview-06-r1/answer.txt) | False | fail | 截至此输出点原文已给temperature与top-p；回答却解释Transformer/语法指代，实体绑定错误。 |
| [qwen/interview-06/r2](qwen/interview-06-r2/answer.txt) | False | fail | 截至此输出点原文已给temperature与top-p；回答却解释Transformer/语法指代，实体绑定错误。 |
| [deepseek/interview-07/r1](deepseek/interview-07-r1/answer.txt) | True | usable | 0近似贪心、1原分布采样，且不保证每次一致或正确；没有把采样温度说成模型权重。 |
| [deepseek/interview-07/r2](deepseek/interview-07-r2/answer.txt) | True | usable | 0近似贪心、1原分布采样，且不保证每次一致或正确；没有把采样温度说成模型权重。 |
| [qwen/interview-07/r1](qwen/interview-07-r1/answer.txt) | True | usable | 0近似贪心、1原分布采样，且不保证每次一致或正确；没有把采样温度说成模型权重。 |
| [qwen/interview-07/r2](qwen/interview-07-r2/answer.txt) | True | usable | 0近似贪心、1原分布采样，且不保证每次一致或正确；没有把采样温度说成模型权重。 |
| [deepseek/interview-08/r1](deepseek/interview-08-r1/answer.txt) | True | usable | ReAct逐步观察与P&E先计划的取舍正确；泛化到任务不确定性，不要求复述全部项目卡。 |
| [deepseek/interview-08/r2](deepseek/interview-08-r2/answer.txt) | False | usable | ReAct逐步观察与P&E先计划的取舍正确；泛化到任务不确定性，不要求复述全部项目卡。 |
| [qwen/interview-08/r1](qwen/interview-08-r1/answer.txt) | True | usable | ReAct逐步观察与P&E先计划的取舍正确；泛化到任务不确定性，不要求复述全部项目卡。 |
| [qwen/interview-08/r2](qwen/interview-08-r2/answer.txt) | True | usable | ReAct逐步观察与P&E先计划的取舍正确；泛化到任务不确定性，不要求复述全部项目卡。 |
| [deepseek/interview-09/r1](deepseek/interview-09-r1/answer.txt) | True | usable | 错误作为观察反馈给模型，并有限重试/预算终止；按一般工程设计判断，没有虚构历史数字。 |
| [deepseek/interview-09/r2](deepseek/interview-09-r2/answer.txt) | True | usable | 错误作为观察反馈给模型，并有限重试/预算终止；按一般工程设计判断，没有虚构历史数字。 |
| [qwen/interview-09/r1](qwen/interview-09-r1/answer.txt) | True | usable | 错误作为观察反馈给模型，并有限重试/预算终止；按一般工程设计判断，没有虚构历史数字。 |
| [qwen/interview-09/r2](qwen/interview-09-r2/answer.txt) | True | usable | 错误作为观察反馈给模型，并有限重试/预算终止；按一般工程设计判断，没有虚构历史数字。 |
| [deepseek/interview-10/r1](deepseek/interview-10-r1/answer.txt) | True | usable | 最终答复、程序完成校验与强制终止有区分；停止循环不自动等于完成任务。 |
| [deepseek/interview-10/r2](deepseek/interview-10-r2/answer.txt) | True | usable | 最终答复、程序完成校验与强制终止有区分；停止循环不自动等于完成任务。 |
| [qwen/interview-10/r1](qwen/interview-10-r1/answer.txt) | True | usable | 最终答复、程序完成校验与强制终止有区分；停止循环不自动等于完成任务。 |
| [qwen/interview-10/r2](qwen/interview-10-r2/answer.txt) | True | usable | 最终答复、程序完成校验与强制终止有区分；停止循环不自动等于完成任务。 |
| [deepseek/interview-11/r1](deepseek/interview-11-r1/answer.txt) | True | usable | 按公开Coding Agent工具循环、上下文与权限描述可用；不能把第三方未公开调度策略当确定内部机制。 |
| [deepseek/interview-11/r2](deepseek/interview-11-r2/answer.txt) | True | usable | 按公开Coding Agent工具循环、上下文与权限描述可用；不能把第三方未公开调度策略当确定内部机制。 |
| [qwen/interview-11/r1](qwen/interview-11-r1/answer.txt) | False | transport-failure | 首次内容超时，没有可用答案；保留原失败，不重生成替换。 |
| [qwen/interview-11/r2](qwen/interview-11-r2/answer.txt) | True | usable | 按公开Coding Agent工具循环、上下文与权限描述可用；不能把第三方未公开调度策略当确定内部机制。 |
| [deepseek/interview-12/r1](deepseek/interview-12-r1/answer.txt) | True | usable | 自由探索与程序硬约束分层，测试完成条件由执行器验证，符合该问题。 |
| [deepseek/interview-12/r2](deepseek/interview-12-r2/answer.txt) | True | usable | 自由探索与程序硬约束分层，测试完成条件由执行器验证，符合该问题。 |
| [qwen/interview-12/r1](qwen/interview-12-r1/answer.txt) | True | usable | 自由探索与程序硬约束分层，测试完成条件由执行器验证，符合该问题。 |
| [qwen/interview-12/r2](qwen/interview-12-r2/answer.txt) | True | usable | 自由探索与程序硬约束分层，测试完成条件由执行器验证，符合该问题。 |
| [deepseek/interview-13/r1](deepseek/interview-13-r1/answer.txt) | True | usable | Skill提供步骤说明、代码检查完成条件；没有把提示词等同强制执行。 |
| [deepseek/interview-13/r2](deepseek/interview-13-r2/answer.txt) | True | usable | Skill提供步骤说明、代码检查完成条件；没有把提示词等同强制执行。 |
| [qwen/interview-13/r1](qwen/interview-13-r1/answer.txt) | True | usable | Skill提供步骤说明、代码检查完成条件；没有把提示词等同强制执行。 |
| [qwen/interview-13/r2](qwen/interview-13-r2/answer.txt) | True | usable | Skill提供步骤说明、代码检查完成条件；没有把提示词等同强制执行。 |
| [deepseek/interview-14/r1](deepseek/interview-14-r1/answer.txt) | True | revise | 31.57%应限定60项累计输入，且机制按源码；把编辑方未独立复核说成候选人没跑过，不适合直接口述。 |
| [deepseek/interview-14/r2](deepseek/interview-14-r2/answer.txt) | True | revise | 31.57%应限定60项累计输入，且机制按源码；把编辑方未独立复核说成候选人没跑过，不适合直接口述。 |
| [qwen/interview-14/r1](qwen/interview-14-r1/answer.txt) | True | revise | 机制总体对应源码，但口述夹入未独立重跑的编辑核验说明；需把资料核验状态与本人历史分开。 |
| [qwen/interview-14/r2](qwen/interview-14-r2/answer.txt) | False | fail | 回答新增滑动截断/过滤作为实际优化，未由选中指标卡或源码支撑。 |
| [deepseek/interview-15/r1](deepseek/interview-15-r1/answer.txt) | True | usable | 摘要有损，保留约束锚点并回读原文的改进方案成立。 |
| [qwen/interview-15/r2](qwen/interview-15-r2/answer.txt) | False | fail | 声称确保信息不丢，与有损摘要边界冲突。 |
| [deepseek/interview-18/r1](deepseek/interview-18-r1/answer.txt) | True | usable | 初始注入18.6k到4.2k对应50MCP工具；延迟发现后给完整Schema，不推成全任务成本。 |
| [deepseek/interview-18/r2](deepseek/interview-18-r2/answer.txt) | True | usable | 初始注入18.6k到4.2k对应50MCP工具；延迟发现后给完整Schema，不推成全任务成本。 |
| [qwen/interview-18/r1](qwen/interview-18-r1/answer.txt) | True | usable | 初始注入18.6k到4.2k对应50MCP工具；延迟发现后给完整Schema，不推成全任务成本。 |
| [qwen/interview-18/r2](qwen/interview-18-r2/answer.txt) | False | fail | 声称裁剪Schema字段/参数示例及意图路由，实际ToolSearch返回完整Schema，MCP保留原始inputSchema。 |
| [deepseek/interview-20/r1](deepseek/interview-20-r1/answer.txt) | True | usable | 未给精确命中率结果，后续对照/Recall@k是设计；初始Token降幅不能证明工具命中无损。 |
| [deepseek/interview-20/r2](deepseek/interview-20-r2/answer.txt) | True | usable | 未给精确命中率结果，后续对照/Recall@k是设计；初始Token降幅不能证明工具命中无损。 |
| [qwen/interview-20/r1](qwen/interview-20-r1/answer.txt) | True | usable | 未给精确命中率结果，后续对照/Recall@k是设计；初始Token降幅不能证明工具命中无损。 |
| [qwen/interview-20/r2](qwen/interview-20-r2/answer.txt) | True | usable | 未给精确命中率结果，后续对照/Recall@k是设计；初始Token降幅不能证明工具命中无损。 |
| [deepseek/interview-21/r1](deepseek/interview-21-r1/answer.txt) | True | fail | 参数/权限检查不能保证选错语义工具就一定失败；“不会误执行”是无依据保证，自动通过漏检。 |
| [deepseek/interview-21/r2](deepseek/interview-21-r2/answer.txt) | True | revise | manifest/hash刷新是可建议设计，未由当前源码证实，须显式标为方案。 |
| [qwen/interview-21/r1](qwen/interview-21-r1/answer.txt) | False | usable | 围绕参数校验、选错兜底和目录刷新的一般设计可用；不是历史指标题，不需强加50工具成本数字。 |
| [qwen/interview-21/r2](qwen/interview-21-r2/answer.txt) | False | usable | 包装前缀、保留inputSchema、Pydantic、失败返回和嵌套约束边界均对应MCP源码，裁判要求未问的成本数字属误判。 |
| [deepseek/interview-22/r1](deepseek/interview-22-r1/answer.txt) | True | revise | 本题问项目怎样分类；按动作/对象给分类建议须标为建议，不能把业务标签/分组统计写成现有代码。 |
| [deepseek/interview-22/r2](deepseek/interview-22-r2/answer.txt) | True | revise | 本题问项目怎样分类；按动作/对象给分类建议须标为建议，不能把业务标签/分组统计写成现有代码。 |
| [qwen/interview-22/r1](qwen/interview-22-r1/answer.txt) | False | revise | 分类建议应标清；加载完整Schema之前无法完成其全部参数约束校验，也不能保证符合语义预期。 |
| [qwen/interview-22/r2](qwen/interview-22-r2/answer.txt) | False | fail | ToolSearch实际是关键词/select:name，不是描述向量匹配。 |
| [qwen/interview-23/r1](qwen/interview-23-r1/answer.txt) | False | fail | 多Agent架构题被回答成benchmark配置组，未讲子代理职责和协作。 |
| [deepseek/interview-24/r2](deepseek/interview-24-r2/answer.txt) | False | fail | 上文问多Agent结构化协作消息，应核对MailboxMessage；回答却是fork的tool_call_id配对协议。 |
| [qwen/interview-24/r2](qwen/interview-24-r2/answer.txt) | False | fail | 上文问多Agent结构化协作消息，应核对MailboxMessage；回答却是fork的tool_call_id配对协议。 |
| [deepseek/interview-25/r1](deepseek/interview-25-r1/answer.txt) | False | revise | 给了可行对照，但没有直接回答特指P&E子实验是否测过，并出现“据我记得你们”等旁观口吻。 |
| [deepseek/interview-25/r2](deepseek/interview-25-r2/answer.txt) | False | fail | 30组独立探索的时间/Token结果不能替代固定P&E单多Agent子实验，更不能当所有任务结论。 |
| [qwen/interview-25/r1](qwen/interview-25-r1/answer.txt) | False | revise | 本题特指单/多Agent P&E消融；需限定是否测过，不用整体SWE或30组独立探索替代该子实验。 |
| [qwen/interview-25/r2](qwen/interview-25-r2/answer.txt) | False | fail | 把31.33/43.67说成单多Agent消融分数，又与独立探索23.1/32.16混合归因。 |
| [deepseek/interview-26/r2](deepseek/interview-26-r2/answer.txt) | False | revise | 单代理/子代理的工程取舍可讲，但不应断言Codex未公开的自动最优调度或ReAct/P&E选择机制。 |
| [qwen/interview-26/r1](qwen/interview-26-r1/answer.txt) | False | revise | 单代理/子代理的工程取舍可讲，但不应断言Codex未公开的自动最优调度或ReAct/P&E选择机制。 |
| [qwen/interview-26/r2](qwen/interview-26-r2/answer.txt) | False | fail | 断言Codex自动选择最优ReAct/P&E路径，缺乏公开机制证据。 |
| [deepseek/interview-27/r1](deepseek/interview-27-r1/answer.txt) | True | usable | SWE Lite300、31.33到43.67及测试修复/回归两类判定对应声明；不等于本次重跑。 |
| [deepseek/interview-27/r2](deepseek/interview-27-r2/answer.txt) | True | revise | 成绩和测试判定成立，但把基础ReAct/单代理具体组写成已测对照；材料只有成绩声明，新组别是设计。 |
| [qwen/interview-27/r1](qwen/interview-27-r1/answer.txt) | False | revise | “我写了跑过但没独立重跑”混淆本人经历与本次编辑核验，还漏回答已声明的300题判定。 |
| [qwen/interview-27/r2](qwen/interview-27-r2/answer.txt) | True | usable | SWE Lite300、31.33到43.67及测试修复/回归两类判定对应声明；不等于本次重跑。 |
| [deepseek/interview-28/r1](deepseek/interview-28-r1/answer.txt) | True | usable | SWE300与60长会话是两套口径；12.34个百分点与94/131算术换算可核对。 |
| [deepseek/interview-28/r2](deepseek/interview-28-r2/answer.txt) | True | usable | SWE300与60长会话是两套口径；12.34个百分点与94/131算术换算可核对。 |
| [qwen/interview-28/r1](qwen/interview-28-r1/answer.txt) | True | usable | SWE300与60长会话是两套口径；12.34个百分点与94/131算术换算可核对。 |
| [qwen/interview-28/r2](qwen/interview-28-r2/answer.txt) | True | revise | 把12.34个百分点粗略说为12可接受近似，但未给300题与具体模型；仍不应把未独立复核说成本人没跑过。 |
| [deepseek/interview-29/r2](deepseek/interview-29-r2/answer.txt) | False | revise | 把新增配置组/消融设计说成已经完成，又用整体31.33到43.67证明多Agent/上下文分别有效，证据越界。 原始格式不满足短标签分点，内容审阅不能覆盖格式失败。 |
| [qwen/interview-29/r2](qwen/interview-29-r2/answer.txt) | False | fail | 把新增配置组/消融设计说成已经完成，又用整体31.33到43.67证明多Agent/上下文分别有效，证据越界。 |
| [deepseek/interview-30/r2](deepseek/interview-30-r2/answer.txt) | False | revise | 组别与harness步骤是新设计；回答应明确区分已有简历成绩、缺失逐题日志与未来机制消融。 原始回答超过260可见字符，本地裁句不改变长度失败。 |
| [qwen/interview-30/r2](qwen/interview-30-r2/answer.txt) | False | transport-failure | 首次内容超时，没有可用答案；保留原失败，不重生成替换。 |
| [deepseek/interview-32/r2](deepseek/interview-32-r2/answer.txt) | False | revise | 保留采购归属未知比编造好，但不能进一步假设个人测试/公司项目采购规则是已知个人历史。 |
| [qwen/interview-32/r1](qwen/interview-32-r1/answer.txt) | False | fail | 账号采购归属无来源，不能由技术接入方式反推个人购买或公司统一采购。 |
| [qwen/interview-32/r2](qwen/interview-32-r2/answer.txt) | False | fail | 账号采购归属无来源，不能由技术接入方式反推个人购买或公司统一采购。 |
| [qwen/interview-33/r2](qwen/interview-33-r2/answer.txt) | False | revise | 不能迎合面试官前提断言项目完全没有RAG；工具检索/文件检索与向量库是不同概念。 |
| [qwen/interview-35/r1](qwen/interview-35-r1/answer.txt) | False | revise | 纠正完全不用检索的前提，并把混合检索标为我会设计；不把第三方内部实现说死。 原始回答超过260可见字符，本地裁句不改变长度失败。 |
| [qwen/interview-38/r2](qwen/interview-38-r2/answer.txt) | False | usable | 双路召回、去重重排作为一般设计成立；若直接加分数还需归一化/RRF说明，属于可进一步完善。 |
| [deepseek/unseen-arclight-02/r1](deepseek/unseen-arclight-02-r1/answer.txt) | True | usable | SWE300测修复率，60任务测累计输入Token；两套分母不合并，未问成绩时不强求复述整卡。 |
| [deepseek/unseen-arclight-02/r2](deepseek/unseen-arclight-02-r2/answer.txt) | True | usable | SWE300测修复率，60任务测累计输入Token；两套分母不合并，未问成绩时不强求复述整卡。 |
| [qwen/unseen-arclight-02/r1](qwen/unseen-arclight-02-r1/answer.txt) | True | fail | 仅凭31.57输入下降归因Memory/压缩各自因果贡献，超出整体指标证据。 |
| [qwen/unseen-arclight-02/r2](qwen/unseen-arclight-02-r2/answer.txt) | True | usable | SWE300测修复率，60任务测累计输入Token；两套分母不合并，未问成绩时不强求复述整卡。 |
| [qwen/unseen-arclight-03/r1](qwen/unseen-arclight-03-r1/answer.txt) | False | fail | 同模型换框架只能看整体配置差异，不能隔离每个组件；同框架换模型比较模型/适配，不能断言只测接口。 |
| [qwen/unseen-arclight-03/r2](qwen/unseen-arclight-03-r2/answer.txt) | False | fail | 同模型换框架只能看整体配置差异，不能隔离每个组件；同框架换模型比较模型/适配，不能断言只测接口。 |
| [deepseek/unseen-arclight-04/r1](deepseek/unseen-arclight-04-r1/answer.txt) | False | revise | 确定是输入而非输出Token；缓存和摘要调用在历史统计中的归属未知，不能自行补成排除项。 |
| [deepseek/unseen-arclight-04/r2](deepseek/unseen-arclight-04-r2/answer.txt) | True | usable | 明确缓存归属未写清，并把未来单列缓存/摘要说成复现方案；口径正确。 |
| [qwen/unseen-arclight-04/r1](qwen/unseen-arclight-04-r1/answer.txt) | True | fail | “不含缓存命中”没有来源；缓存是输入计量子集，不应凭空排除，自动通过漏检。 |
| [qwen/unseen-arclight-04/r2](qwen/unseen-arclight-04-r2/answer.txt) | False | fail | 缓存一般知识可讲，但声称历史不含摘要调用开销无来源。 |
| [deepseek/unseen-arclight-05/r1](deepseek/unseen-arclight-05-r1/answer.txt) | True | usable | 18.6k/4.2k仅初始注入，发现调用、后续输入输出和重试另计；未承诺端到端同幅下降。 |
| [deepseek/unseen-arclight-05/r2](deepseek/unseen-arclight-05-r2/answer.txt) | True | usable | 18.6k/4.2k仅初始注入，发现调用、后续输入输出和重试另计；未承诺端到端同幅下降。 |
| [qwen/unseen-arclight-05/r1](qwen/unseen-arclight-05-r1/answer.txt) | True | usable | 18.6k/4.2k仅初始注入，发现调用、后续输入输出和重试另计；未承诺端到端同幅下降。 |
| [qwen/unseen-arclight-05/r2](qwen/unseen-arclight-05-r2/answer.txt) | True | usable | 18.6k/4.2k仅初始注入，发现调用、后续输入输出和重试另计；未承诺端到端同幅下降。 |
| [deepseek/unseen-arclight-07/r1](deepseek/unseen-arclight-07-r1/answer.txt) | True | usable | 局部P&E消融没测不等于没跑SWE；整体成绩不能反推组件因果贡献。 |
| [deepseek/unseen-arclight-07/r2](deepseek/unseen-arclight-07-r2/answer.txt) | True | usable | 局部P&E消融没测不等于没跑SWE；整体成绩不能反推组件因果贡献。 |
| [qwen/unseen-arclight-07/r1](qwen/unseen-arclight-07-r1/answer.txt) | False | fail | 虽区分了局部消融，随后仍把新增ReAct/单代理/关上下文组写成已实测。 |
| [qwen/unseen-arclight-07/r2](qwen/unseen-arclight-07-r2/answer.txt) | False | revise | 方向正确，但把31.33/43.67写为31/43损失精度，宜保留已提供值。 |
| [deepseek/unseen-arclight-09/r1](deepseek/unseen-arclight-09-r1/answer.txt) | False | fail | “差异只能归到这一项”忽略采样随机性、重复及交互；单次实验不能证明唯一原因。 |
| [deepseek/unseen-arclight-09/r2](deepseek/unseen-arclight-09-r2/answer.txt) | False | revise | 对照计划方向可用，开关总效应仍可测，不应一概说不能单独归因；裁判要求复述未报的旧成绩也过严。 |
| [qwen/unseen-arclight-09/r1](qwen/unseen-arclight-09-r1/answer.txt) | False | revise | 同模型单开关是边际贡献证据；需重复与固定条件，不能由一次差异断言唯一原因，也不等于解释整体提升。 |
| [deepseek/unseen-cae-01/r1](deepseek/unseen-cae-01-r1/answer.txt) | True | usable | 281ms是批次持久受理P95，50是每批Case，5是客户端并发，不是求解并发。 |
| [deepseek/unseen-cae-01/r2](deepseek/unseen-cae-01-r2/answer.txt) | True | usable | 281ms是批次持久受理P95，50是每批Case，5是客户端并发，不是求解并发。 |
| [qwen/unseen-cae-01/r1](qwen/unseen-cae-01-r1/answer.txt) | True | usable | 281ms是批次持久受理P95，50是每批Case，5是客户端并发，不是求解并发。 |
| [qwen/unseen-cae-01/r2](qwen/unseen-cae-01-r2/answer.txt) | True | revise | 把5并发客户端说成线程数，计量对象有差别，应保留客户端并发。 |
| [deepseek/unseen-cae-02/r1](deepseek/unseen-cae-02-r1/answer.txt) | True | usable | 应同时核对请求/执行身份、远端进程及启动事实，不能只看HTTP或DB记录；外部副作用不自动exactly-once。 |
| [deepseek/unseen-cae-02/r2](deepseek/unseen-cae-02-r2/answer.txt) | True | usable | 应同时核对请求/执行身份、远端进程及启动事实，不能只看HTTP或DB记录；外部副作用不自动exactly-once。 |
| [qwen/unseen-cae-02/r1](qwen/unseen-cae-02-r1/answer.txt) | False | fail | ExecutionPollLease.makeDue只是轮询调度，不能证明lease_until门禁防止启动；取错模块。 |
| [qwen/unseen-cae-02/r2](qwen/unseen-cae-02-r2/answer.txt) | True | fail | 同身份不同输入应冲突拒绝；把不同输入与新attempt统称合法新执行错误，自动通过漏检。 |
| [deepseek/unseen-cae-03/r1](deepseek/unseen-cae-03-r1/answer.txt) | True | usable | 恢复条件就绪起算，不含断网一分钟；收敛终点应是平台与远端事实一致。 |
| [deepseek/unseen-cae-03/r2](deepseek/unseen-cae-03-r2/answer.txt) | True | usable | 恢复条件就绪起算，不含断网一分钟；收敛终点应是平台与远端事实一致。 |
| [qwen/unseen-cae-03/r1](qwen/unseen-cae-03-r1/answer.txt) | True | usable | 恢复条件就绪起算，不含断网一分钟；收敛终点应是平台与远端事实一致。 |
| [qwen/unseen-cae-03/r2](qwen/unseen-cae-03-r2/answer.txt) | True | revise | 起点正确，但“任务可继续执行”不等于平台状态/远端事实/资源账本收敛。 |
| [deepseek/unseen-cae-04/r1](deepseek/unseen-cae-04-r1/answer.txt) | True | usable | 120=46缺陷+74合规，有限回归不能推出所有输入零错误。 |
| [deepseek/unseen-cae-04/r2](deepseek/unseen-cae-04-r2/answer.txt) | True | usable | 120=46缺陷+74合规，有限回归不能推出所有输入零错误。 |
| [qwen/unseen-cae-04/r1](qwen/unseen-cae-04-r1/answer.txt) | True | usable | 120=46缺陷+74合规，有限回归不能推出所有输入零错误。 |
| [qwen/unseen-cae-04/r2](qwen/unseen-cae-04-r2/answer.txt) | True | usable | 120=46缺陷+74合规，有限回归不能推出所有输入零错误。 |
| [deepseek/unseen-cae-05/r1](deepseek/unseen-cae-05-r1/answer.txt) | True | usable | 省的是人工报告整理，不是Solver；30配对/76.3声明与45到5–8叙事不是同一原始数据。 |
| [deepseek/unseen-cae-05/r2](deepseek/unseen-cae-05-r2/answer.txt) | True | fail | 45到5–8的直接降幅约82.2–88.9%，不能算成76.3%；叙事示例混入历史指标，自动通过漏检。 |
| [qwen/unseen-cae-05/r1](qwen/unseen-cae-05-r1/answer.txt) | True | usable | 省的是人工报告整理，不是Solver；30配对/76.3声明与45到5–8叙事不是同一原始数据。 |
| [qwen/unseen-cae-05/r2](qwen/unseen-cae-05-r2/answer.txt) | False | usable | 正面回答人工整理而非求解，30配对与代码后处理佐证在本问足够；裁判强求全部聚合定义属过严。 |
| [qwen/unseen-cae-08/r1](qwen/unseen-cae-08-r1/answer.txt) | False | revise | 复用既有求解结果避免重跑方向正确，但需具体核对checksum、指标集、condition/subcase及版本失效条件。 |
| [deepseek/unseen-general-01/r1](deepseek/unseen-general-01-r1/answer.txt) | True | usable | 要分prefill计算与KV存储：标准稠密注意力部分近二次，KV按长度线性；不把计算复杂度直接当端到端实测耗时。 |
| [deepseek/unseen-general-01/r2](deepseek/unseen-general-01-r2/answer.txt) | True | usable | 要分prefill计算与KV存储：标准稠密注意力部分近二次，KV按长度线性；不把计算复杂度直接当端到端实测耗时。 |
| [qwen/unseen-general-01/r1](qwen/unseen-general-01-r1/answer.txt) | True | fail | 把prefill主要瓶颈说成带宽而非算力，且把计算近二次直接写成耗时平方；自动通过漏检。 |
| [qwen/unseen-general-01/r2](qwen/unseen-general-01-r2/answer.txt) | True | usable | 要分prefill计算与KV存储：标准稠密注意力部分近二次，KV按长度线性；不把计算复杂度直接当端到端实测耗时。 |
| [deepseek/unseen-general-03/r1](deepseek/unseen-general-03-r1/answer.txt) | True | usable | RRF按排名融合避免量纲，归一化加权需校准；合并去重后可重排。 |
| [deepseek/unseen-general-03/r2](deepseek/unseen-general-03-r2/answer.txt) | True | usable | RRF按排名融合避免量纲，归一化加权需校准；合并去重后可重排。 |
| [qwen/unseen-general-03/r1](qwen/unseen-general-03-r1/answer.txt) | True | usable | RRF按排名融合避免量纲，归一化加权需校准；合并去重后可重排。 |
| [qwen/unseen-general-03/r2](qwen/unseen-general-03-r2/answer.txt) | True | usable | RRF按排名融合避免量纲，归一化加权需校准；合并去重后可重排。 |
