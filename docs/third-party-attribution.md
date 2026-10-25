# 第三方来源与实现责任

核查日期：2026-10-24。本文件只记录公开源码及其可复查来源，不记录个人履历、私人资料或岗位正文。

## 核查版本与证据

| 项目 | 固定公开版本 | 本地快照与索引 |
| --- | --- | --- |
| Arclight | [`528704eb373f637830640b3fefcc5cbc95f23a78`](https://github.com/Astrea-296111/Arclight/tree/528704eb373f637830640b3fefcc5cbc95f23a78) | [`materials/projects/arclight`](../materials/projects/arclight)、[`source-lock.json`](../materials/source-lock.json) |
| CAE | [`c50dd29d1b1981e299d2ce4821e0a1ef745aa48e`](https://github.com/Astrea-296111/cae-job-platform/tree/c50dd29d1b1981e299d2ce4821e0a1ef745aa48e) | [`materials/projects/cae`](../materials/projects/cae)、[`source-lock.json`](../materials/source-lock.json) |

本轮读取了依赖清单、关键 import、文件头、源码实现、固定提交的 GitHub commit/tree API 和可达提交列表。`source-lock.json` 保存每个收录文件的 SHA-256 与 Git blob，不能把不同版本的引用混在同一实现结论中。

Arclight 的固定提交是无父提交的 `Initial commit`，公开时间为 2026-10-13；该提交可达历史只返回这一条。CAE 的固定提交为 2026-10-12 的 M11 提交；本轮读取其最近 15 条可达提交，包含 M0–M11 的工程阶段。提交说明能够支持公开仓库的版本组织，不能证明个人开发起止时间、私下参考过程或每行代码的原作者。

可复查入口：[Arclight commit](https://api.github.com/repos/Astrea-296111/Arclight/commits/528704eb373f637830640b3fefcc5cbc95f23a78)、[Arclight tree](https://api.github.com/repos/Astrea-296111/Arclight/git/trees/528704eb373f637830640b3fefcc5cbc95f23a78?recursive=1)、[CAE commit](https://api.github.com/repos/Astrea-296111/cae-job-platform/commits/c50dd29d1b1981e299d2ce4821e0a1ef745aa48e)、[CAE history](https://api.github.com/repos/Astrea-296111/cae-job-platform/commits?sha=c50dd29d1b1981e299d2ce4821e0a1ef745aa48e&per_page=15)。

## 关系一：直接依赖

### Arclight

[`pyproject.toml`](../materials/projects/arclight/pyproject.toml) 的发行包名称、命令入口与 wheel 包目录均为 `mewcode`；`MewCode`/`mewcode` 是 Arclight 当前源码中的历史命名，不是第三个独立项目。该快照主要实现为 Python；`MEWCODE.md` 中孤立的 Go 描述不能覆盖包清单和实际源码。

| 依赖及声明约束 | 实际调用证据 | 第三方负责的能力 | 项目集成层负责的部分 |
| --- | --- | --- | --- |
| Textual `>=2.1.0` | [`mewcode/app.py`](../materials/projects/arclight/mewcode/app.py) 导入 `App`、容器与控件；对话框也导入 Textual | 终端 UI 框架、布局、控件与事件基础设施 | 页面状态、模型事件展示、权限交互及 Agent 运行时接线 |
| Pydantic `>=2.0` | [`tools/base.py`](../materials/projects/arclight/mewcode/tools/base.py)、[`agent.py`](../materials/projects/arclight/mewcode/agent.py) 的参数模型与 `model_validate` | 模型字段校验与 JSON Schema 生成 | 工具契约、错误回注、权限检查和动作业务语义；类型通过不等于动作获准 |
| MCP SDK `>=1.12.0` | [`mcp/client.py`](../materials/projects/arclight/mewcode/mcp/client.py) 使用 `ClientSession`、stdio 与 streamable HTTP；[`mcp/manager.py`](../materials/projects/arclight/mewcode/mcp/manager.py) 注册远端工具 | MCP 协议及客户端传输实现 | 服务配置、生命周期、工具包装与注册、按需发现，以及调用权限和错误边界 |
| Anthropic SDK `>=0.42.0`、OpenAI SDK `>=1.60.0` | [`client.py`](../materials/projects/arclight/mewcode/client.py) 导入 `AsyncAnthropic`、`AsyncOpenAI` | 对应模型服务的 SDK 调用、传输与事件接口 | 统一流式事件、协议消息转换、模型配置、工具调用接回 Agent Loop |
| PyYAML `>=6.0`、HTTPX `>=0.27.0` | 包清单；配置/Skill 解析及 MCP HTTP 客户端 | YAML 解析与 HTTP 客户端基础能力 | 配置约束、环境传递与服务使用方式 |

这些是声明的版本范围，不能当成一次实验实际安装版本的锁定记录。框架、SDK 和模型训练能力均应归于各自提供者；项目工作可以落到循环控制、上下文预算、消息配对、工具加载、会话恢复、集成及边界验证。

### CAE

| 依赖或基础设施 | 实际调用证据 | 责任边界 |
| --- | --- | --- |
| Spring Boot `3.3.6`，Web/Security/Validation/Actuator/JDBC/Redis/AMQP starters | [`backend/pom.xml`](../materials/projects/cae/backend/pom.xml) | 框架提供 HTTP、安全、校验、事务接线、观测与客户端基础设施；项目定义领域状态、鉴权范围、事务内写入及故障语义 |
| Spring AMQP / RabbitMQ | [`OutboxPublisher.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/outbox/OutboxPublisher.java)、[`SubmitCommandListener.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/messaging/SubmitCommandListener.java) | Spring AMQP 提供 `RabbitTemplate`、监听及 confirm 接口，Broker 提供队列投递；项目持久化 Outbox/Inbox，区分逻辑与物理 ID，安排 ACK、重试和执行身份核验。不能把 SDK 或 confirm 称为端到端 exactly-once |
| MySQL、JdbcTemplate、Spring 事务、Flyway | [`JobRepository.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/job/repository/JobRepository.java)、[`ResourceReservationService.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/resource/ResourceReservationService.java)、[`InboxRepository.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/messaging/InboxRepository.java) | 数据库提供事务、锁和约束，Spring 管理事务；项目定义 status/version 条件更新、唯一键、资源账本、锁顺序及事务边界。公开持久层为 JdbcTemplate，不能改称已用 MyBatis |
| Redis | [`JobQueryCache.java`](../materials/projects/cae/backend/src/main/java/com/example/cae/job/application/JobQueryCache.java) | 缓存与观测加速，查询先检查权限；业务状态和资源分配真相仍在 MySQL |
| 共享文件系统；NFS/GPFS/NAS 是部署适配选择 | [`ADR-005`](../materials/projects/cae/docs/adr/ADR-005-shared-fs-for-solver-data.md)、[`real-system-mapping.md`](../materials/projects/cae/docs/real-system-mapping.md) | 公开 Compose 使用本地 Docker volume，没有据此验证生产 NFS。存储系统提供文件服务；项目负责输入/产物身份、路径约束、校验和、版本与发布协议。心跳不证明共享存储可达，NFS 也不替代数据库事务 |
| FastAPI `0.115.6`、HTTPX `0.28.1`、Pydantic `2.10.4`、psutil `6.1.1`、Uvicorn `0.34.0` | [`worker/requirements.txt`](../materials/projects/cae/worker/requirements.txt)、Worker API/执行管理 import | Web、数据校验及进程观察由依赖提供；项目定义执行请求指纹、持久 claim、查询/取消与进程身份核验 |
| Matplotlib `3.9.4`、NumPy `2.2.2`、python-pptx `1.0.2`、Pillow `11.1.0`、lxml `5.3.0` | [`worker/requirements.txt`](../materials/projects/cae/worker/requirements.txt)、[`post/processor.py`](../materials/projects/cae/worker/post/processor.py) 及报告生成代码 | 提供绘图、数值和文件格式能力；项目约束 render specification、输入版本、产物 manifest 与人工审核。公开图片和求解数据是合成演示，不是商业 Solver 算法 |
| Vue `3.5.22`、Pinia `3.0.3`、Vue Router `4.5.1`、Axios `1.12.2`、Element Plus `2.11.5`、ECharts `6.0.0` | [`frontend/package.json`](../materials/projects/cae/frontend/package.json) | UI、状态管理、HTTP 与图表框架；项目实现业务页面、通知后重查及服务端权限对应交互 |

测试与构建还直接使用 pytest/pytest-asyncio、Spring 测试工具、Hatchling、Vite、TypeScript、ESLint 等，完整声明保留在上述清单中。本文件不以框架调用量衡量个人贡献。

## 关系二：复制或修改第三方代码

Arclight 快照中有 125 个 Python 文件以 `来源：公众号@小林coding` 开头，同时保留 `xiaolincoding.com`、`xiaolinnote.com` 等来源地址。例如 [`agent.py`](../materials/projects/arclight/mewcode/agent.py)、[`context/manager.py`](../materials/projects/arclight/mewcode/context/manager.py)、[`tools/edit_file.py`](../materials/projects/arclight/mewcode/tools/edit_file.py)、[`teams/mailbox.py`](../materials/projects/arclight/mewcode/teams/mailbox.py)。这证明存在明确的文件级来源声明，应继续保留。

**未发现可证实的复制修改清单**：本轮未取得这些声明对应的原始仓库、固定上游提交及逐文件差异，因此不能区分每个文件的原样复制、修改适配与自行补充范围；也不能把保留 header 的代码全部声称为个人原创。Arclight 只有一个公开根提交，无法从该历史还原更早的修改过程。CAE 本轮检查的依赖、关键源文件及最近 15 条历史未提供能定位另一项目原始代码与修改差异的证据。

这项结论只说明已取得证据的范围，不等于“没有复用”，也不把架构相似当作复制证据。以后取得上游版本时，补记原始路径/提交、文件 hash、修改 diff 与相应许可。

## 关系三：源码明确标注的设计参考

[`mewcode/context/manager.py`](../materials/projects/arclight/mewcode/context/manager.py) 的近期原文保留窗口注释明确写到“对应 Claude Code compact.ts 的 buildPostCompactMessages messagesToKeep”。可将其归为**注释声明的机制参考**，解释摘要前缀与保留尾部的设计比较。

本轮没有取得该注释对应的 Claude Code 固定版本、源码许可或逐行差异，所以它不构成复制代码、完整复用产品或实现等价性的证明。模型名称中的 `claude` 和 Anthropic SDK import 也不能单独证明参考过 Claude Code 的产品实现。

## 关系四：本轮仅作机制比较

| 对照对象 | 可比较的问题 | 当前证据允许的表达 |
| --- | --- | --- |
| [Aider repository map](https://aider.chat/docs/repomap.html) | 如何在上下文预算内提供代码结构与相关符号；检索覆盖和成本如何验证 | “可以对照 repository map 比较上下文选择”；没有依赖、import 或历史证据时，不说项目已复制/复用 Aider |
| [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | 图状态、checkpoint 与 durable execution，如何处理恢复后的副作用 | “可以比较状态持久化模型”；当前 Arclight 的 JSONL/compact boundary 不自动具备框架全部恢复保证 |
| Claude Code 的终端 Agent 交互 | 模型、工具、上下文、权限与用户交互如何组合 | 可比较产品和机制；上节明确的单条注释以外，不补造历史参考、代码来源或性能优越性 |

本轮在 Arclight 依赖清单和 import 中未发现 Aider 或 LangGraph。上表是本轮分析所作的对照，不是开发者过去已经比较、接入或贡献这些项目的历史声明。

## LICENSE 与未取得的证据

两份固定版本的 `source-lock.json` 均记录 `licenseFiles: []`。本轮进一步检查固定提交完整 Git tree，未发现 `LICENSE`、`COPYING` 或 `NOTICE` 许可文件；CAE 的 `LicensePoolController.java` 是业务上的软件许可容量控制器，不是源码许可证。不能将 CUE 自身的许可证反写成两个上游项目已经声明的许可证，也不能把文件头的来源网站当成许可证全文。

直接依赖应保留各自发行版本的许可与通知。本轮没有下载所有依赖发行包或完成传递依赖许可证审计，所以上表记录可核查的依赖关系和版本声明，不宣称所有依赖已完成逐包许可审计。

本轮未取得向这些第三方项目提交 PR、被合并贡献、商业部署或完整性能对照的证据。介绍实现时以实际调用链、状态机、胶水层、预算策略和验证边界为依据；需要说明贡献时另列可定位的提交或 PR 链接。
