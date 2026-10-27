# CUE 问答导入格式

## JSON：cue-qa/v1

文件为 UTF-8，最大 16MiB、16 个项目、4096 条卡片。`projects` 定义项目 ID、名称、别名；通用知识可以标记 `kind: "knowledge"`。`items` 必填 `id/projectId/question/answerShort`，完整示例见 [模板](examples/cue-qa.template.json)。ID 稳定，重复导入按 ID 更新，不能用相同 ID 改换项目归属。单个文件重复 ID 会报带位置的错误，不发布部分内容。

第一次制作可复制 [简易 JSON 示例](examples/cue-qa-quickstart.json)，填写自己的问题、等价问法和答案，另存为 UTF-8 的 `.json` 文件。在设置的“项目问答库”点击“导入 JSON…”，预览后确认，再用“试问”检查是否原文命中。`aliases` 应添加意思和条件相同的问法；系统会保守处理不完整的多问、相反条件和不同数字，不能保证所有相似句子都直达。涉及个人项目时使用项目 ID 并填写对应项目资料，不要把示例的通用知识当作本人经历。

| 字段 | 作用 |
| --- | --- |
| `question`、`aliases` | 标准问法及等价问法，保持否定、数值与条件 |
| `answerShort` | 原文短答，最多 12000 字符；超过 260 字在预览提示编辑，展示时不裁剪 |
| `answerDetailed` | 独立详答，最多 40000 字符，保留段落与换行 |
| `projectId/topic/keywords` | 项目隔离与检索特征 |
| `boundaries` | 直达时附在答案正文；生成时也作为资料边界传入 |
| `mustCover` | 问题必须包含的词项，严格门槛；不要填必然不会出现在同义问法中的词 |
| `excludeIntents` | 当前问题包含该排除项时回退模型 |
| `applicableVersion` | 答案适用版本；同题冲突版本不会互相覆盖后直接返回 |
| `enabled` | 默认 true；false 不参与直达与问答资料召回 |
| `delivery` | `prefer_verbatim`（默认）或 `evidence_only`（仅作模型资料） |
| `sourceType` | `user_claim`（默认）、`proposed_design`、`general_knowledge` |

`user_claim` 编译为 USER/source-claim/resume_claim；`proposed_design` 为 FUTURE/planned/proposed_design；`general_knowledge` 为 REFERENCE/unverified/general_knowledge。这个入口不能把用户材料升级为源码核实或历史实验实证。空白答案、非法字段/路径、大小超限、错误来源 hash 均不发布。

## 与 facts v2 的关系

`cue-qa/v1` 只是导入入口。材料唯一事实源仍是 `facts.schemaVersion:2`，通过现有 ProjectMaterialService 的 prepare/commit/generation 机制发布。问题映射 `questions[]`，短答映射 `answerShort/text`，详答与问答策略进入经过校验的 `qa` 字段；完整原文件在 `sourceDocuments`，来源 hash 由实际 UTF-8 字节计算。没有向 workspace 根对象塞入额外键。

已有 v1/v2 资料继续可读。具有 `questions/answerShort` 的 v2 条目可直接建立问答索引，无须重导；v1 沿原迁移规则编译。启停、编辑、导出重导与重启会保留问答策略。导出轻量 JSON 会把源码验证卡转换成用户声明格式；需要保留源码 commit、verification、story 等全部审计字段时，请使用已有事实包 JSON 导出/编辑入口。

索引随材料 generation 重新准备，按每次请求冻结 revision，不持久缓存旧答案。没有按键时下载语义模型、建索引或调用模型润色的步骤。

## 严格 Markdown

只接受 [模板](examples/cue-qa.template.md) 的结构：首行 `# CUE-QA/v1`，每项 `## ID: <稳定 ID>`，头部 `Project: id | 项目名`、`Q:`，可选 `Aliases:` JSON 数组和 `Meta:` JSON 对象。`### A` 后是短答；可选 `### Detailed` 后是详答。元数据使用 JSON 的同名字段。正文内部段落保留，格式分隔符附近末尾空行按模板规范化；原 Markdown 字节另存并计算 hash。

不会把普通长文、Word/PDF 任意切成问答，也不会执行正文夹带的指令。普通资料仍走已有材料导入；需要准确直达的条目，请先按模板整理并预览。
