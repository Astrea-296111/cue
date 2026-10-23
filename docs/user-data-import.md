# 用户资料与项目导入

每个项目准备一个源码目录或 ZIP，把能作为事实的说明放在同一项目的 `interview/` 下。在 Cue 设置“资料”中分别导入两个项目即可；产品没有限制为两个项目，既有导入数量和文件上限仍适用。导入是本地快照，原文件修改后需要重新导入。

## 项目身份与简历顺序

建议创建 `interview/project.md`：

```yaml
---
schema_version: 1
project_id: booking-platform
project_name: "预约平台"
resume_order: 2
aliases:
  - BookingPlatform
  - 预约项目
source_revision: "你的提交 SHA 或材料快照版本"
code_roots:
  - server/src
  - web/src
exclude_paths:
  - docs/archive
  - examples/generated
---

# 项目概要

这里只写当前确实存在的业务目标、架构与边界。
```

`project_id` 使用稳定的字母、数字、点、下划线或连字符；项目换目录、改显示名称或以 ZIP 重新导入时保留 ID。`resume_order` 表示简历序号，未知时省略或用 `null`，不要根据导入先后猜测。ID 或序号冲突会进入导入报告，不会静默吞并另一项目。

同一真实项目重新导入保留 ID，用新快照替换旧来源；另一项目不能借用同 ID。`source_revision` 说明源码版本，不证明个人贡献。界面默认“自动”，清晰说出项目名或别名最可靠；手动默认项目不能盖过显式项目切换。

清单可选，缺失时保持旧导入行为。front matter 支持受限的普通映射、列表与字符串等数据，不执行 YAML 标签、函数或复杂扩展。格式错误的资料仍可检索正文并给出报告；未识别元数据不自动当成确认事实。

## 按回答需要编写卡片

把实现、决策、困难、指标和职责分开写，减少长篇问答的重复模板。示例：

```yaml
---
schema_version: 1
project_id: booking-platform
doc_type: decision
truth_scope: implemented
status: confirmed
topics:
  - 名额准入
  - 一致性
code_refs:
  - path: server/src/BookingService.java
    symbol: BookingService#reserve
related_docs:
  - interview/implementation.md
  - interview/concurrency-test.md
---

# 名额准入的选型理由

## 当时约束

说明真实事务边界和业务条件。

## 选择与替代方案

写明采用了什么、为何采用、考虑但没有采用什么。

## 验证与当前限制

保留验证条件、结果与尚未覆盖的情况。
```

`doc_type` 可用 `overview`、`implementation`、`decision`、`challenge`、`incident`、`performance`、`ownership`、`collaboration`、`environment`、`process`、`limitation`、`theory`。`truth_scope` 可用 `implemented`、`test_only`、`planned`、`hypothetical`、`abandoned`、`general_knowledge`、`unverified`；`status` 为 `confirmed` 或 `draft`。英文是机器字段，界面仍显示中文。

范围与正文必须一致。给计划写 `implemented` 不会把“计划/如果”变成已实现。`confirmed` 只是你确认了材料，不是系统独立核实。旧 Markdown 与源码仍可导入，不猜测个人职责、生产经历或测量口径。

`code_refs` 使用项目内真实路径与现有符号。找不到、版本不匹配、同名或重载不明确时报告未解析/歧义，不产生假行号。`related_docs` 只恢复同项目资料，不跨项目引用，也不无限遍历。

## 真实性边界

| 回答内容 | 适合的资料 | 不足以证明它的材料 |
| --- | --- | --- |
| 实现与组件 | 对应版本源码、配置、实现卡片 | 一般原理、未来设计或另一项目代码 |
| 本人职责与协作 | 你核实的 ownership/collaboration | 仓库存在、团队交付、README 作者列表 |
| 决策与困难 | 明确经历，包含行动与验证 | 仅出现相关技术词的代码 |
| 性能与效果 | 环境、负载、单位、统计口径与结果 | 脱离环境的 QPS、演示数据或预期收益 |
| 生产事故与上线 | 已确认的实际记录 | “没有事故”、故障注入或公开 Mock 复现 |
| 假设与扩容 | 标记为 hypothetical 的条件推演 | 把“我会”改写成“我已经做过” |

环境与指标表应靠近，写清机器、组件版本、负载时长、并发、单位以及是否含排队或网络时间。测试指标留在 `test_only`，不自动升级为生产 SLA 或历史收益。

历史源码、公开复现、个人经历与未来设计各自标明版本。无法确认的职责、人数、事故与收益先留 `draft` / `unverified`，不让模型补事实。旧手工项目资料与 STAR 保留，没有项目标签的 STAR 不同时归给所有项目；长期使用建议迁为有项目身份的 Markdown。

## CAE 资料的建议用法

本次 CAE 源码 ZIP 可作为固定版本快照，`interview/` 卡片与源码用于回答实现。公开复现不证明过去的个人职责、团队人数、上线与事故；个人事实核对表用于你确认后补充资料。

160 题阅读版适合复习。核对报告、gold/验收 JSON、来源审计、给 Codex 的指令和 Agent Prompt 不应整包塞入默认索引，避免重复问法与材料指令影响检索评测。用 `exclude_paths` 排除目录内归档/评测材料，包外参考文件保持包外。

默认导入跳过依赖、构建产物、二进制与敏感文件名，目录和 ZIP 有路径及大小检查。`exclude_paths` 只能进一步缩小范围，不打开原本被排除的文件。报告中的跳过、截断、未解析引用和身份冲突需按实际材料核对。

## 验证基础检索

先明确项目问选型、实现位置、本人职责与测试环境，打开“参考依据/资料缺口”核对。没有资料时保留缺失，不把 README 当成所有问题答案。

离线、未准备模型或模型失败时基础检索可用。准备步骤见 [本地语义检索](local-semantic-search.md)，回归与基准见 [面试助手架构](interview-agent.md)。合成测试通过不能代替你在真实材料上核对回答。


事实 JSON、导入预览、合并/替换/回退与独立源码开关见[项目材料与连续追问](project-materials.md)。个人口述事实保存在本机用户层，公共仓库不收录最终个人资料。
