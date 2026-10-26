# CUE 公开评测索引

题目、答案、最终SDK请求、实际证据、裁判输入/原文/结论均以UTF-8明文存放，不需要解密。

- [41个历史回放点](cases/interview-2026-10-26.json)：旧建议只给裁判，禁止给被测模型或读取未来发言。
- [原始面试TXT](cases/original-interview-2026-10-26.txt)
- [26个冻结题（其中2题烟测后归开发回归，24题保持未见）](cases/unseen-2026-10-26.json)：首次运行后归入已见回归集。
- [129卡工作区](../materials/personal/workspace.json)

运行：`node scripts/eval-public.cjs --phase smoke --provider all --run-id <新ID>`；12条烟测通过人工检查后运行`--phase full`生成268条（至少260条），再用`--phase baseline --target-root <基线源码目录>`在同模型同资料下对比67题。`--phase material-control`以同新代码、同模型、同问题对比仓库旧公开事实包（并不冒充丢失的194卡）；`--phase multiturn`另外运行六组真正共享会话的跨模式/跨话题测试。冷会话与热会话结果分别记录。baseline使用原生产链路，没有三域IPC；当前题目的显式项目域会对应旧`currentProjectId`。

配置来源：已有`QWEN_API_KEY`/`DEEPSEEK_API_KEY` Secrets以及对应`*_MODEL`/`*_BASE_URL`变量。未配置model时请求官方`/models`并按现有发现策略选择可用快速模型，选中的精确ID写入报告。认证配置缺失会记录失败，不用Mock冒充真实验收。

每个`runs/<run-id>/<phase>/<provider>/<case-id>-rN/`包含`request.json`、`answer.txt`、`trace.json`、`judge.json`。逐条检查点即时保存。恢复只补未完成裁判；已发出而结果未知的生成标记interrupted，不重生成筛选。重新生成必须换run-id，失败原件保留。

默认公开工作流仅允许可信main手工调度。生成和裁判的调用分别记账。离线Mock只证明链路，不能证明质量；两轮重复不代表置信区间。Windows麦克风、声卡和真实音频延迟未由文本回放验证。旧密文工具仅用于历史兼容，不是本轮公开入口。

- [oct26-smoke-01 / smoke](runs/oct26-smoke-01/smoke/report.md)

- [oct26-smoke-02 / smoke](runs/oct26-smoke-02/smoke/report.md)

- [oct26-smoke02-judge-v3 / rejudge](runs/oct26-smoke02-judge-v3/rejudge/report.md)

- [oct26-smoke02-judge-final / rejudge](runs/oct26-smoke02-judge-final/rejudge/report.md)

- [oct26-full-final / full](runs/oct26-full-final/full/report.md)

- [oct26-baseline-final / baseline](runs/oct26-baseline-final/baseline/report.md)

- [oct26-smoke-source-final / smoke](runs/oct26-smoke-source-final/smoke/report.md)

- [同材料代码基线逐题对照](before-after-code.md)
- [首轮268条中的152条逐条审阅](runs/oct26-full-final/full/codex-review.md)

- [oct26-smoke-acceptance / smoke](runs/oct26-smoke-acceptance/smoke/report.md)

- [oct26-latest-final / latest](runs/oct26-latest-final/latest/report.md)

- [oct26-replay-canonical / replay](runs/oct26-replay-canonical/replay/report.md)

- [oct26-smoke-v2 / smoke](runs/oct26-smoke-v2/smoke/report.md)

- [oct26-latest-v2 / latest](runs/oct26-latest-v2/latest/report.md)

- [oct26-latest-v3 / latest](runs/oct26-latest-v3/latest/report.md)

- [oct26-smoke-v3 / smoke](runs/oct26-smoke-v3/smoke/report.md)

- [oct26-latest-v4 / latest](runs/oct26-latest-v4/latest/report.md)

- [oct26-smoke-v4 / smoke](runs/oct26-smoke-v4/smoke/report.md)
