# Actions 可读资料快照（2026-10-26）

本目录保存导出时仓库全部 **203 次运行、203 份完整步骤日志**，以及运行身份、产物目录和可恢复的公开评测汇总。网页可以直接打开日志，GPT 可按索引读取。后续本次发布触发的 CI 不属于这份冻结快照。

## 下载

- [可读日志、汇总与源码位置索引 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-actions-readable-2026-10-26.zip)
- [原始附件与原109卡事实文件 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-source-materials-2026-10-26.zip)
- [45份加密评测原件 ZIP](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/cue-actions-encrypted-originals-2026-10-26.zip)
- [文件大小与 SHA-256](https://github.com/Astrea-296111/cue/releases/download/cue-review-2026-10-26/SHA256SUMS.txt)

## 明文恢复范围

旧云环境的本地 133MB 包、194卡最终导入工作区、完整问题/回答/裁判明文及解密用的 local-key.json 没有跨环境保留。这份快照没有恢复它们，不能用步骤日志或汇总替代完整回答。现有明文报告数为 **0**。原评测汇总和来源复核统计仍保存在 [最终机器汇总](../../final-summary-2026-10-26.json) 及 [评测报告](../../../docs/CUE_真实评测报告.md)。

45份原始密文已另存 Release；保留原密钥时可以恢复，没有原密钥不能重新解密。本次没有重跑付费推理，也没有从摘要拼造原回答。原始附件和109卡来源文件已从会话附件重新取得，未冒充原来审核后的194卡成品。Windows安装包等二进制列于各运行 artifacts.json，未复制进此文本快照。

## 后续评测

加 `--publish-readable` 运行 `npm run eval:remote -- ...`，或在 Actions 手动运行时勾选 `publish_readable_reports`，会在评测 artifact 的 `readable/` 中保留已去除API凭据的完整 JSON/Markdown（含失败/部分快照），保存30天。输入和原始加密报告继续保留原协议。之后运行：

```sh
python scripts/export-actions-review.py --output-dir .cue-private/actions-review
```

如本地还有已解密报告，可另加 `--decrypted-results .cue-private/results`。导出器只复制明确的报告文件，不复制 local-key.json、解密私钥或配置。未来需要长期公开留档时，将导出文件上传仓库或 Release，避免只留下云端路径。

## 给 GPT 的读取顺序

先读 run-index.json 和最终汇总，再按运行打开 logs.txt、summary.json；有 readable/report.json 时再逐条检查实际请求、回答、失败和裁判。日志中看到模型接口完成，不等于回答正确；加密文件的存在不等于明文可读。

## 运行列表

| Run | 工作流 | 结论 | 日志 | 公开状态 |
| --- | --- | --- | --- | --- |
| [40251559689](https://github.com/Astrea-296111/cue/actions/runs/40251559689) | CI | success | [全部步骤](runs/40251559689/logs.txt) | 见运行元数据 |
| [40251559642](https://github.com/Astrea-296111/cue/actions/runs/40251559642) | LLM live evaluation | skipped | [全部步骤](runs/40251559642/logs.txt) | 见运行元数据 |
| [40251559607](https://github.com/Astrea-296111/cue/actions/runs/40251559607) | Offline end-to-end | success | [全部步骤](runs/40251559607/logs.txt) | 见运行元数据 |
| [40251395846](https://github.com/Astrea-296111/cue/actions/runs/40251395846) | CI | success | [全部步骤](runs/40251395846/logs.txt) | 见运行元数据 |
| [40251395830](https://github.com/Astrea-296111/cue/actions/runs/40251395830) | Offline end-to-end | success | [全部步骤](runs/40251395830/logs.txt) | 见运行元数据 |
| [40251389353](https://github.com/Astrea-296111/cue/actions/runs/40251389353) | Offline end-to-end | success | [全部步骤](runs/40251389353/logs.txt) | 见运行元数据 |
| [40251389306](https://github.com/Astrea-296111/cue/actions/runs/40251389306) | CI | success | [全部步骤](runs/40251389306/logs.txt) | 见运行元数据 |
| [40250999061](https://github.com/Astrea-296111/cue/actions/runs/40250999061) | Private project evaluation cue-1792975604925-35b94673ae-s0 | failure | [全部步骤](runs/40250999061/logs.txt) | [summary.json](runs/40250999061/summary.json) |
| [40250991390](https://github.com/Astrea-296111/cue/actions/runs/40250991390) | LLM live evaluation | skipped | [全部步骤](runs/40250991390/logs.txt) | 见运行元数据 |
| [40250991350](https://github.com/Astrea-296111/cue/actions/runs/40250991350) | Offline end-to-end | success | [全部步骤](runs/40250991350/logs.txt) | 见运行元数据 |
| [40250991321](https://github.com/Astrea-296111/cue/actions/runs/40250991321) | CI | success | [全部步骤](runs/40250991321/logs.txt) | 见运行元数据 |
| [40250811188](https://github.com/Astrea-296111/cue/actions/runs/40250811188) | CI | success | [全部步骤](runs/40250811188/logs.txt) | 见运行元数据 |
| [40250811185](https://github.com/Astrea-296111/cue/actions/runs/40250811185) | Offline end-to-end | success | [全部步骤](runs/40250811185/logs.txt) | 见运行元数据 |
| [40250805193](https://github.com/Astrea-296111/cue/actions/runs/40250805193) | CI | success | [全部步骤](runs/40250805193/logs.txt) | 见运行元数据 |
| [40250805161](https://github.com/Astrea-296111/cue/actions/runs/40250805161) | Offline end-to-end | success | [全部步骤](runs/40250805161/logs.txt) | 见运行元数据 |
| [40249802945](https://github.com/Astrea-296111/cue/actions/runs/40249802945) | Private project evaluation cue-1792974701918-8a71601904-s0 | failure | [全部步骤](runs/40249802945/logs.txt) | [summary.json](runs/40249802945/summary.json) |
| [40249639388](https://github.com/Astrea-296111/cue/actions/runs/40249639388) | LLM live evaluation | skipped | [全部步骤](runs/40249639388/logs.txt) | 见运行元数据 |
| [40249639369](https://github.com/Astrea-296111/cue/actions/runs/40249639369) | CI | success | [全部步骤](runs/40249639369/logs.txt) | 见运行元数据 |
| [40249639368](https://github.com/Astrea-296111/cue/actions/runs/40249639368) | Offline end-to-end | success | [全部步骤](runs/40249639368/logs.txt) | 见运行元数据 |
| [40249336020](https://github.com/Astrea-296111/cue/actions/runs/40249336020) | CI | success | [全部步骤](runs/40249336020/logs.txt) | 见运行元数据 |
| [40249335943](https://github.com/Astrea-296111/cue/actions/runs/40249335943) | Offline end-to-end | success | [全部步骤](runs/40249335943/logs.txt) | 见运行元数据 |
| [40249329674](https://github.com/Astrea-296111/cue/actions/runs/40249329674) | CI | success | [全部步骤](runs/40249329674/logs.txt) | 见运行元数据 |
| [40249329615](https://github.com/Astrea-296111/cue/actions/runs/40249329615) | Offline end-to-end | success | [全部步骤](runs/40249329615/logs.txt) | 见运行元数据 |
| [40221383458](https://github.com/Astrea-296111/cue/actions/runs/40221383458) | Private project evaluation cue-1792952883855-ea32fac56d-s0 | failure | [全部步骤](runs/40221383458/logs.txt) | [summary.json](runs/40221383458/summary.json) |
| [40221381837](https://github.com/Astrea-296111/cue/actions/runs/40221381837) | Private project evaluation cue-1792952882425-fc9fdc458f-s0 | failure | [全部步骤](runs/40221381837/logs.txt) | [summary.json](runs/40221381837/summary.json) |
| [40221341279](https://github.com/Astrea-296111/cue/actions/runs/40221341279) | LLM live evaluation | skipped | [全部步骤](runs/40221341279/logs.txt) | 见运行元数据 |
| [40221341274](https://github.com/Astrea-296111/cue/actions/runs/40221341274) | CI | success | [全部步骤](runs/40221341274/logs.txt) | 见运行元数据 |
| [40221341267](https://github.com/Astrea-296111/cue/actions/runs/40221341267) | Offline end-to-end | success | [全部步骤](runs/40221341267/logs.txt) | 见运行元数据 |
| [40221151548](https://github.com/Astrea-296111/cue/actions/runs/40221151548) | Offline end-to-end | success | [全部步骤](runs/40221151548/logs.txt) | 见运行元数据 |
| [40221151533](https://github.com/Astrea-296111/cue/actions/runs/40221151533) | CI | success | [全部步骤](runs/40221151533/logs.txt) | 见运行元数据 |
| [40221092688](https://github.com/Astrea-296111/cue/actions/runs/40221092688) | Offline end-to-end | success | [全部步骤](runs/40221092688/logs.txt) | 见运行元数据 |
| [40221092659](https://github.com/Astrea-296111/cue/actions/runs/40221092659) | CI | success | [全部步骤](runs/40221092659/logs.txt) | 见运行元数据 |
| [40218307488](https://github.com/Astrea-296111/cue/actions/runs/40218307488) | Offline end-to-end | success | [全部步骤](runs/40218307488/logs.txt) | 见运行元数据 |
| [40218307455](https://github.com/Astrea-296111/cue/actions/runs/40218307455) | CI | success | [全部步骤](runs/40218307455/logs.txt) | 见运行元数据 |
| [40217941430](https://github.com/Astrea-296111/cue/actions/runs/40217941430) | Private project evaluation cue-1792950283892-20eac15403-s0 | failure | [全部步骤](runs/40217941430/logs.txt) | [summary.json](runs/40217941430/summary.json) |
| [40217330833](https://github.com/Astrea-296111/cue/actions/runs/40217330833) | Private project evaluation cue-1792949821931-0de770bf2f-s0 | failure | [全部步骤](runs/40217330833/logs.txt) | [summary.json](runs/40217330833/summary.json) |
| [40217306555](https://github.com/Astrea-296111/cue/actions/runs/40217306555) | Private project evaluation cue-1792949803953-8026f4b194-s0 | failure | [全部步骤](runs/40217306555/logs.txt) | [summary.json](runs/40217306555/summary.json) |
| [40217298347](https://github.com/Astrea-296111/cue/actions/runs/40217298347) | LLM live evaluation | skipped | [全部步骤](runs/40217298347/logs.txt) | 见运行元数据 |
| [40217298306](https://github.com/Astrea-296111/cue/actions/runs/40217298306) | Offline end-to-end | success | [全部步骤](runs/40217298306/logs.txt) | 见运行元数据 |
| [40217298268](https://github.com/Astrea-296111/cue/actions/runs/40217298268) | CI | success | [全部步骤](runs/40217298268/logs.txt) | 见运行元数据 |
| [40217148449](https://github.com/Astrea-296111/cue/actions/runs/40217148449) | Offline end-to-end | success | [全部步骤](runs/40217148449/logs.txt) | 见运行元数据 |
| [40217148438](https://github.com/Astrea-296111/cue/actions/runs/40217148438) | CI | success | [全部步骤](runs/40217148438/logs.txt) | 见运行元数据 |
| [40217079156](https://github.com/Astrea-296111/cue/actions/runs/40217079156) | CI | success | [全部步骤](runs/40217079156/logs.txt) | 见运行元数据 |
| [40217079146](https://github.com/Astrea-296111/cue/actions/runs/40217079146) | Offline end-to-end | success | [全部步骤](runs/40217079146/logs.txt) | 见运行元数据 |
| [40215751361](https://github.com/Astrea-296111/cue/actions/runs/40215751361) | Private project evaluation cue-1792948648446-e18c834a25-s0 | failure | [全部步骤](runs/40215751361/logs.txt) | [summary.json](runs/40215751361/summary.json) |
| [40199120254](https://github.com/Astrea-296111/cue/actions/runs/40199120254) | Private project evaluation cue-1792935804096-20d45d37be-s7 | failure | [全部步骤](runs/40199120254/logs.txt) | [summary.json](runs/40199120254/summary.json) |
| [40199091905](https://github.com/Astrea-296111/cue/actions/runs/40199091905) | Private project evaluation cue-1792935804096-20d45d37be-s6 | failure | [全部步骤](runs/40199091905/logs.txt) | [summary.json](runs/40199091905/summary.json) |
| [40199062093](https://github.com/Astrea-296111/cue/actions/runs/40199062093) | Private project evaluation cue-1792935804096-20d45d37be-s5 | failure | [全部步骤](runs/40199062093/logs.txt) | [summary.json](runs/40199062093/summary.json) |
| [40199031939](https://github.com/Astrea-296111/cue/actions/runs/40199031939) | Private project evaluation cue-1792935804096-20d45d37be-s4 | failure | [全部步骤](runs/40199031939/logs.txt) | [summary.json](runs/40199031939/summary.json) |
| [40199004478](https://github.com/Astrea-296111/cue/actions/runs/40199004478) | Private project evaluation cue-1792935804096-20d45d37be-s3 | failure | [全部步骤](runs/40199004478/logs.txt) | [summary.json](runs/40199004478/summary.json) |
| [40198983978](https://github.com/Astrea-296111/cue/actions/runs/40198983978) | Private project evaluation cue-1792935813105-7ce31fe0ec-s2 | failure | [全部步骤](runs/40198983978/logs.txt) | [summary.json](runs/40198983978/summary.json) |
| [40198973765](https://github.com/Astrea-296111/cue/actions/runs/40198973765) | Private project evaluation cue-1792935804096-20d45d37be-s2 | failure | [全部步骤](runs/40198973765/logs.txt) | [summary.json](runs/40198973765/summary.json) |
| [40198967545](https://github.com/Astrea-296111/cue/actions/runs/40198967545) | Private project evaluation cue-1792935843200-49899a6d0e-s0 | failure | [全部步骤](runs/40198967545/logs.txt) | [summary.json](runs/40198967545/summary.json) |
| [40198956402](https://github.com/Astrea-296111/cue/actions/runs/40198956402) | Private project evaluation cue-1792935813105-7ce31fe0ec-s1 | failure | [全部步骤](runs/40198956402/logs.txt) | [summary.json](runs/40198956402/summary.json) |
| [40198946320](https://github.com/Astrea-296111/cue/actions/runs/40198946320) | Private project evaluation cue-1792935804096-20d45d37be-s1 | failure | [全部步骤](runs/40198946320/logs.txt) | [summary.json](runs/40198946320/summary.json) |
| [40198933019](https://github.com/Astrea-296111/cue/actions/runs/40198933019) | Private project evaluation cue-1792935815779-308e2adba1-s0 | failure | [全部步骤](runs/40198933019/logs.txt) | [summary.json](runs/40198933019/summary.json) |
| [40198931734](https://github.com/Astrea-296111/cue/actions/runs/40198931734) | Private project evaluation cue-1792935814459-b2d9d0699f-s0 | failure | [全部步骤](runs/40198931734/logs.txt) | [summary.json](runs/40198931734/summary.json) |
| [40198929844](https://github.com/Astrea-296111/cue/actions/runs/40198929844) | Private project evaluation cue-1792935813105-7ce31fe0ec-s0 | failure | [全部步骤](runs/40198929844/logs.txt) | [summary.json](runs/40198929844/summary.json) |
| [40198920631](https://github.com/Astrea-296111/cue/actions/runs/40198920631) | Private project evaluation cue-1792935804096-20d45d37be-s0 | failure | [全部步骤](runs/40198920631/logs.txt) | [summary.json](runs/40198920631/summary.json) |
| [40198917824](https://github.com/Astrea-296111/cue/actions/runs/40198917824) | Private project evaluation cue-1792935802361-f20d2ad1e3-s0 | failure | [全部步骤](runs/40198917824/logs.txt) | [summary.json](runs/40198917824/summary.json) |
| [40198911703](https://github.com/Astrea-296111/cue/actions/runs/40198911703) | LLM live evaluation | skipped | [全部步骤](runs/40198911703/logs.txt) | 见运行元数据 |
| [40198911695](https://github.com/Astrea-296111/cue/actions/runs/40198911695) | Offline end-to-end | success | [全部步骤](runs/40198911695/logs.txt) | 见运行元数据 |
| [40198911689](https://github.com/Astrea-296111/cue/actions/runs/40198911689) | CI | success | [全部步骤](runs/40198911689/logs.txt) | 见运行元数据 |
| [40198886013](https://github.com/Astrea-296111/cue/actions/runs/40198886013) | Private project evaluation cue-1792935776869-f90097e32f-s0 | failure | [全部步骤](runs/40198886013/logs.txt) | [summary.json](runs/40198886013/summary.json) |
| [40198724034](https://github.com/Astrea-296111/cue/actions/runs/40198724034) | Offline end-to-end | success | [全部步骤](runs/40198724034/logs.txt) | 见运行元数据 |
| [40198723984](https://github.com/Astrea-296111/cue/actions/runs/40198723984) | CI | success | [全部步骤](runs/40198723984/logs.txt) | 见运行元数据 |
| [40198674688](https://github.com/Astrea-296111/cue/actions/runs/40198674688) | CI | success | [全部步骤](runs/40198674688/logs.txt) | 见运行元数据 |
| [40198674650](https://github.com/Astrea-296111/cue/actions/runs/40198674650) | Offline end-to-end | success | [全部步骤](runs/40198674650/logs.txt) | 见运行元数据 |
| [40198329324](https://github.com/Astrea-296111/cue/actions/runs/40198329324) | Private project evaluation cue-1792935344356-496290af64-s0 | failure | [全部步骤](runs/40198329324/logs.txt) | [summary.json](runs/40198329324/summary.json) |
| [40198309595](https://github.com/Astrea-296111/cue/actions/runs/40198309595) | Private project evaluation cue-1792935328038-d905327aa6-s0 | failure | [全部步骤](runs/40198309595/logs.txt) | [summary.json](runs/40198309595/summary.json) |
| [40198233263](https://github.com/Astrea-296111/cue/actions/runs/40198233263) | Private project evaluation cue-1792935266160-e0621a8d50-s0 | failure | [全部步骤](runs/40198233263/logs.txt) | [summary.json](runs/40198233263/summary.json) |
| [40197684566](https://github.com/Astrea-296111/cue/actions/runs/40197684566) | Private project evaluation cue-1792934841027-53c3485306-s0 | failure | [全部步骤](runs/40197684566/logs.txt) | [summary.json](runs/40197684566/summary.json) |
| [40197678906](https://github.com/Astrea-296111/cue/actions/runs/40197678906) | Private project evaluation cue-1792934835436-938f8017ff-s0 | failure | [全部步骤](runs/40197678906/logs.txt) | [summary.json](runs/40197678906/summary.json) |
| [40197678317](https://github.com/Astrea-296111/cue/actions/runs/40197678317) | Private project evaluation cue-1792934835193-2b227dc2b4-s0 | failure | [全部步骤](runs/40197678317/logs.txt) | [summary.json](runs/40197678317/summary.json) |
| [40197678186](https://github.com/Astrea-296111/cue/actions/runs/40197678186) | Private project evaluation cue-1792934835370-b10169baa7-s0 | failure | [全部步骤](runs/40197678186/logs.txt) | [summary.json](runs/40197678186/summary.json) |
| [40197667514](https://github.com/Astrea-296111/cue/actions/runs/40197667514) | Private project evaluation cue-1792934824561-ad04299df6-s0 | failure | [全部步骤](runs/40197667514/logs.txt) | [summary.json](runs/40197667514/summary.json) |
| [40197657196](https://github.com/Astrea-296111/cue/actions/runs/40197657196) | Offline end-to-end | success | [全部步骤](runs/40197657196/logs.txt) | 见运行元数据 |
| [40197657025](https://github.com/Astrea-296111/cue/actions/runs/40197657025) | LLM live evaluation | skipped | [全部步骤](runs/40197657025/logs.txt) | 见运行元数据 |
| [40197656934](https://github.com/Astrea-296111/cue/actions/runs/40197656934) | CI | success | [全部步骤](runs/40197656934/logs.txt) | 见运行元数据 |
| [40197484508](https://github.com/Astrea-296111/cue/actions/runs/40197484508) | Offline end-to-end | success | [全部步骤](runs/40197484508/logs.txt) | 见运行元数据 |
| [40197484506](https://github.com/Astrea-296111/cue/actions/runs/40197484506) | CI | success | [全部步骤](runs/40197484506/logs.txt) | 见运行元数据 |
| [40197466989](https://github.com/Astrea-296111/cue/actions/runs/40197466989) | Offline end-to-end | success | [全部步骤](runs/40197466989/logs.txt) | 见运行元数据 |
| [40197466988](https://github.com/Astrea-296111/cue/actions/runs/40197466988) | CI | success | [全部步骤](runs/40197466988/logs.txt) | 见运行元数据 |
| [40164586758](https://github.com/Astrea-296111/cue/actions/runs/40164586758) | Private project evaluation cue-1792905015983-7bf80158e6-s3 | failure | [全部步骤](runs/40164586758/logs.txt) | 见运行元数据 |
| [40164580187](https://github.com/Astrea-296111/cue/actions/runs/40164580187) | Private project evaluation cue-1792905034619-1e10835525-s1 | failure | [全部步骤](runs/40164580187/logs.txt) | [summary.json](runs/40164580187/summary.json) |
| [40164576593](https://github.com/Astrea-296111/cue/actions/runs/40164576593) | Private project evaluation cue-1792905015983-7bf80158e6-s2 | failure | [全部步骤](runs/40164576593/logs.txt) | 见运行元数据 |
| [40164570664](https://github.com/Astrea-296111/cue/actions/runs/40164570664) | Private project evaluation cue-1792905034619-1e10835525-s0 | failure | [全部步骤](runs/40164570664/logs.txt) | [summary.json](runs/40164570664/summary.json) |
| [40164566186](https://github.com/Astrea-296111/cue/actions/runs/40164566186) | Private project evaluation cue-1792905015983-7bf80158e6-s1 | failure | [全部步骤](runs/40164566186/logs.txt) | 见运行元数据 |
| [40164564546](https://github.com/Astrea-296111/cue/actions/runs/40164564546) | Private project evaluation cue-1792905017333-5043bd854c-s0 | failure | [全部步骤](runs/40164564546/logs.txt) | [summary.json](runs/40164564546/summary.json) |
| [40164553155](https://github.com/Astrea-296111/cue/actions/runs/40164553155) | Private project evaluation cue-1792905015983-7bf80158e6-s0 | failure | [全部步骤](runs/40164553155/logs.txt) | 见运行元数据 |
| [40164530292](https://github.com/Astrea-296111/cue/actions/runs/40164530292) | Private project evaluation cue-1792904997003-8a53db37de-s0 | failure | [全部步骤](runs/40164530292/logs.txt) | [summary.json](runs/40164530292/summary.json) |
| [40164527719](https://github.com/Astrea-296111/cue/actions/runs/40164527719) | Real dual-channel audio fixture | success | [全部步骤](runs/40164527719/logs.txt) | 见运行元数据 |
| [40164513437](https://github.com/Astrea-296111/cue/actions/runs/40164513437) | Offline end-to-end | success | [全部步骤](runs/40164513437/logs.txt) | 见运行元数据 |
| [40164513425](https://github.com/Astrea-296111/cue/actions/runs/40164513425) | LLM live evaluation | skipped | [全部步骤](runs/40164513425/logs.txt) | 见运行元数据 |
| [40164513423](https://github.com/Astrea-296111/cue/actions/runs/40164513423) | CI | success | [全部步骤](runs/40164513423/logs.txt) | 见运行元数据 |
| [40164370877](https://github.com/Astrea-296111/cue/actions/runs/40164370877) | Offline end-to-end | success | [全部步骤](runs/40164370877/logs.txt) | 见运行元数据 |
| [40164370735](https://github.com/Astrea-296111/cue/actions/runs/40164370735) | CI | success | [全部步骤](runs/40164370735/logs.txt) | 见运行元数据 |
| [40164366314](https://github.com/Astrea-296111/cue/actions/runs/40164366314) | CI | success | [全部步骤](runs/40164366314/logs.txt) | 见运行元数据 |
| [40164366294](https://github.com/Astrea-296111/cue/actions/runs/40164366294) | Offline end-to-end | success | [全部步骤](runs/40164366294/logs.txt) | 见运行元数据 |
| [40163638462](https://github.com/Astrea-296111/cue/actions/runs/40163638462) | CI | success | [全部步骤](runs/40163638462/logs.txt) | 见运行元数据 |
| [40163638461](https://github.com/Astrea-296111/cue/actions/runs/40163638461) | Offline end-to-end | success | [全部步骤](runs/40163638461/logs.txt) | 见运行元数据 |
| [40163606037](https://github.com/Astrea-296111/cue/actions/runs/40163606037) | CI | success | [全部步骤](runs/40163606037/logs.txt) | 见运行元数据 |
| [40163606027](https://github.com/Astrea-296111/cue/actions/runs/40163606027) | Offline end-to-end | success | [全部步骤](runs/40163606027/logs.txt) | 见运行元数据 |
| [40163358221](https://github.com/Astrea-296111/cue/actions/runs/40163358221) | Private project evaluation cue-1792903837837-9fa879fb27-s0 | failure | [全部步骤](runs/40163358221/logs.txt) | [summary.json](runs/40163358221/summary.json) |
| [40163351222](https://github.com/Astrea-296111/cue/actions/runs/40163351222) | Offline end-to-end | success | [全部步骤](runs/40163351222/logs.txt) | 见运行元数据 |
| [40163351177](https://github.com/Astrea-296111/cue/actions/runs/40163351177) | LLM live evaluation | skipped | [全部步骤](runs/40163351177/logs.txt) | 见运行元数据 |
| [40163351161](https://github.com/Astrea-296111/cue/actions/runs/40163351161) | CI | success | [全部步骤](runs/40163351161/logs.txt) | 见运行元数据 |
| [40163208737](https://github.com/Astrea-296111/cue/actions/runs/40163208737) | CI | success | [全部步骤](runs/40163208737/logs.txt) | 见运行元数据 |
| [40163208723](https://github.com/Astrea-296111/cue/actions/runs/40163208723) | Offline end-to-end | success | [全部步骤](runs/40163208723/logs.txt) | 见运行元数据 |
| [40163195907](https://github.com/Astrea-296111/cue/actions/runs/40163195907) | CI | success | [全部步骤](runs/40163195907/logs.txt) | 见运行元数据 |
| [40163195896](https://github.com/Astrea-296111/cue/actions/runs/40163195896) | Offline end-to-end | success | [全部步骤](runs/40163195896/logs.txt) | 见运行元数据 |
| [40145150675](https://github.com/Astrea-296111/cue/actions/runs/40145150675) | Private project evaluation cue-1792886568306-9432265f4e-s0 | failure | [全部步骤](runs/40145150675/logs.txt) | [summary.json](runs/40145150675/summary.json) |
| [40145146037](https://github.com/Astrea-296111/cue/actions/runs/40145146037) | CI | success | [全部步骤](runs/40145146037/logs.txt) | 见运行元数据 |
| [40145146031](https://github.com/Astrea-296111/cue/actions/runs/40145146031) | LLM live evaluation | skipped | [全部步骤](runs/40145146031/logs.txt) | 见运行元数据 |
| [40145146023](https://github.com/Astrea-296111/cue/actions/runs/40145146023) | Offline end-to-end | success | [全部步骤](runs/40145146023/logs.txt) | 见运行元数据 |
| [40144926722](https://github.com/Astrea-296111/cue/actions/runs/40144926722) | Offline end-to-end | success | [全部步骤](runs/40144926722/logs.txt) | 见运行元数据 |
| [40144926714](https://github.com/Astrea-296111/cue/actions/runs/40144926714) | CI | success | [全部步骤](runs/40144926714/logs.txt) | 见运行元数据 |
| [40144875464](https://github.com/Astrea-296111/cue/actions/runs/40144875464) | CI | success | [全部步骤](runs/40144875464/logs.txt) | 见运行元数据 |
| [40144875460](https://github.com/Astrea-296111/cue/actions/runs/40144875460) | Offline end-to-end | success | [全部步骤](runs/40144875460/logs.txt) | 见运行元数据 |
| [40143998841](https://github.com/Astrea-296111/cue/actions/runs/40143998841) | Private project evaluation cue-1792885505494-7aa1614af5-s0 | failure | [全部步骤](runs/40143998841/logs.txt) | [summary.json](runs/40143998841/summary.json) |
| [40143993431](https://github.com/Astrea-296111/cue/actions/runs/40143993431) | Offline end-to-end | success | [全部步骤](runs/40143993431/logs.txt) | 见运行元数据 |
| [40143993427](https://github.com/Astrea-296111/cue/actions/runs/40143993427) | CI | success | [全部步骤](runs/40143993427/logs.txt) | 见运行元数据 |
| [40143993371](https://github.com/Astrea-296111/cue/actions/runs/40143993371) | LLM live evaluation | skipped | [全部步骤](runs/40143993371/logs.txt) | 见运行元数据 |
| [40143872252](https://github.com/Astrea-296111/cue/actions/runs/40143872252) | Offline end-to-end | success | [全部步骤](runs/40143872252/logs.txt) | 见运行元数据 |
| [40143872241](https://github.com/Astrea-296111/cue/actions/runs/40143872241) | CI | success | [全部步骤](runs/40143872241/logs.txt) | 见运行元数据 |
| [40143843823](https://github.com/Astrea-296111/cue/actions/runs/40143843823) | CI | success | [全部步骤](runs/40143843823/logs.txt) | 见运行元数据 |
| [40143843798](https://github.com/Astrea-296111/cue/actions/runs/40143843798) | Offline end-to-end | success | [全部步骤](runs/40143843798/logs.txt) | 见运行元数据 |
| [40075449245](https://github.com/Astrea-296111/cue/actions/runs/40075449245) | Private project deep evaluation | success | [全部步骤](runs/40075449245/logs.txt) | [summary.json](runs/40075449245/summary.json) |
| [40075444720](https://github.com/Astrea-296111/cue/actions/runs/40075444720) | LLM live evaluation | skipped | [全部步骤](runs/40075444720/logs.txt) | 见运行元数据 |
| [40075444688](https://github.com/Astrea-296111/cue/actions/runs/40075444688) | Offline end-to-end | success | [全部步骤](runs/40075444688/logs.txt) | 见运行元数据 |
| [40075444684](https://github.com/Astrea-296111/cue/actions/runs/40075444684) | CI | success | [全部步骤](runs/40075444684/logs.txt) | 见运行元数据 |
| [40075195560](https://github.com/Astrea-296111/cue/actions/runs/40075195560) | Offline end-to-end | success | [全部步骤](runs/40075195560/logs.txt) | 见运行元数据 |
| [40075195556](https://github.com/Astrea-296111/cue/actions/runs/40075195556) | CI | success | [全部步骤](runs/40075195556/logs.txt) | 见运行元数据 |
| [40075192489](https://github.com/Astrea-296111/cue/actions/runs/40075192489) | CI | success | [全部步骤](runs/40075192489/logs.txt) | 见运行元数据 |
| [40075192484](https://github.com/Astrea-296111/cue/actions/runs/40075192484) | Offline end-to-end | success | [全部步骤](runs/40075192484/logs.txt) | 见运行元数据 |
| [40074502603](https://github.com/Astrea-296111/cue/actions/runs/40074502603) | Private project deep evaluation | success | [全部步骤](runs/40074502603/logs.txt) | [summary.json](runs/40074502603/summary.json) |
| [40074497439](https://github.com/Astrea-296111/cue/actions/runs/40074497439) | LLM live evaluation | skipped | [全部步骤](runs/40074497439/logs.txt) | 见运行元数据 |
| [40074497435](https://github.com/Astrea-296111/cue/actions/runs/40074497435) | Offline end-to-end | success | [全部步骤](runs/40074497435/logs.txt) | 见运行元数据 |
| [40074497397](https://github.com/Astrea-296111/cue/actions/runs/40074497397) | CI | success | [全部步骤](runs/40074497397/logs.txt) | 见运行元数据 |
| [40074305842](https://github.com/Astrea-296111/cue/actions/runs/40074305842) | CI | success | [全部步骤](runs/40074305842/logs.txt) | 见运行元数据 |
| [40074305840](https://github.com/Astrea-296111/cue/actions/runs/40074305840) | Offline end-to-end | success | [全部步骤](runs/40074305840/logs.txt) | 见运行元数据 |
| [40074265821](https://github.com/Astrea-296111/cue/actions/runs/40074265821) | Offline end-to-end | success | [全部步骤](runs/40074265821/logs.txt) | 见运行元数据 |
| [40074265752](https://github.com/Astrea-296111/cue/actions/runs/40074265752) | CI | success | [全部步骤](runs/40074265752/logs.txt) | 见运行元数据 |
| [40072205570](https://github.com/Astrea-296111/cue/actions/runs/40072205570) | Private project deep evaluation | failure | [全部步骤](runs/40072205570/logs.txt) | [summary.json](runs/40072205570/summary.json) |
| [40072198873](https://github.com/Astrea-296111/cue/actions/runs/40072198873) | LLM live evaluation | skipped | [全部步骤](runs/40072198873/logs.txt) | 见运行元数据 |
| [40072198819](https://github.com/Astrea-296111/cue/actions/runs/40072198819) | CI | success | [全部步骤](runs/40072198819/logs.txt) | 见运行元数据 |
| [40072198806](https://github.com/Astrea-296111/cue/actions/runs/40072198806) | Offline end-to-end | success | [全部步骤](runs/40072198806/logs.txt) | 见运行元数据 |
| [40072056987](https://github.com/Astrea-296111/cue/actions/runs/40072056987) | Offline end-to-end | success | [全部步骤](runs/40072056987/logs.txt) | 见运行元数据 |
| [40072056958](https://github.com/Astrea-296111/cue/actions/runs/40072056958) | CI | success | [全部步骤](runs/40072056958/logs.txt) | 见运行元数据 |
| [40072042122](https://github.com/Astrea-296111/cue/actions/runs/40072042122) | CI | success | [全部步骤](runs/40072042122/logs.txt) | 见运行元数据 |
| [40072042045](https://github.com/Astrea-296111/cue/actions/runs/40072042045) | Offline end-to-end | success | [全部步骤](runs/40072042045/logs.txt) | 见运行元数据 |
| [39997526380](https://github.com/Astrea-296111/cue/actions/runs/39997526380) | LLM live evaluation | failure | [全部步骤](runs/39997526380/logs.txt) | 见运行元数据 |
| [39997490121](https://github.com/Astrea-296111/cue/actions/runs/39997490121) | CI | success | [全部步骤](runs/39997490121/logs.txt) | 见运行元数据 |
| [39997490094](https://github.com/Astrea-296111/cue/actions/runs/39997490094) | LLM live evaluation | skipped | [全部步骤](runs/39997490094/logs.txt) | 见运行元数据 |
| [39997489946](https://github.com/Astrea-296111/cue/actions/runs/39997489946) | Offline end-to-end | success | [全部步骤](runs/39997489946/logs.txt) | 见运行元数据 |
| [39997173275](https://github.com/Astrea-296111/cue/actions/runs/39997173275) | Offline end-to-end | success | [全部步骤](runs/39997173275/logs.txt) | 见运行元数据 |
| [39997173179](https://github.com/Astrea-296111/cue/actions/runs/39997173179) | CI | success | [全部步骤](runs/39997173179/logs.txt) | 见运行元数据 |
| [39997114745](https://github.com/Astrea-296111/cue/actions/runs/39997114745) | Offline end-to-end | success | [全部步骤](runs/39997114745/logs.txt) | 见运行元数据 |
| [39997114541](https://github.com/Astrea-296111/cue/actions/runs/39997114541) | CI | success | [全部步骤](runs/39997114541/logs.txt) | 见运行元数据 |
| [39955439721](https://github.com/Astrea-296111/cue/actions/runs/39955439721) | CI | success | [全部步骤](runs/39955439721/logs.txt) | 见运行元数据 |
| [39954927209](https://github.com/Astrea-296111/cue/actions/runs/39954927209) | CI | success | [全部步骤](runs/39954927209/logs.txt) | 见运行元数据 |
| [39954920934](https://github.com/Astrea-296111/cue/actions/runs/39954920934) | CI | success | [全部步骤](runs/39954920934/logs.txt) | 见运行元数据 |
| [39954430113](https://github.com/Astrea-296111/cue/actions/runs/39954430113) | CI | success | [全部步骤](runs/39954430113/logs.txt) | 见运行元数据 |
| [39954423514](https://github.com/Astrea-296111/cue/actions/runs/39954423514) | CI | success | [全部步骤](runs/39954423514/logs.txt) | 见运行元数据 |
| [39954061805](https://github.com/Astrea-296111/cue/actions/runs/39954061805) | CI | success | [全部步骤](runs/39954061805/logs.txt) | 见运行元数据 |
| [39954022947](https://github.com/Astrea-296111/cue/actions/runs/39954022947) | CI | success | [全部步骤](runs/39954022947/logs.txt) | 见运行元数据 |
| [39751061031](https://github.com/Astrea-296111/cue/actions/runs/39751061031) | CI | success | [全部步骤](runs/39751061031/logs.txt) | 见运行元数据 |
| [39750470667](https://github.com/Astrea-296111/cue/actions/runs/39750470667) | CI | success | [全部步骤](runs/39750470667/logs.txt) | 见运行元数据 |
| [39750459345](https://github.com/Astrea-296111/cue/actions/runs/39750459345) | CI | success | [全部步骤](runs/39750459345/logs.txt) | 见运行元数据 |
| [39750145543](https://github.com/Astrea-296111/cue/actions/runs/39750145543) | CI | success | [全部步骤](runs/39750145543/logs.txt) | 见运行元数据 |
| [39750139511](https://github.com/Astrea-296111/cue/actions/runs/39750139511) | CI | success | [全部步骤](runs/39750139511/logs.txt) | 见运行元数据 |
| [39750004062](https://github.com/Astrea-296111/cue/actions/runs/39750004062) | CI | cancelled | [全部步骤](runs/39750004062/logs.txt) | 见运行元数据 |
| [39749940369](https://github.com/Astrea-296111/cue/actions/runs/39749940369) | CI | cancelled | [全部步骤](runs/39749940369/logs.txt) | 见运行元数据 |
| [39624837063](https://github.com/Astrea-296111/cue/actions/runs/39624837063) | CI | failure | [全部步骤](runs/39624837063/logs.txt) | 见运行元数据 |
| [39624794437](https://github.com/Astrea-296111/cue/actions/runs/39624794437) | CI | failure | [全部步骤](runs/39624794437/logs.txt) | 见运行元数据 |
| [39573058014](https://github.com/Astrea-296111/cue/actions/runs/39573058014) | CI | failure | [全部步骤](runs/39573058014/logs.txt) | 见运行元数据 |
| [39573019651](https://github.com/Astrea-296111/cue/actions/runs/39573019651) | CI | failure | [全部步骤](runs/39573019651/logs.txt) | 见运行元数据 |
| [39565939998](https://github.com/Astrea-296111/cue/actions/runs/39565939998) | CI | failure | [全部步骤](runs/39565939998/logs.txt) | 见运行元数据 |
| [39565939448](https://github.com/Astrea-296111/cue/actions/runs/39565939448) | CI | failure | [全部步骤](runs/39565939448/logs.txt) | 见运行元数据 |
| [39528846335](https://github.com/Astrea-296111/cue/actions/runs/39528846335) | CI | failure | [全部步骤](runs/39528846335/logs.txt) | 见运行元数据 |
| [39528846127](https://github.com/Astrea-296111/cue/actions/runs/39528846127) | CI | failure | [全部步骤](runs/39528846127/logs.txt) | 见运行元数据 |
| [39446280780](https://github.com/Astrea-296111/cue/actions/runs/39446280780) | CI | failure | [全部步骤](runs/39446280780/logs.txt) | 见运行元数据 |
| [39446268674](https://github.com/Astrea-296111/cue/actions/runs/39446268674) | CI | failure | [全部步骤](runs/39446268674/logs.txt) | 见运行元数据 |
| [39435868066](https://github.com/Astrea-296111/cue/actions/runs/39435868066) | CI | failure | [全部步骤](runs/39435868066/logs.txt) | 见运行元数据 |
| [39435782686](https://github.com/Astrea-296111/cue/actions/runs/39435782686) | CI | failure | [全部步骤](runs/39435782686/logs.txt) | 见运行元数据 |
| [39421304907](https://github.com/Astrea-296111/cue/actions/runs/39421304907) | CI | failure | [全部步骤](runs/39421304907/logs.txt) | 见运行元数据 |
| [39416771897](https://github.com/Astrea-296111/cue/actions/runs/39416771897) | CI | failure | [全部步骤](runs/39416771897/logs.txt) | 见运行元数据 |
| [39033478107](https://github.com/Astrea-296111/cue/actions/runs/39033478107) | CI | failure | [全部步骤](runs/39033478107/logs.txt) | 见运行元数据 |
| [38562002979](https://github.com/Astrea-296111/cue/actions/runs/38562002979) | CI | failure | [全部步骤](runs/38562002979/logs.txt) | 见运行元数据 |
| [38504389055](https://github.com/Astrea-296111/cue/actions/runs/38504389055) | CI | failure | [全部步骤](runs/38504389055/logs.txt) | 见运行元数据 |
| [38401392890](https://github.com/Astrea-296111/cue/actions/runs/38401392890) | CI | failure | [全部步骤](runs/38401392890/logs.txt) | 见运行元数据 |
| [38380104725](https://github.com/Astrea-296111/cue/actions/runs/38380104725) | CI | failure | [全部步骤](runs/38380104725/logs.txt) | 见运行元数据 |
| [38346700748](https://github.com/Astrea-296111/cue/actions/runs/38346700748) | CI | failure | [全部步骤](runs/38346700748/logs.txt) | 见运行元数据 |
| [38343354666](https://github.com/Astrea-296111/cue/actions/runs/38343354666) | CI | failure | [全部步骤](runs/38343354666/logs.txt) | 见运行元数据 |
| [38338042920](https://github.com/Astrea-296111/cue/actions/runs/38338042920) | CI | failure | [全部步骤](runs/38338042920/logs.txt) | 见运行元数据 |
| [38266491764](https://github.com/Astrea-296111/cue/actions/runs/38266491764) | CI | failure | [全部步骤](runs/38266491764/logs.txt) | 见运行元数据 |
| [38227961246](https://github.com/Astrea-296111/cue/actions/runs/38227961246) | CI | failure | [全部步骤](runs/38227961246/logs.txt) | 见运行元数据 |
| [38205260236](https://github.com/Astrea-296111/cue/actions/runs/38205260236) | CI | failure | [全部步骤](runs/38205260236/logs.txt) | 见运行元数据 |
| [38202579546](https://github.com/Astrea-296111/cue/actions/runs/38202579546) | CI | failure | [全部步骤](runs/38202579546/logs.txt) | 见运行元数据 |
| [38140103726](https://github.com/Astrea-296111/cue/actions/runs/38140103726) | CI | failure | [全部步骤](runs/38140103726/logs.txt) | 见运行元数据 |
| [38140090479](https://github.com/Astrea-296111/cue/actions/runs/38140090479) | CI | failure | [全部步骤](runs/38140090479/logs.txt) | 见运行元数据 |
| [38135107827](https://github.com/Astrea-296111/cue/actions/runs/38135107827) | CI | failure | [全部步骤](runs/38135107827/logs.txt) | 见运行元数据 |
| [38132842045](https://github.com/Astrea-296111/cue/actions/runs/38132842045) | CI | failure | [全部步骤](runs/38132842045/logs.txt) | 见运行元数据 |
