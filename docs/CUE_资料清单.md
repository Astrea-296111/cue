# CUE 资料清单

公开仓库包含应用源码、公开的项目源码快照和匿名测试。私人简历、两个完整 JD、个人事实与叙事成品位于本地 `.cue-private`，不会由 `git pull` 自动补齐，也不应上传公开 GitHub 或公开 workflow artifact。

## 已内置的公开源码

| 项目 ID | 项目 | 固定源码版本 |
| --- | --- | --- |
| `cae` | CAE 仿真任务平台 | `c50dd29d1b1981e299d2ce4821e0a1ef745aa48e` |
| `arclight` | Arclight 编程 Agent；源码包名 `mewcode` | `528704eb373f637830640b3fefcc5cbc95f23a78` |

快照位于 `materials/projects`，版本与逐文件摘要见 `materials/source-lock.json`，检索产物见 `materials/bundle.json` 和 `materials/navigation.json`。同一源码快照已经内置时无需再次下载、导入。源码更新必须同步 source-lock、导航、事实引用并重新编译验证，不能混用不同提交。

MewCode 是 Arclight 源码的历史命名，不是简历中的第三个项目。`general` 是独立的通用知识集合，不参与真实项目编号。个人资料声明 CAE 在前、Arclight 在后；事实项目保存 `resumeOrder`，源码目录的排列顺序不决定简历顺序。

## 本次本地个人成品

| 文件 | 内容与用途 | 是否需要应用导入 |
| --- | --- | --- |
| `.cue-private/delivery-v2/workspace.json` | v2 单文件工作区：全部事实、候选人结构、两个独立岗位、来源清单、合并日志及资料原文/摘要引用 | 只需导入此文件一次 |
| `.cue-private/delivery-v2/facts.json` | 相同 194 张卡的独立事实索引，供兼容的材料入口或排查使用 | 单文件导入后不用再导入 |
| `.cue-private/delivery-v2/manifest.json` | 成品 revision、来源摘要及数量 | 不用 |
| `.cue-private/delivery-v2/merge-log.json` | 稳定 ID 的新增、保留和修订日志 | 不用 |
| `.cue-private/delivery-v2/legacy-audit.json` | 旧资料逐卡审核及实际固定版本源码核查 | 不用，保留用于复查 |
| `.cue-private/delivery-v2/import-acceptance.json` | 实际本地导入、重启、重复导入和岗位切换验收记录 | 不用 |
| `.cue-private/baseline-original/workspace.json` | 冻结的原始 109 卡工作区 | 只供基线评测/回溯，不覆盖最终成品 |
| `.cue-private/delivery-v2/baseline-compatible-workspace.json` | 早期冻结的 v1 格式 64 卡转换，包含 24 张通用知识卡 | 保留转换记录；不作为严格同条件对照 |
| `.cue-private/results/fixtures/compatible-v1-workspace.json` | 严格的 v1 兼容 40 卡真实项目子集；旧、新应用使用相同文件和旧版源码索引 | 只供同资料子集对照评测 |
| `.cue-private/results/fixtures/compatible-v1-manifest.json` | 上述严格子集的 revision、排除数量和冻结源码版本 | 留作核对 |

最终索引共 **194 张卡**：保留旧资料 109 个稳定 ID，加入完整 64 组问答、12 条叙事主线与 9 项简历指标。按集合分为 CAE 85、Arclight 85、通用知识 24。旧 109 卡保留原版本，审核后正文保留 45 项、修订 64 项；修订项包括无来源团队人数、未给出的实验细分与未经证明的工具使用历史，不据此补造新经历。

严格对照子集的 revision 为 `7a09bf66ed78a5140f0277dc5fe9780b58e9bef75c3964f6c2d9c81b383d6d21`，源码索引固定为旧应用 `9898a05` 所含版本。它从 64 组问答中排除 24 张通用知识卡，因为旧 schema 没有独立知识集合，会把 `general` 当成第三个项目；12 条新增叙事及 v2 来源元数据也不在这个子集中。64 卡文件虽然格式可读，项目语义并不等价，不能据此宣称严格同条件。完整 194 卡能力另行报告，不能与补资料和改代码的收益混算。

194 张卡中有 39 张 `CODE/verified`，均实际读取固定版本来源并保存原文摘要；其余为用户声明、参考、叙事、未来设计或上游公开实验报告。叙事卡数量为 18，是新增 12 条场景与关联到同一主线的 6 个旧叙事 ID；不等于发生过 18 次真实事故。

编译前逐一核对原始任务清单的 **9 个附件** 的大小与 SHA-256。它们是资料来源数，不是候选人工作经历数，也不是实际重跑实验数。素材中的面经图片只提供追问方向；其中他人的 800 ms → 150 ms 不属于候选人指标。

## 导入、岗位切换与升级

在现有受保护窗口的设置页找到“个人资料工作区”，点击“导入个人资料文件…”，选择最终 `workspace.json`，检查预览并确认。成功后状态应显示 `cae`、`arclight`、194 张卡、9 个来源、资料 revision 和当前岗位。用“当前目标岗位”选择 `ai_supply_chain` 或 `java_security`；切换只调整 JD 和表达侧重点，不改事实。

也可保留命令行兼容入口：

```powershell
npm run prepare:personal -- --workspace "D:\Cue资料\workspace.json"
npm run start:personal
```

这会把经过校验的工作区写入本机 `.cue-private/workspace.json`。旧命令 `--resume … --facts … --jd …` 仍接受已经编译过的 v1 事实包；原始 `project_profile_seed.json` 是任务输入，不能当作应用的事实索引直接导入。非开发用户只需要单文件成品。

v1→v2 会补齐新字段并保留原来源范围。重复导入同一 revision 不产生新代次。升级按稳定 ID 合并，默认保留用户之后修改过的卡和资料字段，不覆盖模型、API 密钥等普通设置。提交前保存个人资料备份，材料服务另行保留上一代完整事实/源码快照。格式上限、范围映射和 API 详见 [personal-workspace-schema.md](personal-workspace-schema.md)。

## 指标与证据口径

九项简历指标保留原始样本量、并发单位、计时边界和质量限制，统一作为 `USER/source-claim`；本次源码核查不等于独立重跑原始实验。批次受理时间与 Solver 完成时间分开；恢复从条件就绪起算；工具初始上下文与全程累计 Token 分开；并行墙钟时间与总 Token 分开；解决率差值用百分点说明。

公开 CAE `docs/benchmark.md` 是固定版本的另一份本地实验报告，带 `LOCAL-BENCH` 标签和报告 hash；不能与简历指标拼成优化前后对照。读取报告只证明存在这份报告，不代表本次重跑。缺原始日志时可以给复现方案，不能生成假日志。

候选人信息、岗位要求和面试官会话状态分开。候选人主体明确为 `candidate`；普通问答上下文去除电话和邮箱。`REFERENCE-STORY` 是可以用于指定场景的叙事参考，`FUTURE` 是后续设计，均不证明已发生事故、已执行实验、已实现生产保证或已提交开源 PR。

资料导入的自动回归覆盖 4096 张卡完整分页、第 4097 张卡明确拒绝、来源摘要篡改、v1→v2、重启、重复导入、本地编辑保护与两岗位切换。真实模型回答质量另见真实评测报告；资料校验通过不替代模型验收。
