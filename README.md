# CUE 可下载交付资料（2026-10-26）

本分支专门保存交付文件；应用代码仍在 main。按用户本次明确要求发布。

- [可读 Actions 日志、索引与汇总 ZIP（约7MB）](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-readable-2026-10-26.zip)
- [原始任务附件与109卡事实文件 ZIP（约1.2MB）](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-source-materials-2026-10-26.zip)
- [网页查看203次运行的完整日志](https://github.com/Astrea-296111/cue/tree/main/evaluation/exports/2026-10-26)
- [CUE当前源码 ZIP](https://github.com/Astrea-296111/cue/archive/refs/heads/main.zip)
- [SHA256SUMS.txt](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/SHA256SUMS.txt)

可读包包含导出时全部203次Actions的完整步骤日志、身份、产物目录及可恢复的公开汇总。未包含后续发布本资料所触发的CI运行。原附件已从会话附件重新恢复。

旧云环境的133MB包、194卡最终工作区、完整模型回答/裁判明文及 local-key.json 没有随环境重建保留。当前完整回答明文数为0；日志和汇总不能替代完整回答。本次没有重跑付费推理。此资料不是旧133MB包。

## 加密原件分卷

45份原始加密报告另保存为ZIP分卷，完整ZIP约199MiB。没有原AES密钥仍不能解密；这些分卷供恢复原密钥后使用。以下每个文件32MiB或更小：

- [cue-actions-encrypted-originals-2026-10-26.zip.001](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.001)
- [cue-actions-encrypted-originals-2026-10-26.zip.002](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.002)
- [cue-actions-encrypted-originals-2026-10-26.zip.003](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.003)
- [cue-actions-encrypted-originals-2026-10-26.zip.004](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.004)
- [cue-actions-encrypted-originals-2026-10-26.zip.005](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.005)
- [cue-actions-encrypted-originals-2026-10-26.zip.006](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.006)
- [cue-actions-encrypted-originals-2026-10-26.zip.007](https://raw.githubusercontent.com/Astrea-296111/cue/cue-review-data-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip.007)

下载全部分卷到同一目录后，在该目录运行：

```python
from pathlib import Path
parts = sorted(Path('.').glob('cue-actions-encrypted-originals-2026-10-26.zip.[0-9][0-9][0-9]'))
assert len(parts) == 7
with open('cue-actions-encrypted-originals-2026-10-26.zip', 'wb') as target:
    for part in parts:
        target.write(part.read_bytes())
```

SHA256SUMS.txt 同时给出每个分卷和重组后ZIP的摘要。这里没有API密钥、runner私钥或本地AES解密密钥。

后续评测加 `--publish-readable`，会在Actions产物的readable目录保存凭据已脱敏的完整/部分报告（30天），可用主分支 scripts/export-actions-review.py 导出长期留档。
