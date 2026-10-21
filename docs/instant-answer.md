# 极速问答与最新问题优先

默认启用 `realtimeAnswerMode: 'instant'`。本次目标优先于旧问题清单；语音、快捷键、按钮和手动输入共用主进程的 QuestionResolver。极速请求只读已就绪的少量内存资料，未命中仍发送一次正文流式请求。它消除了前台等待检索的条件，不能保证供应商在固定毫秒内返回正文。

真实入口仍是 `package.json → src/custom-main.js → src/bugfix-main.js → main.js`。外层 `createLLM` 包装器已转发请求级配置，避免全局深度开关覆盖极速模型选择。

## 使用与回退

- 主界面的“极速/标准”选择保存 `realtimeAnswerMode`；新安装和已有配置缺少此字段时均默认极速。
- 极速覆盖“如何回答”、`answerThis` 和纯文字 `ask`，使用当前服务商已配置的 fast 模型，不修改持久化 `smart`。
- 标准模式沿用现有深度选择和项目检索。截图、屏幕问答、完整代码题保留原输入和输出预算，技术解题快捷键不改含义。
- “本次回答/正在回答”显示主进程快照；生成中出现新题时另显示“下次”。“编辑”只有点击后才复制到手动输入框，不会自动请求模型。
- 没有新目标不隐式重答；使用“重答”显式绑定已冻结的目标。重答保留原技术/截图/口述入口及预算，不把完整代码重答降为普通口述。
- `instantRagPolicy: 'ready-only'` 是默认值；`off` 只作无资料对照。它们不等待正在进行的预取。

通过现有 API 也能设置：

```js
await window.cue.settingsSet({ realtimeAnswerMode: 'standard' });
await window.cue.settingsSet({ realtimeAnswerMode: 'instant', instantRagPolicy: 'ready-only' });
```

最新问题选择修复由所有语音回答入口共享；回退标准主要恢复模型、上下文和检索策略，不恢复“空目标自动重答旧题”的旧行为。

## 本次目标的身份与生命周期

QuestionResolver 返回冻结的 `QuestionSnapshot`，包括 `epoch/questionId/revision/text/sourceKeys/sourceOrder/observedAt/status/reason/referenceContext`。`sourceKeys` 和 parts 数组不可变，兼容的 keys getter 返回 Set 副本。手动文字保留用户原文，语音允许既有 NFKC/标点规范化。

本地规则结合连接词、纠正、条件、说话边界和事件身份，区分独立要求与同题补充，不调用额外模型，不使用项目/技术实体白名单判题。

| 输入 | 旧行为 | 新行为 |
| --- | --- | --- |
| Redis 持久化 → 500ms → CAE 职责 | 累积两题 | 以职责为当前目标 |
| “不是缓存，我问的是团队分工。” | 分工可能成为 pending | final/interim 都可纠正 |
| “团队分工呢” | 可能因无问号丢弃 | 有意义的最新目标可立即提交 |
| 新边界后“另外一个问题……” | 可能复活旧题 | 显示新问题尚未完整，不请求模型 |
| 原题后的“比如……” | 可能覆盖已确认主体 | 未完成例子不夺取主体 |
| 条件、多问跨多个 final | final 可能被当作题目边界 | 保留同题约束、否定、数字与子问 |
| 没有新发言再按回答 | 回退上一题 | 明确无新目标，显式重答可用 |

发送时 claim 冻结目标，后续 B 不会自动合并进正在回答的 A。ASR 更新只更新预览和可选后台准备，不自动取消回答；用户明确提交 B 才取消 A。完成、失败、取消只结算所属快照，不消费新语音。失败重试创建新请求 revision，仍绑定原问题身份。

同 key 的较新修订可替换原项，final 可以比 interim 更短。`utteranceOrder` 只在相同来源会话比较；没有可靠顺序时使用本地关联，不伪造全局顺序。Qwen、Deepgram 和 OpenAI 实际连接均产生独立 `sourceSessionId`，旧 socket 的迟到 open/message/error/close 不会污染新会话。显式停止取消重连定时器。

解析器保留至多 80 个事件记录（120 秒清理）、16 个来源/高水位、32 个已退休会话和 8 个请求占用；同题 ASR 单位超过 64 个时合并保留原文。当前题不为软预算裁去中段，真正超模型窗口时返回明确错误，不发送缺条件的请求。

这些是本地规则；罕见表达仍可能判错，可通过目标预览和显式编辑纠正。无来源身份的旧协议没有可靠乱序判断能力。

## 极速上下文与 ready-only

极速不调用 `buildInterviewContextBundleAsync`。路径是：

```text
触发 → 冻结目标 → 内存项目身份 → peekReadyEvidence → 可选上下文预算
     → prepareFinalRequest → 实际 SDK 序列化 → 单次流式正文 → DOM ack
```

`peekReadyEvidence` 最多检查 8 个已存在候选，保留至多 3 个完整来源，总原文默认不超过 1,800 字符（硬上限 2,400）。只使用调用方传入的 prepared canonical snapshot 验证 source ID、项目、版本、位置和原文；不读取磁盘，不建索引、不词法全量补查、不 query embedding、不重排、不父块/关系扩展，不等待 Promise。大块或身份不符直接跳过。

完整预取结果要求 epoch、项目 scopes/revision、questionId/revision、完整问题、来源 keys、模型和检索配置一致。跨问只复用原文，清除旧批准，重新做有界相关性、显式符号、否定和职责检查。未知显式项目不继承上一项目来源；无就绪项目目录时按通用方案作答。`readyEvidenceHit` 和 sourceCount 以最终 SDK 可见来源为准，预算删除来源不算已使用命中。

沿用现有 ProjectRagSession：后台 800ms、硬上限 1,000ms，一个运行任务/最新 pending 和最多两项相邻准备。极速前台保护期暂停启动新任务并取消当前可取消工作；原生推理不可假定立即抢占。正文首块后解除保护，晚到资料供后续请求使用，不自动生成第二份答案。

独立新题发送零历史消息，不附旧 checklist.pending、讨论进度或旧遗漏要求。明确指代最多取最近相关一轮的有界参考，旧 AI 回答标为非项目事实；当前新条件优先。清单仍由标准模式和复盘使用。

可选上下文预算与真实模型窗口分开：

| 部分 | 默认本地估算预算 |
| --- | ---: |
| 固定系统指令，不含用户风格 | ≤400 token |
| 必要历史/自述参考 | ≤250 token |
| 项目短卡片与 ready 证据 | 合计 ≤650 token |
| 普通总输入软目标 | ≤2,200 token |

当前完整问题和现有上限内的用户风格优先；先删可选资料、再删历史，不截断当前题。保留现有 400/640、复杂多问与完整代码预算。估算器把非 ASCII 字符保守计为 2 token、ASCII 连段约每 3 字符 1 token，与供应商 tokenizer 不同，usage 另记 actualInputTokens。

## 导入哪些资料

已有项目 RAG 的目录/ZIP、front matter、源码引用格式继续兼容，详见 [实时项目资料说明](realtime-project-evidence.md)。建议每个项目包含：项目清单、实现、选型理由、个人职责、协作、困难、实测指标及环境、限制，并关联真实源码。不要把旧 AI 答案当成资料事实。

极速只吃少量就绪资料，超大块会整块跳过；把能独立表达事实的主题短卡片控制在约 100–250 个中文字通常更有用。保留出处、版本、事实范围和状态，不为了命中把不同项目混成一段。

设置中的旧 `projectKnowledge/resumeText/starStories` 在启动或设置变更时预编译，按原文段落/Markdown 标题建立至多 96 张卡片；按键时最多检查 8 张。项目类卡片要求明确的项目标题身份，例如：

```md
# 项目名称

我负责缓存接口契约和联调；同事负责调度器。

## 选型

采用版本校验应对缓存失效，代价是读取时多一次版本比较。
```

标题需与解析后的项目名称一致。正文提及另一个项目不能赋予归属；无标题的大段旧资料、超长段落和不能确认项目身份的卡片会被跳过。可选择标准模式检索完整资料。手工卡片仍是用户提供的待核对数据，不能自动证明上线经历或指标。

无资料时，系统要求给可采用的工程方案或参考草稿，用“我会”等措辞；不伪造团队人数、生产事故、量化结果、职责或代码路径。界面给出“参考草稿”标记，正文不以缺口清单替代回答。

## 模型配置与传输

`createLLM(settings, { executionProfile: 'instant' })` 只在请求内选择当前服务商的 fast 配置，不改存储的深度偏好，不换供应商、不借用其他密钥。截图/技术题和标准模式保持原配置选择。

自动思考控制只作用于显式能力映射：官方 DashScope 的已知可切换 Qwen、官方 Gemini 2.5 Flash 的支持预算，以及已知非推理模型；未知网关、未知别名或仅思考模型显示“未知/无法关闭”。没有 reasoning 事件不代表服务器绝无隐藏思考。协议来源见代码中的官方链接，0.70 RAG 阈值也未在本次重新校准。

保留用户 `providerOptions`，可用独立 `instantProviderOptions[provider]` 覆盖极速参数。界面只有实际诊断确认官方可切换模型后才允许独立思考设置。开启覆盖会显示开启，不会同时宣称已关闭。

极速关闭 SDK 隐式重试：OpenAI/Azure/Anthropic 使用 `maxRetries:0`，Gemini 使用经已安装 SDK 验证的单次尝试配置，Ollama 单次 fetch。本次没有因 `new Client` 就声称重建 TCP，也没有增加自动探活、测速或双模型竞速。

## 时间、构建与诊断

继续使用 `[latency][prompt/reply/model/usage/ui]`，关联 requestId、epoch、questionId/revision、executionProfile、实际模型与 buildCommit。记录准备、ready 命中/跳过原因、可选 token estimate、sourceCount、queueDelay、取消与实际 usage，不默认记录问题全文、私有源码、完整 endpoint 或密钥。

| 指标 | 边界 |
| --- | --- |
| triggerToDispatchMs | 主进程收到触发 → adapter 序列化后、调用 SDK 前的 onRequest |
| questionAgeMs / questionSource | 目标事件年龄与来源，包含人等待按键的间隔 |
| asrLagMs | 仅在 VAD/final 来源、会话与 utteranceKey 可可靠关联时提供 |
| vadEndToFinalMs | 可保留本地端点近似，asrAssociation 明确区分 |
| providerResponseMs | SDK stream 就绪或 Ollama HTTP headers；不是服务器内部排队分解 |
| firstReasoningMs | 可观测到的首个 reasoning；无事件为 null |
| firstContentMs | dispatch → 首个非空正文，排除 reasoning、空白与 usage |
| triggerToFirstContentMs | 触发 → 首个非空正文 |
| triggerToFirstUsefulSentenceMs | 排除等待语/格式行的句末启发式，非语义质量测评 |
| renderAckMs | 主进程触发时钟 → DOM 插入确认收到，包含 IPC |
| paintApproxMs | 双 rAF ack 的近似，包含 IPC，不是像素呈现时刻 |

renderer 帧间隔使用其自身时钟差，主进程不直接减 renderer 时间戳。超过 1,500ms 未见正文只显示状态，不把状态计入回答，不自动取消重试；保留现有 inactivity/总时长边界。

启动时缓存 Git SHA/dirty 状态；打包 beforePack 组合原有原生依赖校验和 build-info.json 写入，包内包含该文件。无 Git/无元数据时报告 unavailable，不用版本号 0.2.2 冒充提交身份。

验证、四组对照原始数据和在线/Windows 复现命令见 [验收报告](benchmarks/instant-answer-2026-10-21.md)。本次没有真实在线模型、Windows 音频和用户现场首字测量，不能据离线传输夹具宣称解决全部 3–7 秒等待。
