# 最新面试38次真实生成审阅

17次真实口述输出点×2供应商，加2道明确新编SQL题×2供应商；全部38条原文已审阅。原TXT缺少截图，9次屏幕建议没有冒充原题复测。旧judge和自动SQL判定均保留，SQL校验修正独立记录，0次额外生成。

| 回答 | 原自动 | 来源审阅 | 结论 |
|---|---|---|---|
| [deepseek/latest-01](deepseek/latest-01-r1/answer.txt) | True | usable | 大工具输出落盘与有损摘要的动机对应上下文代码，工具分层不得当作中文向量检索。 |
| [qwen/latest-01](qwen/latest-01-r1/answer.txt) | True | usable | 大工具输出落盘与有损摘要的动机对应上下文代码，工具分层不得当作中文向量检索。 |
| [deepseek/latest-02](deepseek/latest-02-r1/answer.txt) | False | revise | 写成memos.md，实际memories.md；主要存储内容/频率正确，文件名仍应修正。 |
| [qwen/latest-02](qwen/latest-02-r1/answer.txt) | True | usable | 编码偏好/纠正反馈/项目知识及每5轮提取可核查；memories.md与独立memory目录要区分。 |
| [deepseek/latest-03](deepseek/latest-03-r1/answer.txt) | True | usable | 形状/业务状态/权限分开，类型校验不等于调用安全。 |
| [qwen/latest-03](qwen/latest-03-r1/answer.txt) | True | usable | 形状/业务状态/权限分开，类型校验不等于调用安全。 |
| [deepseek/latest-04](deepseek/latest-04-r1/answer.txt) | True | usable | ToolResult错误回传而非统一错误码库，已修正旧建议中的虚构中心。 |
| [qwen/latest-04](qwen/latest-04-r1/answer.txt) | True | usable | ToolResult错误回传而非统一错误码库，已修正旧建议中的虚构中心。 |
| [deepseek/latest-05](deepseek/latest-05-r1/answer.txt) | True | usable | 模型读错误决定下一步；未知工具保护不等于运行时唯一终止控制。 |
| [qwen/latest-05](qwen/latest-05-r1/answer.txt) | True | usable | 模型读错误决定下一步；未知工具保护不等于运行时唯一终止控制。 |
| [deepseek/latest-06](deepseek/latest-06-r1/answer.txt) | True | revise | 可作为千工具的设计方案，索引/自动抽取/更新指标需明确是假设，不能保证秒级。 |
| [qwen/latest-06](qwen/latest-06-r1/answer.txt) | False | revise | 可作为千工具的设计方案，索引/自动抽取/更新指标需明确是假设，不能保证秒级。 |
| [deepseek/latest-07](deepseek/latest-07-r1/answer.txt) | True | revise | 不能保证本地MCP参数模型拒绝所有枚举值；包装器只构造顶层类型，完整服务端Schema不等于运行时全部约束都执行。 |
| [qwen/latest-07](qwen/latest-07-r1/answer.txt) | True | usable | ToolSearch发现后加载完整Schema、MCP保留服务端inputSchema；外部工具不等于全部由Pydantic重新生成。 |
| [deepseek/latest-08](deepseek/latest-08-r1/answer.txt) | False | revise | 关键词具体算法仍不足/错误；实际小写整串子串及空白拆词加权，不是纯精确或向量。 |
| [qwen/latest-08](qwen/latest-08-r1/answer.txt) | True | revise | 没有编造算法，但未回答精确/模糊的具体实现；已补查search_deferred源码。 |
| [deepseek/latest-09](deepseek/latest-09-r1/answer.txt) | True | usable | 混合召回与重排明确说我会，是建议，不冒充已实现向量检索。 |
| [qwen/latest-09](qwen/latest-09-r1/answer.txt) | True | usable | 混合召回与重排明确说我会，是建议，不冒充已实现向量检索。 |
| [deepseek/latest-10](deepseek/latest-10-r1/answer.txt) | True | usable | 按Agent/上下文选强项，千工具写成我会设计，未声称做过小模型训练。 |
| [qwen/latest-10](qwen/latest-10-r1/answer.txt) | False | fail | 把JD中的Schema Linking/NL2SQL优化写成本人Arclight成果，确属编造；后续移除不相关JD注入。 |
| [deepseek/latest-11](deepseek/latest-11-r1/answer.txt) | True | usable | 按需发现、服务前缀与完整Schema说明路由设计，不能保证语义选择一定正确。 |
| [qwen/latest-11](qwen/latest-11-r1/answer.txt) | True | usable | 按需发现、服务前缀与完整Schema说明路由设计，不能保证语义选择一定正确。 |
| [deepseek/latest-12](deepseek/latest-12-r1/answer.txt) | True | revise | 路径检索/工具回传方向可用；Pydantic参数类型本身不能保证目标路径存在，需执行层检查。 |
| [qwen/latest-12](qwen/latest-12-r1/answer.txt) | True | revise | 路径检索/工具回传方向可用；Pydantic参数类型本身不能保证目标路径存在，需执行层检查。 |
| [deepseek/latest-13](deepseek/latest-13-r1/answer.txt) | True | fail | 否认已建知识图谱有边界意识，但又声称预建切块/函数签名索引，当前Arclight主要是文件工具现场检索，仍编造细节。 |
| [qwen/latest-13](qwen/latest-13-r1/answer.txt) | True | fail | 否认已建知识图谱有边界意识，但又声称预建切块/函数签名索引，当前Arclight主要是文件工具现场检索，仍编造细节。 |
| [deepseek/latest-14](deepseek/latest-14-r1/answer.txt) | True | usable | 库存/变更/调拨/补货角色是明确设计例子，不应把面试官的上百应用写成本人规模。 |
| [qwen/latest-14](qwen/latest-14-r1/answer.txt) | True | usable | 库存/变更/调拨/补货角色是明确设计例子，不应把面试官的上百应用写成本人规模。 |
| [deepseek/latest-15](deepseek/latest-15-r1/answer.txt) | False | revise | 影响分析/排障方案本身可用，开头“我理解/我会按环节讲”元话语应删；裁判把假设当编造且否定正确编号，属于部分误判。 |
| [qwen/latest-15](qwen/latest-15-r1/answer.txt) | True | revise | “哪些环节可用Agent框架”回答成混合检索启用环节，窄化指代。 |
| [deepseek/latest-16](deepseek/latest-16-r1/answer.txt) | False | revise | 冻结原实体含面试官“库存100多应用及依赖”，可作为假设场景；须显式我会设计，不能被当项目已做BM25/语义路由。裁判没看到该冻结指代而误说100无上下文。 |
| [qwen/latest-16](qwen/latest-16-r1/answer.txt) | False | revise | 冻结原实体含面试官“库存100多应用及依赖”，可作为假设场景；须显式我会设计，不能被当项目已做BM25/语义路由。裁判没看到该冻结指代而误说100无上下文。 |
| [deepseek/latest-17](deepseek/latest-17-r1/answer.txt) | False | revise | 没有可靠历史规模数字时应简短保留未知，再给真实项目实例，不能只讲我会如何回答或借用面试官规模。 |
| [qwen/latest-17](qwen/latest-17-r1/answer.txt) | False | revise | 没有可靠历史规模数字时应简短保留未知，再给真实项目实例，不能只讲我会如何回答或借用面试官规模。 |
| [deepseek/latest-sql-01](deepseek/latest-sql-01-r1/answer.txt) | False | usable | 隔离SQLite按原题数据执行得到正确客单价/活动GMV。 原校验器只许单列，误拒绝正确的GMV/买家数/客单价三列；保留旧判定，另记校验修正，无新生成。 |
| [qwen/latest-sql-01](qwen/latest-sql-01-r1/answer.txt) | True | usable | 隔离SQLite按原题数据执行得到正确客单价/活动GMV。 |
| [deepseek/latest-sql-02](deepseek/latest-sql-02-r1/answer.txt) | True | revise | 隔离SQLite按原题数据执行得到正确客单价/活动GMV。 题目只要SQL，仍附了两点解释，属于格式指令偏差。 |
| [qwen/latest-sql-02](qwen/latest-sql-02-r1/answer.txt) | False | fail | 直接JOIN重复报名使GMV=40而非20；必须EXISTS或先去重。 |
