# CUE 的 GitHub 下载与 GPT 阅读入口

2026-10-26，按用户本轮明确要求，将能恢复的交付资料发布到本仓库与 GitHub Releases，供直接下载和外部工具读取。

## 直接下载

- [全部可读 Actions 日志、运行索引和汇总 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-actions-readable-2026-10-26.zip)
- [原始任务附件、简历/JD素材及原109卡事实文件 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-source-materials-2026-10-26.zip)
- [45份原始加密评测报告 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip)
- [SHA-256 校验清单](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/SHA256SUMS.txt)

网页阅读入口：[203次 Actions 的日志及索引](../evaluation/exports/2026-10-26/README.md)、[最终机器汇总](../evaluation/final-summary-2026-10-26.json)、[评测报告](CUE_真实评测报告.md)。Release 还提供对应源码的 Source code ZIP。

## 旧本地包的恢复限制

原来仅保存在旧云环境的133MB交付包、最终194卡工作区、完整问答/裁判明文及本地解密密钥没有随环境重建保留，本次未能恢复。上述下载包提供203次运行的完整步骤日志和45份加密原件，**不包含旧完整回答的明文，也不冒充原来的133MB包**。

原始附件、109卡来源文件和之前已提交的评测汇总已恢复。它们不是原来逐卡修订、核查后的194卡成品。已安装应用里的个人资料独立保存在用户电脑，更新仓库无需重新导入原始 seed。没有原 local-key.json，就无法从现有密文恢复旧回答；本次未重跑付费评测。

## 后续保存可读的完整回答

在原有评测命令末尾添加：

```sh
--publish-readable
```

也可以在 Actions 手动运行时勾选 `publish_readable_reports`。这会把凭据已脱敏的完整报告放在产物的 `readable/report.json` 和 `readable/report.md` 中，并保留失败/部分报告，产物保留30天。原输入加密和密钥清理继续生效。

导出可读日志、报告和产物索引：

```sh
python scripts/export-actions-review.py --output-dir .cue-private/actions-review
# 如还有本地已解密报告：
python scripts/export-actions-review.py --output-dir .cue-private/actions-review --decrypted-results .cue-private/results
```

导出器不运行模型、不重新付费推理，只读取已有结果；不复制 local-key.json 或解密私钥。以后将这份导出上传 Release，即可给 GPT 一个可访问的固定链接。
