# GitHub 端到端测试与真实模型报告

常规 PR 和 `main`/`codex/**` 推送继续运行原有 `CI`，另有 `Offline end-to-end` 检查实际应用编排及 Electron 界面。这些检查不读取模型密钥。Mock 只验证材料导入、证据传递、会话状态和报告链路，不能证明真实模型回答质量。

## 启用真实 API

在仓库 Settings → Secrets and variables → Actions 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `QWEN_API_KEY` | Qwen 凭据 |
| Secret | `DEEPSEEK_API_KEY` | DeepSeek 凭据 |
| Variable | `QWEN_MODEL` | 实际可用的 Qwen 模型 ID |
| Variable | `QWEN_BASE_URL` | HTTPS OpenAI 兼容 API 根地址，通常包含 `/v1` |
| Variable | `DEEPSEEK_MODEL` | 实际可用的 DeepSeek 模型 ID |
| Variable | `DEEPSEEK_BASE_URL` | HTTPS OpenAI 兼容 API 根地址 |
| Variable（可选） | `CUE_LLM_LIVE_ON_PUSH` | 设为 `true` 后，每次可信 `main` 推送自动执行双模型 smoke；默认只手动执行 |

模型 ID 及地区端点由账号权限决定，不在代码中假定可用型号。请求的任一 provider 缺少 key、model、base URL，或连接失败，都应使在线运行失败并生成失败报告。

```sh
gh workflow run llm-live.yml --ref main -f mode=smoke -f provider=all
gh run list --workflow llm-live.yml --limit 5
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log-failed
gh run download RUN_ID --dir artifacts/run-RUN_ID
```

可以把 Run 链接交给 Codex，要求其分析失败问题、完整回答和对应证据后修复。读取日志与 artifact 需要相应仓库/Actions 权限；触发 workflow 还需要 Actions 写权限。权限不足不会被解释为测试通过。

`llm-live.yml` 不监听 PR，不使用 `pull_request_target`；手动运行也必须选择 `main`。它先检查可信分支，再检出事件的固定 SHA。凭据仅传给真实评测步骤，不传给依赖安装、普通测试或 artifact 上传。工作流排队执行，不并发叠加付费请求。

## 本地复现与成本

```sh
npm ci
npm test
npm run test:llm:mock -- --mode full --provider all
# 六个配置通过进程环境提供，避免把 key 写入命令、配置文件或日志。
npm run test:llm:live -- --mode smoke --provider all
# Linux 图形测试；真实录音设备不在本轮测试范围。
xvfb-run -a npm run test:ui -- --no-sandbox
```

默认 smoke 每模型 6 题，full 每模型 24 题；提供 Qwen、DeepSeek 或 all。请求无自动重试，默认首个有效正文上限 10 秒、单题总时限 30 秒、输出最多 1800 token；还有请求总数硬上限。单次双模型 full 最多 48 题，评测步骤上限 26 分钟，工作流总时限 35 分钟并为失败报告上传预留时间。CLI `--help` 列出可用参数和硬限制。输入 token 数由真实选中证据决定，报告中的 usage 仅记录 API 实际返回值，不用字符数伪造。

## 样本、报告与质量边界

`evaluation/cue-live/` 保存 24 题固定评测集、公开技术材料、明确标注的合成人物简历和文件 hash 白名单。`approval.json` 明确批准这些材料用于 CI 和公开回答 artifact。修改样本必须同步审核白名单；真实私人简历或项目经历不能直接复制到公开评测目录。评测材料不会作为默认个人资料随桌面应用发布。

默认输出 `artifacts/llm-live/report.json`、`report.md`，包括完整回答、问题/项目/模型、实际发给 SDK 的事实和源码片段 ID、正文 TTFT、总耗时、实际 usage、错误及质量结果。GitHub Job Summary 展示报告，失败时也上传已有报告，artifact 保留 14 天。报告另列生产链路相关代码位置，便于定位。

事实检查使用预先固定的必要事实、同义表达组、跨项目证据与明确禁止的错误断言。必要内容没有匹配到时标为 `needs-review`，单独统计遗漏，不能把任意非空回答当作质量通过；有效改写可以人工复核。语言流畅度等只给出非阻断观察。它不是穷尽的幻觉检测器，也没有未经校准的 LLM 裁判。Mock 的质量观察不计为真实模型质量得分。报告另列 TTFT P50/P95、端到端延迟、超时率及失败率；空白、reasoning 内容不算有效正文。

## 后续提供真实资料

桌面分发资料的入口是 `materials/`，操作格式见其 README。项目事实、源码快照和简历经过构建编译后放入 `materials/bundle.json`，随应用发布并由材料服务在启动时安装；用户本地岗位 JD 保留。该目录和公开 CI 评测目录是两个不同用途，是否公开分发需要在清单中明确声明。

## 验证结果的含义

| 验证 | 可以确认 |
| --- | --- |
| Node 单元测试 / Mock 端到端 | 软件逻辑、材料与会话编排、预算和报告处理 |
| 真实 Qwen / DeepSeek API | 当次模型的流式正文、事实检查、usage 和延迟 |
| Electron + Xvfb / 虚拟设备 | 导入弹窗、索引显示、聊天渲染、错误提示 |
| 真实 Windows 人工验收 | 实体设备的录音权限、系统音频与捕获保护等硬件/系统行为 |

前三类通过不能替代最后一类。在线未执行或失败时，必须保留该状态，不能用 Mock 通过替代。
