# 随 CUE 发布的真实资料

此目录供维护者把项目事实、精选源码快照和简历编译进应用。安装或升级 CUE 后会自动安装新材料版本，无需桌面用户手动导入 JSON。当前清单已包含 CAE 与 Arclight 的真实公开源码，来源见 `source-lock.json`；现有 `project-packs/` 的公开技术卡仍照常加载。CI 的合成人物资料留在 `evaluation/`，不会打包给用户。用户此次提供的简历、JD、109 卡事实只在 Git 忽略的 `.cue-private/` 中，个人启动和加密评测见[操作说明](../docs/project-depth-optimization.md)。

建议目录：

```text
materials/
  facts/projects.json           # 已核验、符合 project-fact-packs schema v1 的事实卡
  projects/cae/interview/project.md
  projects/cae/src/...          # 精选源码，不要复制 node_modules/.git/密钥
  projects/arclight/...
  profile/resume.md             # 已同意随应用发布的简历正文
  manifest.json                # 逐文件 sha256 分发白名单
  bundle.json                  # 构建生成并随安装包发布的数据
```

新资料由维护者核验并转为事实卡；普通 Markdown/PDF/DOCX 也可以列入项目源码快照，使用 CUE 同一套文档解析和检索。不得把参考故事直接标为个人经历。目录或文件存在并不代表允许发布：只有白名单明确列出的内容会进入 bundle。仓库公开时，提交资料和完整评测回答均可能公开；私人简历须先取得资料所有者的分发同意。运行时 API 密钥和本地 JD 不得加入此目录。

清单示例（摘要需替换为实际 SHA-256）：

```json
{
  "schemaVersion": 1,
  "approvedForDistribution": true,
  "facts": [{"path":"facts/projects.json","sha256":"<64位摘要>"}],
  "sources": [{
    "root":"projects/cae", "projectId":"cae",
    "files":[
      {"path":"interview/project.md","sha256":"<64位摘要>"},
      {"path":"src/recovery.js","sha256":"<64位摘要>"}
    ]
  }],
  "profile":{"path":"profile/resume.md","sha256":"<64位摘要>"}
}
```

源码身份清单 `interview/project.md` 使用现有 CUE 格式：

```markdown
---
schema_version: 1
project_id: cae
project_name: CAE
aliases: [cae-job-platform]
source_revision: <已核验的源码提交>
---
CAE 项目的源码快照说明。
```

运行 `node scripts/bundle-project-materials.cjs` 后提交原文、清单和 `bundle.json`。构建钩子也会重新编译；原文变动却未更新摘要、路径越界、符号链接、敏感源码路径、无效项目身份或截断会阻止构建。相同内容生成相同 revision。仅 `bundle.json` 随应用发布，白名单原文不额外复制到安装包。

启动安装走统一材料服务的预览/提交和持久化校验，事实与源码在同一代发布。相同 revision 不重复安装；新 revision 合并资料，保留无关本地项目和设置。用户改过的同 ID 事实或源码会保留；删除打包清单条目不会删除用户已安装的材料。简历首次仅填充空白资料，升级仅更新仍等于上次发放正文的简历，本地修改会保留。JD 始终保持本地值。
