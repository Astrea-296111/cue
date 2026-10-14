# 本地检索评测记录

记录时间：2026/10/14 10:39:19（UTC+8）。生产源码哈希 `9f163c6d787b984c295fbb6e6f3943d3ffaa304b95d26c53e5e3497192ea43a0`；评测期间源码未变。gold 哈希 `281dd1eba7211f763b743a441110b87b711c97241ebc1befdd3a8f22d41d7899`。

该记录使用人工编写的两个合成项目，不是用户真实经历。共 60 问：40 问开发集、20 问静态公开保留集。gold 与回放不导入索引，问题不复制为 aliases。baseline 指在同一新索引上运行同步兼容路径，不是旧提交的完整程序。

| 模式 | 候选来源召回 | 最终消息关键事实覆盖 | 多问完整覆盖 | 跨项目来源泄漏 | missing 精确率 / 召回率 |
| --- | --- | --- | --- | --- | --- |
| baseline | 50.0% | 35.7% | 0.0% | 0 | 未测量 / 0.0% |
| typed | 100.0% | 74.3% | 60.0% | 0 | 13.8% / 40.0% |

typed 开发集关键事实覆盖 93.2%，保留集 42.3%。候选召回只要求合理来源出现；最终覆盖额外核对真实来源标签、可见原文与关键事实，例如指标必须保留机器和口径。保留集的口语表达与多问仍有明显不足；不能把候选 100% 当成最终回答 100%。missing 按类型粗聚合，实体、职责与验证细节仍需人工审阅。

18 步连续回放捕获真实 `package.json → custom-main → bugfix-main → main.js → LLM SDK` 请求：路由 18/18，跨项目证据 0，跨项目助手历史 0，声称已用但未进入 SDK 消息的来源 0。只替换 OS/硬件和模型流式传输；没有调用真实云 LLM。

## 本地延迟

环境：linux/x64，Node v24.19.0，AMD EPYC 9V74 80-Core Processor，可见 CPU 5，RAM 33.289 GiB。合成项目规模较小，不代表每项目 7000 块或普通 Windows 笔记本。

| 测量 | P50 / P95（ms） | 样本 |
| --- | --- | --- |
| 暖态基础检索 | 1.428 / 9.052 | 300 |
| 无预取的本地请求构造 | 1.593 / 9.472 | 300 |
| 精确预取后的本地请求构造 | 1.068 / 6.045 | 300 |
| 受控 worker 失效回退 | 1.287 / 6.848 | 300 |
| 真实入口按键到 SDK 的本地准备 | 12.55 / 78.55 | 18 |

导入与索引冷准备 66.53 ms。第一个 baseline 请求包含冷 postings 构建；后续 typed 共用暖索引。另一次加入最多两个合成忙碌 worker，暖态检索 P50/P95=1.687/10.276 ms。CPU 竞争只作用于 benchmark 阶段，不作用于此前 SDK 回放；不是实际 Whisper 竞争。

## 未验证与复测

真实 e5 ONNX 下载受当前环境访问限制，尚未完成真实模型和语义命中校准。本次只有基础 typed 检索；未准备模型、指定模型目录缺失和受控 worker 失败均有回退报告，不能当作真实 ONNX 成功。没有真实生成样本，无依据事实比例、真实 TTFT、网络延迟、UI 首字及供应商缓存命中均未测量。

参考 CAE 固定版本源码的另一次本地 sanity 只导入源码 ZIP，未导入 160 题、个人核对表或外部验收 JSON。其 332 文件、2232 片段的冷态正式入口准备约 1053 ms，暖态约 32–42 ms；冷态没有达到 150 ms 目标，应用会在启动时后台预热，但不能保证用户过早按键时没有冷准备。其数据与完整报告留在工作区 scratch，未提交用户材料；合成评测不代替该项目的业务检索和个人事实核对。

```bash
npm run eval:rag -- --out /tmp/cue-rag-eval.json
npm run benchmark:rag -- --iterations 5 --out /tmp/cue-rag-latency.json
npm run benchmark:rag -- --iterations 3 --cpu-contention --out /tmp/cue-rag-cpu.json
npm run eval:rag:semantic -- --model-dir /已准备模型目录 --out /tmp/cue-rag-semantic.json
```

语义阈值可通过 `--semantic-threshold` 在开发集评估，默认 0.70 尚未基于真实模型校准。不要基于保留集调参后继续把它称为独立验收。每份 JSON 记录源码与 gold 哈希，`sourceChangedDuringRun=true` 的结果需要重跑。

## 回归与发布检查

- 工作基线 `dbb301b`：389 项测试，388 通过，1 项既有 Whisper 默认打包断言失败。
- 修改后：476 项，475 通过，同一项 Whisper 断言仍失败；未删除或禁用它。普通测试不下载模型、不调用真实云 LLM。
- Electron 33 在 125% 缩放下验证中文控件、当前项目选择、真实检索来源折叠、固定字幕区域、Ctrl+Enter 取消、中途清空和自然退出。
- 实际 Linux ASAR 包验证真实启动链、最终 SDK 请求与 CPU ONNX native worker；Windows x64 目录包包含 ONNX、DirectML、Sharp 与 libvips 的目标平台文件。
- 跨系统打包发现并修复 Sharp 可选依赖遗漏；新增打包检查拒绝只带宿主系统库的目标包。Windows/macOS 的实际运行、签名安装包以及真实 E5 推理仍未验证。

只新增直接运行依赖 `@huggingface/transformers@3.8.1`，并更新锁文件；没有 Python 服务、在线 embedding、在线规划或模型重排。QuestionResolver、Electron 启动入口、`src/context.js` 的窗口设置与原窗口移动布局没有改动。用户上传的参考原文、个人核对表和验收 JSON 未写入仓库。
