# 中文合成语音识别测试

音频为 eSpeak NG 合成的虚构中文订单场景，不含用户面试录音。[样例说明](../../../test/fixtures/dual-audio/README.md)列出原文、生成方式和测试边界。执行使用 GitHub Actions 中已有的 Qwen ASR 凭据，通过真实生产 PCM、VAD、云端 ASR 和问题解析器；不调用文本模型，也未测试物理麦克风或声卡。

## 连续场景

[运行 40496341440](https://github.com/Astrea-296111/cue/actions/runs/40496341440)，构建 `65c85f5cccce7ae7fb5653e2834161d70479f609`，将三段样例以 0.8 秒间隔拼成 22.1 秒音频。识别出的三个 final 片段分别包含订单系统及每秒一万次请求、数据库容量有限且不能重复创建订单、服务宕机时的数据可靠性和恢复问题。六项语义检查均出现在识别结果和最终待答目标中，测试通过；[原始报告](continuous-report.json)保留识别文本、完整目标、语音事件及各项检查。仅此一个合成声音和场景，不能推断真实会议的识别率。

## 分段实验与限制

- [运行 40495368049](https://github.com/Astrea-296111/cue/actions/runs/40495368049)：前三段均有 final，前置条件保留，但第三段的“如何恢复”未出现在收集到的 final 中，未通过；[报告](initial-report.json)。该次观察窗口较短，不能排除较晚结果未收集。
- [运行 40495677457](https://github.com/Astrea-296111/cue/actions/runs/40495677457)：延长 final 观察时间后，第三段未收到 final，未通过；[报告](second-report.json)。观察期未持续输入音频。
- [运行 40496013006](https://github.com/Astrea-296111/cue/actions/runs/40496013006)：观察期持续输入静音，第三段仍未收到识别事件，且在结束采集前观察到 `them` 通道的 `finished` 状态；[报告](third-report.json)。原因尚未确定，不能据此断言某一网络或服务故障。该实验不证明持续监听数分钟可靠，也不能用连续样例的通过替代。

此前 [运行 40495107732](https://github.com/Astrea-296111/cue/actions/runs/40495107732) 在 `23706cf` 上通过英文合成双声道、云 ASR 到真实文本模型的提前触发检查；其结果和中文场景属于不同测试。
