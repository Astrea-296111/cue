# 实时项目证据预取与复用

基于 `ea1edaa` 的真实入口 `package.json → src/custom-main.js → src/bugfix-main.js → main.js` 实现。默认启用 `realtimeEvidencePrefetch`，不新增在线 planner、query rewrite、reranker、embedding 服务或第二次回答生成。不改模型、ASR、快捷键、截图、布局、输出 token 上限及既有历史预算。

## 正式请求

`main.js` 继续通过 QuestionResolver/显式输入确定完整问题，再经 `buildInterviewContextBundleAsync → retrieveProjectEvidenceAsync → prepareFinalRequest → LLM SDK`。

正式检索依次走：

1. `exact-ready`：已完成结果与完整问题、来源 keys、子问/范围、场景约束、epoch、revision、模型及配置身份一致。读取候选，按本轮真实 sourceBudget 重新选来源；不能复用裁剪过的小预算结果冒充完整候选。
2. `pool-covered`：读取同项目原文池，在本轮问题上重新进行词法评分、实体/符号/否定条件与逐需求检查；实际预算内足够才跳过全项目检索。
3. `pool-partial` / `lexical-fallback`：只为缺少证据的子问执行 scoped BM25/路径/符号检索，再按现有 typed selector 分配证据。已覆盖的子问保留候选，不因补查第一问而丢失后续问题。
4. `index-not-ready`：快速请求不冷建 postings、关系图或同步读取/解析整个索引。后台继续准备，本轮使用同 revision 已就绪来源或明确报告缺口。

同一段话里的短追问可借用同 scope 前一子问的明确主题做本地检索上下文，例如“缓存怎么实现？为什么这样选？”。这不改写正式问题、不丢约束、不增加模型调用。超过现有问题组/来源预算的需求仍报告 missing。

`say/answerThis` 仍为普通 3,600、复杂 4,800 **字符**的项目上下文预算；不是 token。最终模型窗口还会删掉整块来源。删掉来源后撤销充分命中标记；checklist 和讨论状态只认最终 SDK 可见来源，历史 AI 回答不成为项目事实。

## 来源池与身份

扩展的是原来的 `ActiveProjectContextCache`，没有另建一套独立池。同步兼容 API 和深度模式仍可使用。

- 精确结果保留完整问题身份和预算身份；来源池按 scopes、索引 revision、embedding modelVersion、retrievalConfigVersion、schemaVersion 分开。语义准入阈值也属于配置身份，改变阈值不能复用旧批准。
- 池只接受有出处的 imported 原文；按当前快照的 source ID、project、path、行号/offset、文本及 SHA-256 恢复验证。父块恢复保留完整/截断标记。
- 清除旧 `questionIds`、score/confidence/coverage/relevance、semanticSimilarity、relevanceApproved、channels 等问题相关属性。小型池内重新建词法索引并按当前子问绑定，不沿用旧语义批准。
- 池的子问批准不能串到另一个子问。未知技术/状态/符号、否定修正、未定位的代码位置不会因“有某个相关方法”就跳过检索。
- implementation 不能代替 ownership、collaboration、decision、performance。未提供管理职责、生产事故、实测数字或有效代码链接时保留缺口。
- 默认每池最多 48 个完整原文单位、32,000 字符；最多两个活跃项目，六个受控策略槽位。来源池 TTL 为 20 分钟，读取不无限延长过期时间；相同项目不同模型/配置的条目不会互相无条件驱逐。
- 精确结果最多 12 项、60 秒；预测提示最多两项、45 秒。revision 更新、清空、模型/配置变化依靠事件/generation 失效，TTL 仅辅助。

所有真实来源仍可在原来源面板核对。缓存来源不等于已经回答；充分覆盖必须在本轮问题和最终预算下成立。

## 前后台调度

策略集中在 `src/project-prefetch-policy.js`：

| 执行用途 | 默认预算和行为 |
| --- | --- |
| 快速正式请求 | `semanticWaitMs=0`、`hashFallback=false`；不新建 query embedding，不等未完成工作 |
| 深度正式请求 | 保留最多 100ms 的语义等待及原有回退 |
| 后台预取 | 800ms，配置硬上限 1,000ms；关闭 hash fallback |
| interim | 180ms debounce、至少间隔 300ms、最多推迟 600ms |
| 全局并发 | 一个当前检索任务、一个最新 pending，最多两项低优先级准备；一个实际语义 worker |

主进程在规范化、去重、更新 QuestionResolver 后统一观察 interviewer interim/accepted final；只读预览合并多个 final 并保留来源 keys。renderer 继续显示字幕，不再重复转发 ASR 预取。旧 `project:prefetch` IPC 保留有界输入校验和同调度器去重。

普通尾部追加合并 pending，不对每个词中断同主题工作；实体/否定修正、换项目、清空和资料版本改变会取消过期任务。持续 100ms 更新也能启动受限的预取，不会无限尾随 debounce。通用八股暂停项目工作。

相邻后台任务之间通过 `setImmediate` 让出事件循环，避免多个证据选择连续占据同一轮 microtask，给键盘、音频和 UI 回调处理机会。

第一块真实正文交付后，让出主线程，再依据来源中的 topics、成功解析的 related_docs/code_refs 和代码关系准备最多两类相邻需求。关系扩展最多两跳、六个邻居；无可信关联则跳过。准备提示不进入正式问题、checklist、事实来源或回答正文。晚到资料留给下一轮，不修改正在流式生成的 prompt，不自动生成第二份答案。

## worker、冷启动和外部变化

原有 E5 worker 继续负责 q8 / 384 维 embedding，保留 `query:` / `passage:` 前缀、均值池化、归一化及模型校验。现在它同时完成矩阵点积和 top-k；主进程不再逐行扫描向量。

每个 revision 安装一次矩阵和 compact row/scope 元数据。查询只发 384 维向量或 query、scopes、预算/身份；只收 IDs、分数、版本与耗时。主进程从 canonical snapshot 取原文。安装不 transfer/detach 主进程持久化矩阵，代价是内存中保留一份 worker 副本；14,000 行、每行单段时矩阵约 20.5MiB/份，多段文档会增加行数。没有第二份 ONNX 模型，也没引入新依赖或向量数据库。

原生推理不能保证即时抢占。取消移除排队工作，原生调用结束后丢弃过期结果；取消后 worker 超过 2 秒仍不响应时终止故障 worker，标记模型不可用并退化到基础检索。不会每个新词都重启、下载模型；重新准备/预热由明确的模型准备流程完成。队列最多八项，query-vector cache 最多 64 项。

chunk ID、文件、父块和代码关系映射按 revision 准备并复用。基础 postings 分批让出事件循环，旧 warmup 在下一批取消。快速请求仅读取已准备快照；索引未就绪时不把同步 build 包进 Promise 来假装可取消。

应用内导入/清空在原子快照发布时立即发送 sourceEvents，取消旧请求和预取。外部磁盘变化每 2 秒异步检测；发现变化先使旧来源失效，再准备新快照，异常/损坏时保留明确缺口。因此外部修改的发现有至多约一个轮询周期的窗口，不能当作文件系统实时监听。

## 开关与回退

默认启用。可通过已有设置 API 更改，无新增控制台或配置页：

```js
await window.cue.settingsSet({ realtimeEvidencePrefetch: false });
// 恢复
await window.cue.settingsSet({ realtimeEvidencePrefetch: true });
```

也可退出 Cue 后，在实际 userData 的 `cue-data.json` 中设置同名布尔字段。不要在不确定位置时修改另一份用户资料。

关闭后，正式异步路径跳过新来源池读取/预测，保留原有精确预取、基础检索和深度模式；后台使用兼容的 100ms 策略。开关变化清理不兼容任务/缓存。公共的版本映射与 worker 扫描修复不倒退成旧主线程计算。普通回答模式切换取消旧任务，但允许隔离的原文池保留。

## 用户资料与旧格式

每个项目一个目录/ZIP，创建稳定的 `interview/project.md` 项目清单。实现、决策、个人贡献、协作、困难、指标、环境和限制分文件，正文保留完整事实单位，相关源码也导入同一个快照。详细操作见 [资料导入](user-data-import.md)。

最小主题卡片：

```yaml
---
schema_version: 1
project_id: example-project
doc_type: decision
truth_scope: unverified
status: draft
topics: [缓存, 一致性]
aliases: [缓存选型]
---

# 缓存方案的选择与取舍

写明实际约束、采用与备选方案、代价、验证和限制。
确认事实后再按正文范围更改 truth_scope/status。
```

需要关联源码时，添加 `code_refs` 的项目内真实 path/symbol；资料间用 `related_docs`。只有同一快照中存在且成功解析的引用有效，展示名称不能代替真实源码路径。

如果旧 CAE 类资料把 metadata 写在正文的 YAML **代码围栏**中，它仍是普通正文，不会自动成为 front matter。Arclight 类 `RAG_BLOCK_START/END` 标记也不会自动变成来源位置或完整块承诺。可在导入前离线整理成主题 Markdown，保留来源和版本；本改动不自动改写用户的私有资料。扫描 PDF/图片需要文字说明；gold、验收答案、重复导出、Agent 提示词不作为业务证据。

## 诊断与验证

`[latency][prompt]` 的 retrieval 增加 path、poolLookupMs/poolCandidateCount、coveredNeeds/missingNeeds、lexicalMs/retrievalMs、exactPrefetchHit/poolSufficientHit、prefetchAgeMs/prefetchOrigin、semanticWorkerMs 和版本信息。最终窗口删来源会记录 `finalBudgetDroppedSources` 并撤销充分命中。

`[latency][background]` 记录 queued/started/completed/canceled/timedOut/stale 计数；由正式回答触发的准备带同一 requestId，ASR 提交前尚无回答 requestId 时为空。不记录原始对话、完整源码、密钥或隐藏思考。保留供应商事件、正文首字、UI paint ack 和输入预算计时。

```sh
node --test test/realtime-project-evidence.test.js test/realtime-evidence-worker.test.js test/project-embeddings.test.js
node scripts/benchmark-realtime-evidence.cjs --samples 300 --cold-samples 20 --out /tmp/cue-realtime-evidence.json
node scripts/benchmark-realtime-evidence.cjs --samples 300 --cold-samples 20 --sizes 4000,14000 --cpu-contention --out /tmp/cue-realtime-evidence-cpu.json
node scripts/evaluate-rag.js --out /tmp/cue-rag.json
node scripts/semantic-smoke.cjs --runtime-only
npm test
```

Windows 将 `/tmp/...` 改为实际临时路径。在 Windows 上重新执行 `npm ci --include=dev --include=optional`、`npm run dist:win`。打包新增 `src/project-scope.js` 的 ASAR unpack 条目，因为实际 worker 现在需要它；没有新增模型文件、DLL 或第三方包。

离线基准走真实 package entry、规划/检索/预算和 SDK 序列化，但使用固定模型传输，不含真实语音识别、E5 推理、WAN、在线模型或 Windows UI。CPU 竞争为单独 worker 的模拟负载。真实 worker 矩阵扫描、ASAR 依赖和原生 ONNX 小算子另测，不能等同于真实 E5 中文检索质量。

结果与原始样本见 [验证报告](benchmarks/realtime-evidence-2026-10-21.md)。基准不自动下载模型；已有本地模型可按 `evaluate-rag.js --semantic --model-dir ...` 另测。没有用户模型密钥、Windows 机器、实际 ASR 和私有项目资料，本次不能承诺把真实首字从 5–7 秒降到某个固定值。
