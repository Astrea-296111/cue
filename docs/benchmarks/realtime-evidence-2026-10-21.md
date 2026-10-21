# 实时项目证据预取：验证报告（2026-10-21）

本次实现已完成本地验证，默认启用，可独立回退。结果日期按 Asia/Shanghai；原始 JSON 时间为 UTC。基础提交为 `ea1edaa02e72f89c3906af10bd62dc616b3bd43a`。代码与报告留在 `codex/realtime-project-evidence` 工作分支，本次不推送、合并或发布。

## 改动及测量边界

实际入口是 `package.json → src/custom-main.js → src/bugfix-main.js → main.js`。项目追问此前可能重新遍历完整索引，命中的后台原文没有被正式请求安全复用；主线程向量扫描、冷构建、重复 ASR 预取也会抢占请求准备。本次把已验证原文池接入正式请求，按当前题逐需求重评，只检索缺口；后台提前准备，快速正式请求不等待。测试能证明这些路径的行为，不能仅凭本地耗时将用户的全部 5–7 秒归因于其中某一项。

| 接入点 | 改动 |
| --- | --- |
| `main.js`、`renderer/renderer.js`、`src/question-resolver.js` | 主进程统一 ASR 预取；保持正式问题与来源 keys；首块真实正文后做有界相邻需求准备 |
| `src/retrieval-coordinator.js`、`src/active-project-context-cache.js`、`src/evidence-selector.js` | exact → 原文池重评 → 仅补缺口；恢复 canonical 来源；最终窗口删来源时撤销充分命中 |
| `src/project-prefetch-policy.js`、`src/project-rag-session.js`、`src/store.js` | 默认开关、前台 0ms / 深度 100ms / 后台 800ms；全局有界队列、取消、去重、任务间让出事件循环 |
| `src/project-knowledge.js`、`src/project-search.js`、`src/interview-context.js` | revision 映射复用、异步 warmup、快速请求禁止冷建；原子发布与外部变更失效 |
| `src/project-embeddings.js`、`src/project-embedding-worker.cjs`、`electron-builder.cjs` | worker 完成扫描/top-k；安装矩阵不 detach；故障恢复；新增 scope helper 的 ASAR unpack |
| `scripts/benchmark-realtime-evidence.cjs`、`scripts/evaluate-rag.js`、新增/更新测试 | 路径基准、40 个连续追问用例、原有 60 题与 18 步 SDK 回放 |

缓存身份、预算、取消行为、内存代价、资料组织、旧格式和回退操作见 [实现说明](../realtime-project-evidence.md)。未增加依赖，未修改模型、ASR、输出 token 上限、历史预算、快捷键或布局。

基准环境：Linux x64，Node v24.19.0，AMD EPYC 9V74，环境可见 5 个 CPU。走真实 package entry、问题解析、检索、最终预算和 SDK 序列化，供应商传输使用固定离线夹具。**没有真实 ASR、E5 推理、WAN、在线模型或 Windows UI。** CPU 竞争组只增加一个持续计算的独立 worker，不代表真实本地 ASR。

两组使用同机、同资料、同依赖、同问题序列的开关 off/on 对照。off 关闭本功能的来源池读取与相邻准备，公共映射/worker 修复仍存在，所以 off 不等于整个旧提交。小型夹具实际导入 28 块；4,000/14,000 压力数据是在真实导入快照上增加无关源码块，两个项目各不超过 7,000 块、1,800 文件，没有测试绕过生产导入限额。暖态含现有查询缓存、先完成一次种子问答，再重复对应场景；不是随机真实对话的分布。

## 暖态本地请求准备

单位 ms；每个规模 × 开关 × 路径均 300 次。数值为 `P50 / P95 / max`，包含最终 SDK 请求准备，不包含模型生成和 UI 绘制。原始样本保留 inputTokensEstimate、来源数、context/retrieval/lexical/pool 耗时和实际路径。开关开启时，每组 300 次均命中标注的实际路径；关闭时两个 pool 场景实际走 lexical-fallback。

### 普通离线负载

| 块数 | 场景 | off P50/P95/max | on P50/P95/max | on 池检查 P95 | on 事件循环 P95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 28 | exact-ready | 1.67 / 2.56 / 4.30 | 1.47 / 2.26 / 18.48 | 0.00 | 8.26 |
| 28 | pool-covered | 2.57 / 4.13 / 10.94 | 2.32 / 4.03 / 10.41 | 2.24 | 10.09 |
| 28 | pool-partial | 2.69 / 3.61 / 6.28 | 3.65 / 5.89 / 21.53 | 1.15 | 12.89 |
| 28 | lexical-fallback | 2.27 / 2.93 / 5.69 | 2.45 / 3.35 / 4.98 | 0.09 | 4.59 |
| 4,000 | exact-ready | 1.75 / 2.35 / 5.17 | 1.98 / 3.31 / 7.68 | 0.00 | 10.38 |
| 4,000 | pool-covered | 2.82 / 3.45 / 14.65 | 2.97 / 4.25 / 9.78 | 2.62 | 11.89 |
| 4,000 | pool-partial | 3.56 / 5.14 / 15.55 | 4.96 / 6.57 / 26.64 | 1.46 | 14.00 |
| 4,000 | lexical-fallback | 3.15 / 4.63 / 16.07 | 2.77 / 4.40 / 24.96 | 0.06 | 7.27 |
| 14,000 | exact-ready | 1.84 / 4.43 / 18.41 | 1.89 / 4.64 / 19.69 | 0.00 | 12.47 |
| 14,000 | pool-covered | 3.24 / 6.82 / 64.36 | 2.74 / 3.72 / 5.88 | 2.37 | 10.23 |
| 14,000 | pool-partial | 3.52 / 7.89 / 72.39 | 4.79 / 6.44 / 40.79 | 1.63 | 14.63 |
| 14,000 | lexical-fallback | 2.67 / 5.41 / 52.03 | 2.77 / 3.76 / 37.22 | 0.06 | 5.48 |

### 模拟 CPU 竞争

| 块数 | 场景 | off P50/P95/max | on P50/P95/max | on 池检查 P95 | on 事件循环 P95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 4,000 | exact-ready | 2.31 / 3.06 / 5.72 | 2.02 / 3.25 / 7.93 | 0.00 | 11.35 |
| 4,000 | pool-covered | 3.95 / 4.65 / 25.96 | 3.10 / 5.15 / 10.76 | 3.21 | 14.32 |
| 4,000 | pool-partial | 4.17 / 4.97 / 26.19 | 5.14 / 8.14 / 34.18 | 1.74 | 16.36 |
| 4,000 | lexical-fallback | 3.74 / 4.71 / 18.70 | 2.87 / 4.29 / 27.71 | 0.08 | 7.63 |
| 14,000 | exact-ready | 1.81 / 2.83 / 6.84 | 1.89 / 3.31 / 8.07 | 0.00 | 11.80 |
| 14,000 | pool-covered | 3.07 / 4.21 / 41.96 | 2.92 / 4.57 / 9.63 | 2.94 | 12.75 |
| 14,000 | pool-partial | 3.24 / 4.95 / 57.70 | 5.81 / 9.34 / 66.03 | 2.08 | 19.76 |
| 14,000 | lexical-fallback | 2.96 / 4.04 / 43.94 | 3.19 / 5.30 / 50.12 | 0.07 | 9.39 |

普通负载共 7,200 个暖态样本，CPU 组共 4,800 个。14,000 块普通负载的 pool-covered 准备 P95 从 6.82ms 到 3.72ms；小规模/部分补查有额外校验与调度开销，部分场景略慢。既有精确缓存本身已很快，不能把局部结果表述为所有场景整体翻倍。单次 max 会受调度影响，完整值见表和原始 JSON。

### 初始工程目标

下表为各 on 场景中最差 P95；增量按同规模同场景 on−off 的 P95 计算，不是单样本配对差值。

| 指标 | 目标 | 普通负载 | 模拟 CPU |
| --- | ---: | ---: | ---: |
| 池检查/选择 | ≤15ms | 2.62ms | 3.21ms |
| 池足够时准备 | ≤60ms | 4.25ms | 5.15ms |
| 补缺口时准备 | ≤100ms | 6.57ms | 9.34ms |
| 开启后准备 P95 最大增量 | ≤10ms | 2.28ms | 4.39ms |
| 主线程事件循环 | ≤20ms | 14.63ms | 19.76ms |

这些本地样本达到初始 P95 目标。eventLoopDelay 以 1ms 分辨率在 warmup/种子问答完成后监控，包含测量期间的后台工作；未覆盖真实 ASR/ONNX 同时运行时的压力。快速正式路径不新增在线 planner/rewrite/reranker 或 query embedding；可控语义与入口回归验证 fast 不等未完成预取。错 scope/epoch/revision 的发布在本次回归中为 0。

## 冷态单独报告

每种规模、开关各 20 次。下表普通负载；CPU 组原始数据另附。`catalogLoadMs` 单列在原始样本，首次磁盘 JSON 读取不算成 warm 请求。开启后冷态返回 `index-not-ready`、明确缺口和 0 个来源，再后台准备；关闭后可同步建 postings 并返回来源。**两者证据可用性不同，不能宣传为同质量冷启动提速。** 全目录尚未加载时也有独立入口回归覆盖。

| 块数 | off 准备 P50/P95/max | on 准备 P50/P95/max | on 后续 warm 等待 P50/P95/max |
| ---: | ---: | ---: | ---: |
| 28 | 12.84 / 14.60 / 17.08 | 2.98 / 3.52 / 3.94 | 4.36 / 12.38 / 12.74 |
| 4,000 | 171.81 / 190.08 / 228.99 | 3.88 / 5.42 / 6.54 | 144.63 / 172.01 / 528.43 |
| 14,000 | 579.78 / 615.78 / 619.73 | 3.57 / 4.21 / 4.58 | 492.01 / 554.62 / 1209.35 |

这里的后续 warm 等待从正式请求准备结束后开始计，不是完整建索引 CPU 时间；有并行重叠。原始旧提交基线也归档，仅含少量探索样本：4,000 块的首轮准备 447.61ms、次轮 53.83ms，样本量不足以计算可信 P95，不与本次冷态缺来源响应作等质量对比。

## 预取窗口

采用受控 350ms 语义任务，真实入口接收 final 后等待指定 lead time，再触发实际回答快捷键。每项一次，仅验证行为，不用于延迟分位数推断。

| lead time | off 准备 ms / 路径 | on 准备 ms / 路径 |
| ---: | --- | --- |
| 0ms | 11.29 / lexical-fallback | 12.52 / lexical-fallback |
| 100ms | 15.51 / lexical-fallback | 16.73 / lexical-fallback |
| 300ms | 13.62 / lexical-fallback | 14.56 / lexical-fallback |
| 800ms | 15.42 / lexical-fallback | 11.26 / exact-ready |

提前量不足时立即使用词法证据，不等待 350ms；充足提前量可读取 exact-ready。晚到证据用于下轮，不自动补发第二次模型回答。没有把占位字、SSE 心跳、usage 或 reasoning 当作答案首字。

## 质量与来源定位

### 新增 40 个受控追问

20 个 development、20 个 heldout，两个完全合成的项目。覆盖复述、实体/否定修正、实现转职责/协作、多个子问、指标/环境/限制、无效代码引用、冷态、切项目和连续预取；生产代码没有夹具项目专用别名/答案词。

| 指标 | off | on |
| --- | ---: | ---: |
| 最终 SDK 可见关键事实覆盖 | 97.92% | 100.00% |
| 多问完整覆盖 | 87.50% | 100.00% |
| 错误充分命中 | 0.00% | 0.00% |
| 预期缺口被报告 | 100.00% | 100.00% |
| 跨项目污染次数 | 0 | 0 |
| 来源位置/可见性错误次数 | 0 | 0 |

关键事实共 48 个、多事实追问 8 个；缺口项仅 4 个，“预期缺口被报告”不等同于全体问题的缺口精确率。on 的 100% 只适用于此受控集合。基准检查来源 path/line/SDK 可见性；40 例正式测试另将来源 text 与原文件对应行逐一核对。

### 保留的 60 题与 18 步 SDK 回放

以下 baseline/typed/fast/realtime 是评测器的检索变体，和上述整体功能开关 off/on 不是同一种对照。

| 变体 | 候选来源召回 | 最终可见事实覆盖 | 多问完整覆盖 | 缺口 precision / recall | 跨项目污染 |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 50.00% | 40.00% | 0.00% | 未定义 / 0.00% | 0 |
| typed | 100.00% | 74.29% | 60.00% | 13.79% / 40.00% | 0 |
| fast | 100.00% | 75.71% | 60.00% | 14.29% / 40.00% | 0 |
| realtime | 100.00% | 80.00% | 60.00% | 15.38% / 40.00% | 0 |

realtime 相比 fast 的可见事实覆盖从 75.71% 到 80%，同集合上述质量指标未退化。但**多问完整覆盖仍仅 60%，缺口 precision 15.38% / recall 40%**；仍有误报和漏报，没有解决全部 RAG 质量问题。缺口标签为按题聚合，实体级正确性仍需人工复核。公开静态 heldout 不代表未来独立盲测；没有真实模型生成，不能计算生成答案的 unsupported-fact rate。

18 步真实 package-entry / runFeature / SDK adapter 回放：18/18 路由正确，跨项目来源 0、外项目 assistant 历史 0、被选来源在实际 SDK 消息中隐藏的次数 0。单独检索回放也是 18/18 路由正确。SDK 回放本地准备 P50/P95 为 6.75/46.31ms，只用于正确性核验，不混入上面的独立性能采样。

## 测试与未测量项

- 完整 `npm test`：585 项，584 通过、1 失败。失败是已有 `test/bugfix-files.test.js:75` 的 “packaged builds bundle whisper by default”：测试要求无 `CUE_BUNDLE_WHISPER`，现有配置实际为 opt-in；本次没有修改 Whisper 打包策略。
- 最终合成资料仅清理尾部空行后，两个新增测试文件重新执行：65/65 通过；生产代码与被测 SHA-256 未变化。
- 真实 worker：14,000 行 scope/top-k/ID-only、不 detach 持久化矩阵、revision 失效、挂起恢复与终止屏障；连续 interim、全局队列优先级、30 分钟虚拟会话边界均通过。
- ASAR：实际打包/解包后运行 Node worker，相对依赖 `project-scope.js` 及目标原生依赖先决条件测试通过；没有运行 Windows 安装包。
- Electron 33.2.1 + Linux Xvfb：`UI_LAYOUT_OK` / `UI_QUIT_OK`，包含快捷键、字幕/录音、布局及保护失败夹具。云容器使用 `--no-sandbox`；这不是 Windows 真实共享屏幕测试。
- ONNX 1.21.0 原生小算子 smoke 通过，输出 `[1,4,9,16,25,36]`；没有实际 E5 模型，不代表中文语义质量。阈值仍为 0.70，未经本次真实 E5 校准，不称最优。
- 未测量：真实 Windows dist/runtime、真实本地/远程 ASR、用户私有资料、腾讯会议/UU、真实 E5、供应商正文首字及真实 UI paint 延迟。没有用户 API key，不自动下载模型。

保留 `[latency][prompt]`、`[latency][reply]`、`[latency][ui]` 分阶段计时；首个非空正文与 UI paint ack 分开，当前报告不对真实按键到首字/paint 给出数字。不承诺将用户 5–7 秒变成固定 1 秒。外部文件改变采用 2 秒异步轮询，发现前有窗口；原生推理无法即时抢占，取消后超过 2 秒走故障恢复；冷态可能明确无资料，需等待后台就绪。这些限制和内存代价见实现说明。

## 复现与 Windows 验证

```sh
npm ci --include=dev --include=optional
node scripts/benchmark-realtime-evidence.cjs --samples 300 --cold-samples 20 --out /tmp/cue-normal.json
node scripts/benchmark-realtime-evidence.cjs --samples 300 --cold-samples 20 --sizes 4000,14000 --cpu-contention --out /tmp/cue-cpu.json
node scripts/evaluate-rag.js --out /tmp/cue-rag.json
node --test test/realtime-project-evidence.test.js test/realtime-evidence-worker.test.js test/project-embeddings.test.js
node scripts/semantic-smoke.cjs --runtime-only
npm test
npm run test:ui
```

UI 测试需要桌面显示；云 Linux 使用 Xvfb，并在本容器中通过 `npm run test:ui -- --no-sandbox` 执行。

真实 E5 已存在本地时，可另跑 `node scripts/evaluate-rag.js --semantic --model-dir <模型目录> --out <结果路径>`；不要把离线语义夹具替代真实模型结果。

Windows 尚待执行：

1. 安装同版本 Node 和依赖，执行 `npm run dist:win`，使用打包程序验证 worker/native 依赖；CLI 输出路径改为 Windows 临时路径。
2. 导入相同的两个真实项目目录/ZIP，等待基础/语义索引就绪，保留同一模型、ASR 和 fast 模式。分别设置 `realtimeEvidencePrefetch=false/true`，每次切换后按相同冷暖条件重新开始。
3. 先文字快捷键，再真实 ASR，至少各 30 个连续项目追问；含 0/100/300/800ms 按键提前量、转项目、多问与否定修正。两轮使用同样资料、问题序列和模型设置。
4. 按 requestId 对齐 `[latency][prompt]` 的 path/pool/lexical/budget、`[latency][reply]` 正文首字和 `[latency][ui]` paint ack；分别统计按键→非空正文与按键→绘制 P50/P95/max，同时人工核对最终可见证据、缺口和来源。可只分享脱敏计时，不分享 API key、私有源码或原始对话。

## 原始数据

JSON 压缩仅用于控制仓库体积，未删减原始样本。解压示例：`python -c "import gzip,json; d=json.load(gzip.open('docs/benchmarks/realtime-evidence-2026-10-21.normal.json.gz')); print(d['configuration'])"`。普通/CPU 文件包含 12 个被测文件（含基准脚本）的 SHA-256，可核对本次代码。摘要不重复保存逐次样本，原始数据保留全部。

- [可读 JSON 摘要](realtime-evidence-2026-10-21.summary.json)
- [普通负载全部样本](realtime-evidence-2026-10-21.normal.json.gz)
- [模拟 CPU 全部样本](realtime-evidence-2026-10-21.cpu.json.gz)
- [60 题与回放全部结果](realtime-evidence-2026-10-21.rag.json.gz)
- [旧提交探索基线（非 P95 基准）](realtime-evidence-2026-10-21.baseline.json.gz)
