# 个人工作区 v2

这是公开的格式说明；完整个人资料仅由用户在本地导入，不随源码或公开构建分发。

`workspace.json` 是一次导入的入口，根字段为 `schemaVersion: 2`、`facts`、`profile`、可选 `sourceManifest` / `mergeLog` 和自动计算的 `revision`。`revision` 是除自身以外有效正文的规范化 SHA-256。v1 的 `schemaVersion: 1`、`facts`、`profile.resumeText/jobDescription` 仍然可用。

## 事实索引

`facts.schemaVersion: 2` 最多接受 16 个项目、4096 张卡、16 MiB JSON，单卡正文最多 12000 字符。超过上限会明确失败。`ProjectFactPacks.pageCards({projectId, offset, limit})` 分页读取全部卡，单页最多 250 张；导入不截断卡片。前台检索只选择少量相关卡，索引大小与 Prompt 大小分别控制。

每张卡包含：

- 身份：`cardId`、`projectId`、`path`、`topic`、`docType`。
- 回答：`questions`、`answerShort`、`deepPoints`、`facts: [{key,value,...}]`、`text`、`keywords`、`related`、`followups`。
- 证据：`provenance`、`status`、`truthScope`、`implementation`、`applicableVersion`、`sources`。
- 限定：`boundaries`、`cannotSay`。旧版本可保存在 `history`，迁移前的范围标签保存在 `migration`。

来源至少包含安全相对 `path`、`symbol`，以及真实 40 位 `commit` 或原文 64 位 `contentSha256`。`sourceDocuments` 按来源路径保存 UTF-8 原文，存在嵌入原文时必须与引用 hash 相符。二进制附件用 `artifactSha256` 和来源清单保留原始摘要，简历供模型使用的文本另行去除联系方式。

| 范围 | 允许的解释 |
| --- | --- |
| `USER / source-claim / resume_claim` | 用户简历或自述，不代表独立重现实验 |
| `CODE / verified / current_public_repo` | 实际读取固定提交源码；必须有 `verification.method: source-review`、`checkedSources` 和对应源码正文/hash |
| `REFERENCE-STORY / narrative_scenario` | 合成叙事；不能标 verified，不能证明真实事故或实验发生 |
| `LOCAL-BENCH` | 必须有 `experiment.reportPath/contentSha256`；上游公开报告与本次重跑分别标注 |
| `FUTURE / proposed_design` | 建议与未来设计，不属于当前实现 |
| `REFERENCE / general_knowledge` | 通用知识参考，不反写为候选人工作经历 |

叙事还应包含 `story.background/trigger/investigation/attempts/solution/tradeoff/validationMethod/remainingIssues`。代码位置、简历指标和叙事字段不能互相替代。

`projects[].kind: knowledge` 的资料不进入真实项目目录、简历序号和项目源码路由；由 `selectKnowledge(question, {jobProfileId,maxCards})` 独立选择。真实项目可声明 `resumeOrder`，普通项目检索与资料服务目录均保留该序号。

## 候选人与两个岗位

`profile` 字段为 `resumeText`、当前 `jobDescription`、`candidateProfile`、`jobProfiles` 和 `activeJobProfileId`。候选人主体必须是 `candidateProfile.subjectRole: candidate`，不能保存面试官履历。联系方式不进入普通模型上下文。

`jobProfiles` 固定包含 `ai_supply_chain` 和 `java_security` 两个独立对象。每个对象使用 `id/label/jobDescription/priorityTopics/source`，可保存 `selfIntroductions.seconds30/seconds60`。岗位切换保存当前 JD 的本地编辑，然后选择另一份 JD，只调整回答侧重点，不发布或修改事实材料。

## 应用 API 与更新

主进程使用：

```js
const personal = require('./src/personal-workspace');
const preview = await personal.preparePersonalWorkspaceImport({
  filePath, materialService, store
});
const state = await personal.commitPersonalWorkspaceImport({
  token: preview.token, baseGeneration: preview.baseGeneration,
  materialService, store
});
personal.getPersonalWorkspaceState({ materialService, store });
personal.selectJobProfile({ jobProfileId, materialService, store });
personal.getSelectedJobProfileContext({ store });
```

预览不发布材料；提交检查预览所属服务、有效期与材料代次。提交前在 Electron `userData/personal-workspace-backups` 保存简历、岗位和个人导入元数据备份，材料原版本由统一材料服务保存。

重复 revision 不产生新材料代次，不覆盖后续编辑。v2 更新按稳定卡片 ID 合并：未编辑卡可更新，本地修改卡默认保留；设置字段亦逐项比较导入基线。v1 升级时新增的候选人结构与两个岗位会补齐，本地已经填写的新增字段保留。普通 provider、API 密钥和其他应用设置不由个人资料导入覆盖。

兼容命令：

```sh
npm run prepare:personal -- --workspace /private/workspace.json --directory .cue-private
npm run start:personal
```

离线附件编译接受 `--task-directory`，可选 `--baseline` 和实际源码核查的 `--audit`。编译器首先逐一校验附件 manifest 的大小和 hash，再生成 `workspace.json`、`facts.json`、`manifest.json` 和 `merge-log.json`；它不会伪造 Git SHA、实验日志或核查结果。产物含私人原文，目录应留在 Git 忽略范围内。
