# 2026-10-26 公开资料版本

本目录是用户明确授权公开的问答、简历和项目资料。认证凭据仍不得写入文件。129张卡片为新编版本，不是丢失的旧194卡恢复件。

- `workspace.json`：可导入的v2工作区，包含独立岗位与资料来源。
- `facts.json`：129张事实/参考/方案卡。九项简历指标为USER/source-claim，并非本次独立重跑。
- `data/experiments.json`、`docs/`：九项复现实验设计；新场景是narrative_scenario，实验安排是proposed_design。
- `source-manifest.json`：附件原始字节的来源、大小和SHA-256。
- `migration.json`：与仓库旧事实包的ID差异。工作区包含显式替换声明；导入预览后替换所列项目事实，保留源码片段，并写本地回退备份。
- `inputs/original-facts-109.json`：原109卡审阅输入，未自动混入新版。旧194卡和丢失密钥对应的历史原回答标记为unavailable。

导入：打开设置 → 项目材料 → 导入个人资料工作区 → 选择本目录`workspace.json` → 检查替换预览 → 确认。重复导入相同revision不增卡。回退使用材料管理中的上一版本，并保留个人资料备份。

`manifest.json`是上传包的原始清单；新的工作区revision因显式迁移声明而变化。原附件及嵌入来源的hash保持原值。源码支持当前实现，不能证明历史团队人数、事故或实验已发生。
