# 2026-10-27 恢复后的收尾验证

恢复远端 `codex/oct27-acceptance-results` 的 `bee6622056f4b1aac017f9cc32383477f4e96f05`，该版本的五步协议和合成音频真实模型路径已合并到 main。以下实际运行均针对该提交；原始输出来自工作流生成的脱敏合成报告。

- 本机 Node 24：`npm test` 256/256 通过；Xvfb 中 Electron UI 实测通过；双 provider 离线 mock smoke 12 次调用通过。合并前此提交的 [CI](https://github.com/Astrea-296111/cue/actions/runs/40451161918) 与 [离线端到端](https://github.com/Astrea-296111/cue/actions/runs/40451161960) 均成功。
- [真实模型](https://github.com/Astrea-296111/cue/actions/runs/40464926819)：9 次生成，Qwen 7 次、DeepSeek 2 次，5 个 DeepSeek 图片案例因不支持视觉而在调用前拒绝。五类 Qwen 截图路由符合预期；自动状态是 `needs-human-review`，不能等同于全面质量通过。完整内容见 [live-report.json](live-report.json)。
- Qwen Vibe 案例识别为只读 NL2SQL，识别结果区分可见、推断和缺失。展示内容来自 `compiled-current-task-v1`，包含五步、每步四项、第一步不改代码及只读连接、SQL 解析允许列表、超时和资源预算；这是本地编译协议，不是模型原文，也不证明外部项目已实现这些防护。
- 对 Qwen/DeepSeek 口述、算法、SQL、调试和未知截图的正文做了抽查。SQL 求和与调试初始化符合该合成题；未知截图提示补充题面。Qwen 聚合解释称订单多商品行“直接求和总额会虚高”，没有限定求和的具体字段，措辞可能误导：明细金额相加不必然虚高，应具体判断订单级金额重复或 JOIN 放大。合成语音题的 Qwen 答案只提出状态表/Redis 锁，未说明锁过期、失败重试和外部副作用等边界，不能作为可靠的恰好一次执行方案。模型质量仍需人工把关。
- [真实双声道合成音频](https://github.com/Astrea-296111/cue/actions/runs/40464926903)：真实 Qwen ASR 加一次真实模型调用，interim 可回答时在 final 前发起，状态通过；两个 WAV 为合成输入，顺序依据软件回调/IPC。详见 [audio-report.json](audio-report.json)。这不证明物理麦克风、声卡环回或真实面试音频质量。
- Qwen interim 例从触发到首个有用句约 3.08 秒，高于此前 2.5 秒建议目标；单次测量不能代表整体延迟分布。DeepSeek 图片能力、物理 Windows 音频与录屏环境仍未验证。

早前 10 月 26 日的 260 次验收及对照结果保留在现有历史报告中；此次未重新执行那组测试。原始 `CUE_Codex_优化执行说明_2026-10-27.md` 附件没有出现在当前环境，无法逐条核对是否还有未归档的额外要求。
