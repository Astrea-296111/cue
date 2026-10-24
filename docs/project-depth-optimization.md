# 真实项目深挖与个人资料测试

默认测试已精简为显式核心清单，见 [关键回归范围](essential-testing.md)。日常只执行材料、文本问答、项目切换、请求预算、provider 流式协议、报告保护和基本窗口保护；不会再逐个按钮、快捷键、缩放、语音格式测试。深挖题按需要运行，不作为每次修改必跑的几十次付费调用。

## 真实源码

`materials/projects/cae/` 和 `materials/projects/arclight/` 保留公开仓库的原始路径、字节与提交来源。`materials/source-lock.json` 记录每个文件的 Git blob、SHA-256、是否索引及排除原因。源码同步只读取 Git 对象，不执行上游代码。

当前 CAE 固定 `c50dd29d1b1981e299d2ce4821e0a1ef745aa48e`，Arclight 固定 `528704eb373f637830640b3fefcc5cbc95f23a78`；343 个文件形成 2,453 个片段，保留完整父块，无截断。排除测试和演示数据、依赖/构建物、敏感路径和锁文件。一个极短的 Python 包文件保留快照但不索引。两仓库没有 LICENSE 文件，锁文件明确记录该状态，没有自行编造许可。

```sh
npm run sync:sources       # 检查公开性、获取 origin/main 并更新固定清单
npm run compile:materials  # 使用同一导入器编译随包发布的源码索引
```

扫描和索引准备发生在导入/启动阶段。极速首问只查询已准备的内存 posting 索引，最多 64 个查询词、4,096 次 posting 访问和 8 个候选，不发 embedding 请求，也不读磁盘重建索引。关闭源码时不执行查询。长问题保留完整原文，按实际子问分配有限的事实与实现证据；代码中的职责不能作为个人职责的证明。

`materials/navigation.json` 额外维护功能到真实代码符号的导航，例如提交、资源释放、租约确认、会话恢复。构建时核对清单摘要、上游版本、实际路径与符号，缺失或过期即失败。关键词仅帮助检索，发送给模型的仍是可核对的原始源码；导航本身不证明任何实现保证。复合实现题优先保留两个不同代码文件，再填充补充事实，所有内容仍受来源数、token 与模型窗口限制。标准模式使用同一已选证据预算，避免旧字符限制再次裁掉尾部代码。

## 本地个人工作区

真实简历、事实包与 JD 存在 Git 忽略的 `.cue-private/`，不会进入公开 CI 样本、源码清单或默认安装包。本轮 PDF 使用应用现有解析器转换，109 张事实卡保持来源和状态；简历中 CAE 为第一项目、Arclight 为第二项目。

```sh
npm run prepare:personal -- --resume /path/resume.pdf --facts /path/facts.json --jd /path/jd.txt
npm run start:personal
```

启动个人模式先加载公开源码包，再通过统一材料服务安装本地 `workspace.json` 的事实、简历与 JD。只在该工作区版本变动时安装；后续用户在设置中编辑的简历、JD 不会在每次重启时被覆盖。运行时密钥不接受从个人工作区导入。

## 场景与模型反馈

[12 道固定深挖题](../evaluation/deep-projects/README.md)覆盖提交身份、Outbox/Inbox、未知状态与资源安全、报告版本、鉴权、上下文恢复、并发文件存储和跨项目比较。Smoke 为 6 题，其中两题超过 1,600 汉字；题目借鉴公开设计资料并依据真实源码编写，没有冒充网上面试原题。事实检查与语言观察分开，同义表达未被规则识别时标记待复核。

个人资料可本地执行：

```sh
node scripts/evaluate-private-projects.cjs --payload .cue-private/evaluation-payload.json --mode deep --provider all --mock --output-dir .cue-private/reports/mock
# 提供环境中的真实 provider 配置后去掉 --mock。
```

Mock 仅验证材料、路由和实际发送的证据，不评判模型质量。真正的准确性和延迟必须查看真实回答、usage、首正文和完成耗时。场景中的源码边界固定：SharedTaskStore 没有跨进程锁/CAS，Mailbox 没有事务 ACK；建议方案不能说成当前已实现。

## GitHub 私有真实评测

`project-deep-live.yml` 仅从可信 main 手动触发，凭据只注入评测步骤。工作流创建短期 RSA 公钥会话，Codex 将个人输入以 AES-GCM 加密并绑定 run、attempt 和代码 SHA，放入专用 `cue-evaluation-inputs` 分支；该分支的数据不会被检出或执行。完整报告以另一把派生密钥加密上传，公开 Summary 仅包含状态、型号、调用数及延迟汇总。临时明文与会话私钥在结束时清理。

```sh
gh workflow run project-deep-live.yml --ref main -f mode=smoke -f provider=all
# 获取该 run 的 private-session-RUN_ID-ATTEMPT artifact 后：
node scripts/private-live-session.cjs encrypt --session SESSION/session.json --payload .cue-private/evaluation-payload.json --key-file SESSION/key.json --output SESSION/input.encrypted.json
# Codex 将密文上传到 cue-evaluation-inputs/RUN_ID.json；评测等待最多180秒。
gh run download RUN_ID --dir .cue-private/download-RUN_ID
node scripts/private-live-session.cjs decrypt --session SESSION/session.json --key-file SESSION/key.json --envelope DOWNLOAD/report.encrypted.json --output-dir .cue-private/reports/RUN_ID
```

保留本地 key 文件才能解密报告；不要上传它。通常型号读取 `QWEN_MODEL`、`DEEPSEEK_MODEL`，也兼容 `_MODEL_ID` 别名。只有显式指定 `discover_models=true` 才会在型号缺失时各请求一次模型目录，从实际存在的快速文本型号中选择；不猜测型号。每模型最多 12 次推理，总计 24 次，输出最多 1,800 token，不自动重试，首正文/总时限默认 10/30 秒。

本轮不测录音通道；Electron 虚拟显示、Mock、真实 API 与真实 Windows 物理设备验收分别记录。

首轮[真实双模型 smoke](https://github.com/Astrea-296111/cue/actions/runs/40072205570)使用 `qwen3.8-flash` 与 `deepseek-flash`，12次外部调用全部完成、无超时，首正文 P50/P95 为959/1448ms。该轮整体失败：六条CAE结果缺少必要实现来源，人工审查还发现把PID校验当作fencing、以局部幂等推导全链路保证的风险。后续按这些回答修正来源分配、字符/token预算和两模式共用的证据边界规则；未将该轮记为质量通过。完整回答为加密artifact，解密文件仅在个人工作区。

修复后的[完整双模型评测](https://github.com/Astrea-296111/cue/actions/runs/40074502603)完成24次真实调用，24/24确定性断言通过，0超时、0调用失败，包含两道超过1600汉字的场景题。Qwen首正文P50/P95为1112/2175ms，DeepSeek为864/1081ms；两者合计本地准备P50/P95为75/180ms。完整响应P50分别为8445/3868ms，用户可在首正文到达时开始阅读流式回答。它是本轮样本，不是服务延迟保证。

有2条内容覆盖提示需要人工判断：DeepSeek跨项目题给出了中断后恢复并检查消息链的具体验收，属于同义表达；Qwen长场景题没有把主动查询路径说清，后续将导航指向实际 `reconcile` 方法并明确要求说明核验动作。没有把内容提示包装成自动事实证明。公开的[汇总JSON](benchmarks/project-depth-2026-10-24.json)仅保留计数、版本、usage和时延，不含私人材料和回答正文。
