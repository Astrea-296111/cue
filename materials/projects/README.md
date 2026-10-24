# 两个真实项目的源码索引输入

`arclight/` 与 `cae/` 保存从公开仓库固定 Git 提交复制的源码原文，路径与字节不改写。它们是检索数据，不是 CUE 要加载执行的子项目；无需在快照内安装 Python、Maven 或前端依赖。

| 项目 | 固定提交 | 原文快照文件 | 入索引文件 | 原文字节 |
| --- | --- | ---: | ---: | ---: |
| Arclight | `528704eb373f637830640b3fefcc5cbc95f23a78` | 133 | 132 | 614809 |
| CAE | `c50dd29d1b1981e299d2ce4821e0a1ef745aa48e` | 211 | 211 | 779203 |

逐文件 SHA-256、原 Git blob、仓库/提交、排除路径和原因都记录在 [`../source-lock.json`](../source-lock.json)。两个上游仓库当前均未提供 LICENSE 文件；快照没有补造许可。项目代码中的已有版权声明原样保留。

索引涵盖全部受支持的生产源码、数据库迁移、主要配置与架构/ADR文档。去掉上游测试和测试数据、demo 输入、原始验收 JSON、参考故事、锁文件、构建物、依赖、管理脚本、内置 skill 示例正文及敏感文件。源码中的空包标记仍保留，未达到原索引器 30 字符门槛的文件不进入索引。未复制 `.git`、`.env`、密钥或二进制产物。

`interview/project.md` 是 CUE 生成的身份元数据：保留 canonical ID、别名、原始 commit 和代码根；简历顺序依据本次真实简历设为 CAE 第一、Arclight 第二。它不根据源码猜测个人职责、团队人数或生产指标。

## 更新

在 CUE 根目录执行：

```sh
# 需要 Git 与已登录的 gh；先核对仓库公开性，再下载/刷新上游 main。
# 缺少工作副本时会在 --workspace 下克隆；存在本地修改时停止并保留。
node scripts/sync-project-sources.cjs --workspace /workspace --refresh

# 不联网，按 source-lock 已验证的固定 commit 重建；相同内容产生相同清单。
node scripts/sync-project-sources.cjs --workspace /workspace

# 用正式导入/切块逻辑编译，超限或截断明确失败。
npm run compile:materials
```

同步只更新这两个项目的生成文件和 `manifest.json` 的对应 `sources`，保留其他资料设置。检测到快照被手动修改时不会覆盖；移除的旧生成文件也仅在原摘要仍一致时删除。私人简历、JD 和事实包使用独立本地目录，不通过此同步脚本复制。

本次正式扫描得到 2453 个源码片段，未触发 1800 文件/7000 片段/8MiB 每项目上限，也未触发 16MiB 构建原文上限。具体文件与片段数应以每次构建结果为准，不在回答按键路径重新扫描源码。
