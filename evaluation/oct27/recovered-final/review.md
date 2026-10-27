# 2026-10-27 恢复后的收尾验证

恢复远端 `codex/oct27-acceptance-results` 的 `bee6622056f4b1aac017f9cc32383477f4e96f05`，该版本的五步协议和合成音频真实模型路径已合并到 main。以下实际运行均针对该提交；原始输出来自工作流生成的脱敏合成报告。

- 本机 Node 24：`npm test` 256/256 通过；Xvfb 中 Electron UI 实测通过；双 provider 离线 mock smoke 12 次调用通过。合并前此提交的 [CI](https://github.com/Astrea-296111/cue/actions/runs/40451161918) 与 [离线端到端](https://github.com/Astrea-296111/cue/actions/runs/40451161960) 均成功。
- [真实模型](https://github.com/Astrea-296111/cue/actions/runs/40464926819)：9 次生成，Qwen 7 次、DeepSeek 2 次，5 个 DeepSeek 图片案例因不支持视觉而在调用前拒绝。五类 Qwen 截图路由符合预期；自动状态是 `needs-human-review`，不能等同于全面质量通过。完整内容见 [live-report.json](live-report.json)。
- Qwen Vibe 案例识别为只读 NL2SQL，识别结果区分可见、推断和缺失。展示内容来自 `compiled-current-task-v1`，包含五步、每步四项、第一步不改代码及只读连接、SQL 解析允许列表、超时和资源预算；这是本地编译协议，不是模型原文，也不证明外部项目已实现这些防护。
- 对 Qwen/DeepSeek 口述、算法、SQL、调试和未知截图的正文做了抽查。SQL 求和与调试初始化符合该合成题；未知截图提示补充题面。Qwen 聚合解释称订单多商品行“直接求和总额会虚高”，没有限定求和的具体字段，措辞可能误导：明细金额相加不必然虚高，应具体判断订单级金额重复或 JOIN 放大。合成语音题的 Qwen 答案只提出状态表/Redis 锁，未说明锁过期、失败重试和外部副作用等边界，不能作为可靠的恰好一次执行方案。模型质量仍需人工把关。
- [真实双声道合成音频](https://github.com/Astrea-296111/cue/actions/runs/40464926903)：真实 Qwen ASR 加一次真实模型调用，interim 可回答时在 final 前发起，状态通过；两个 WAV 为合成输入，顺序依据软件回调/IPC。详见 [audio-report.json](audio-report.json)。这不证明物理麦克风、声卡环回或真实面试音频质量。
- Qwen interim 例从触发到首个有用句约 3.08 秒，高于此前 2.5 秒建议目标；单次测量不能代表整体延迟分布。DeepSeek 图片能力、物理 Windows 音频与录屏环境仍未验证。

早前 10 月 26 日的 260 次验收及对照结果保留在现有历史报告中；此次未重新执行那组测试。

## 与任务书核对

已取得 `CUE_Codex_优化执行说明_2026-10-27.md`，核对了六项用户体验、A/C/V/Q 回归矩阵及交付物。实际起始提交 `358a728fa21ec5ac5537afd78554ad8e5030631a` 与任务书基线一致，代码由 `e740ac8` 起实施，后续修复与五步协议包含在 `bee6622` 中。逐项回归入口及覆盖说明见 [本轮验收矩阵](../README.md)；个人资料和模型设置迁移、问答导入和生命周期亦由默认测试及实际 UI smoke 覆盖。模板、Schema、格式说明及 facts v2 映射见 [问答格式](../../../docs/cue-qa-format.md)。使用说明书现已直接写明提前按键、接话、截图、问答导入及近邻上下文操作。

[Windows CI](https://github.com/Astrea-296111/cue/actions/runs/40465183032) 针对 `6e1984a` 的六组原生合成快捷键均通过：[明细](windows-shortcuts.json)。1000 卡、100 次热缓存 Electron DOM 测量，p95 为 6.4ms，模型调用为 0，边界与机器信息见 [测量结果](windows-qa-ui-performance.json)；[诊断示例](windows-diagnostic.json) 绑定该构建。这不是物理按键或屏幕像素绘制延迟。先前 100 条问答改写/负例为模板构造的留出集，precision/recall 100%、覆盖率 40%、拒绝率 60%，不能外推为自然面试准确率，详见 [离线报告](../offline/report.json)。

任务书要求的双 provider 真实截图覆盖受 DeepSeek 视觉能力限制：它在调用前明确拒绝，不能计为备用 provider 截图通过。真实 ASR 到模型使用合成 WAV；用户设备音频仍未测试。截图诊断记录类型、可见/推断/缺失及人工覆盖，但没有经过校准的数值置信度，不能把路由结果当成置信概率。五类截图只有每类一个合成样本，不足以推断真实场景混淆率。Qwen 两处回答质量问题及延迟结果见上文，不能将本轮写成全部质量目标通过。
