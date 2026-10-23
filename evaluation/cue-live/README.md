# 可公开的 live 评测样本

此目录是 live runner 的唯一资料白名单；不得自动扫描用户主目录、工作区其他仓库、真实简历或本机事实覆盖层。`approval.json` 固定列出获准发送给模型及随回答上传的输入文件与 SHA-256。它明确区分仓库已有公开技术事实与本任务新造的 CI 合成人物资料；没有授权公开任何用户的私人履历或那份 109 条事实卡。

`materials/facts.json` 的技术卡来自本仓库 `project-packs/index.json`，保留上游项目、commit、path 与 symbol。`synthetic-profile.md`、`profile.json` 及个人职责卡中的林舟、四人练习团队、个人实验经历均为虚构 CI 数据。`sources/*/samples` 是带显著标记的最小合成代码，不代表完整项目源码。两个 `interview/project.md` 指定稳定项目 ID 与简历顺序。

`cases.json` 固定 24 题，其中 smoke 六题按原顺序执行，覆盖同项目追问、切项目、通用技术、两种回答模式及 source off/ready-only/standard。每题的项目归属、概念、数字和证据 ID 由人直接依据样本编写；不得用被测 selector 的结果生成正确答案。`expectedFactIds` 记录期望相关材料以辅助审查；只有 `checks.requiredFactIds` 是阻断性的最小证据要求。要求来源的题还固定 `expectedSourcePaths`，至少实际发送其中一个相关文件的片段；同项目的随机片段不能代替。路径均相对对应项目源目录，不依赖动态 sourceId 或 selector 排名。

质量模块分别报告确定性契约/事实检查、必要内容覆盖与非阻断的语言观察。`passed` 仅表示硬契约；`qualityStatus` 分为 `failed`、`needs-review` 和 `passed-listed-checks`。概念组缺失会增加独立的待复核计数，不能把“好的”等任意非空回答显示为质量通过。概念表接受多种同义表述，不以完整参考答案作逐字匹配；未识别表述留给人工判断遗漏或有效改写，避免直接按词面失败。仅列明的、可检验的禁止陈述会阻断。未知的无依据陈述仍需人工审查；自动通过不等于已证明回答没有幻觉。没有调用未经校准的 LLM judge。mock、真实模型和图形界面/物理设备验收的结论分别报告。
