# 2026-10-27 本轮验收

起始 HEAD：`358a728fa21ec5ac5537afd78554ad8e5030631a`，与用户执行说明基线相同。仅修改 cue；没有修改另外两个项目的业务代码，也没有复制两场完整面试记录到本轮 fixtures。

## 已执行的离线验证

- 默认 essential 套件及新增 `live-interaction.test.js`，实际使用 main/preload/生产规划/资料服务/模型适配器；SDK transport 与 OS 设备由测试替换。
- Electron 真实窗口的导入预览、直达 UI、设置、原文显示与错误提示；Linux Xvfb 不是 Windows 物理设备。
- `node scripts/benchmark-live-interaction.cjs evaluation/oct27/offline`：1000 卡、100 个热请求，目标选择 1000 次；[明细](offline/report.json)、[合成诊断示例](offline/diagnostic.json)。另有实际 Electron 合成按键到 DOM 的 100 次测量，待最终构建重新归档。
- 100 个独立编号的模板改写/负例（40 正例、60 负例）得直达 precision=100%、recall=100%、覆盖率=40%、拒绝率=60%。这是合成模板测试，不代表自由口述问题的泛化精度。开发使用 0–19 号卡，留出使用 100–119 号卡；原文条件、否定、数字、子问数量和版本冲突均有拒绝路径。
- `npm run test:llm:mock -- --mode smoke --provider all`：12 次模拟 SDK 调用通过，不是真实模型质量结果。

## 回归矩阵入口

| 要求 | 证据 |
| --- | --- |
| A01–A04、A07、A09 | `test/live-interaction.test.js` 的主进程提前提交、5 秒超时、会话/来源失效、版本取消与迟到 token 测试 |
| A05–A06 | 全部列举接话、中英文混合、短实质回答，interim/final 均保留题目；实际 SDK 默认不带本人语音 |
| A08 | 双顺序系统长句/麦克风片段、同题修订重建；`dialogue-production` 保留来源、原文和角色修订 |
| C01–C05 | 唯一标记审查最终 SDK 与检索、未调用 CUE 的题目也推进轮次、实体近邻消解与独立题隔离 |
| C06 | `materials-runtime`、`live-evaluation-regressions` 的手动项目与显式切换资料范围 |
| V01–V06 | 两个截图入口、一次路由+生成、专用预算、非视觉拒绝、坏路由不流代码、同题错误续接/附件/验收来源及新题清空 |
| V07 | 单一快捷键定义、生产入口/渲染桥；Windows CI 另外输出原生合成热键的前台、输入焦点、后台记录，状态以实际结果为准 |
| Q01–Q07 | 无 Key 零调用、冲突/否定/数字/多问拒绝、原子校验、Markdown/hash、编辑导出重导重启、资料指令不改应用路由 |

## 待真实运行的本轮检查

新增 `.github/workflows/live-interaction.yml` 仅允许 trusted main，使用已配置的 Qwen/DeepSeek Secrets：真实模型处理合成 interviewer interim、问答未命中，以及五类合成截图。每题不自动重试，保留完整序列化请求（图片改为对应合成 PNG 路径）、原始正文、类型、取消/错误、usage、调用次数和分阶段诊断。DeepSeek 当前适配能力不支持视觉时必须记录 unsupported，不能计作截图成功。

云 ASR 使用现有双声道公开合成 WAV，经真实 provider，新增提前按键与 ASR final 之前触发的事件证据；这个 ASR 专项的 LLM transport 为 mock，另一个工作流单独验证真实 LLM。不把两段验证写成物理音频到模型的完整实测。

Windows CI 会运行真实 Electron UI 和 `user32.keybd_event` 合成热键；CI 桌面不支持时写 unverified，不能用 Linux 结果替代。物理麦克风、声卡环回、用户电脑的录屏软件均未验证。

最终真实结果、构建提交与残留问题将在本目录更新。10 月 26 日四组结果已完整发布：acceptance Qwen 117/130，DeepSeek 详见原报告；multiturn Qwen 24/24、DeepSeek 23/24。它们保留为历史证据，本轮未将其作为新功能通过证明。
