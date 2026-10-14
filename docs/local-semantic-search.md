# 本地语义检索

Cue 的基础检索不需要模型、网络或额外服务。语义检索是可选功能，只在项目作用域内补充候选，不会单独调用在线 LLM，也不会覆盖项目事实的真实性判断。

在资料设置中点击“准备本地语义检索”，才会首次下载 `Xenova/multilingual-e5-small` 的 q8 ONNX 权重。准备时从官方模型服务读取确切 commit，把 revision、权重的官方 LFS SHA256、tokenizer 和配置文件的 SHA256 写入 `cue-model-manifest.json`。以后复用此版本，不随 `main` 变化自动更新。回答、预取和推理 worker 都不会下载模型。

下载使用 Electron 的系统代理设置，版本清单请求限时 20 秒，单个文件总时限 15 分钟，连续 30 秒没有进度则停止。重复点击准备会合并到同一个任务，不会同时改写模型选择指针。任何失败都保留基础检索，并且不发布未下载完成的目录。

依赖固定为 `@huggingface/transformers@3.8.1` 和 lockfile 中的 `onnxruntime-node@1.21.0`。模型使用 384 维、mean pooling、L2 normalize，以及 `query: ` / `passage: ` 前缀。模型自身的 tokenizer 将长材料拆成最多 300 个正文 token 的检索片段；前缀和特殊 token 一同计入 512 上限。命中的片段映射回原始材料，不把 tokenizer 解码文本当作代码原文。

模型放在 Electron `userData/project-semantic/models`，项目向量放在同级 `vectors`。选择本地目录时，该目录需要包含准备动作生成的 `cue-model-manifest.json` 和所有原文件；应用会重新校验，避免把不明模型或损坏文件当作已就绪模型。可从另一台已经准备好的设备复制整个 `e5-<revision>-q8` 目录，再选择此目录。

准备失败、尚未预热、索引生成中、超时、worker 失败或版本改变时，Cue 自动使用基础检索，并显示原因。Ctrl+Enter 默认最多等候已经预热的语义结果 100ms；超时会取消队列任务，已经开始的 native ONNX 调用会丢弃迟到结果，不更新本轮 prompt。

推理在独立 worker 中执行，native ONNX 的线程数固定为 1。导入时分批生成向量，保留未变文本的向量，删除已删除文本对应的向量。元数据和连续 Float32 矩阵先写入新的完整目录，再原子发布指针；导入和清空会立即使旧快照失效。chunker、parser、元数据 schema、模型、tokenizer 或 dtype 改变时不复用不兼容的向量。

## 本地检查

以下检查不下载模型：

```sh
node --test test/project-embeddings.test.js
npm run test:semantic:runtime
npm run test:semantic -- --model-dir=/path/to/e5-<revision>-q8 --data-dir=/tmp/cue-semantic-check
```

明确请求下载并验证模型：

```sh
npm run test:semantic -- --prepare --data-dir=/path/to/temporary-semantic-data
```

runtime 检查使用 Microsoft ONNX Runtime 1.21.0 发布目录中的 130 字节 multiply 测试模型（MIT）：`onnxruntime/test/testdata/mul_1.onnx`，SHA256 为 `71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10`。它验证实际 native 推理与 worker，不能代表 E5 语义准确率。E5 smoke 必须拥有真正准备好的权重，输出确切版本和实测延迟，不使用模拟向量声称模型效果。

## 故障处理和隐私

- 下载 HTTP 403：模型域名被当前网络拒绝；保持基础检索可用，在可访问官方模型服务的网络准备，或复制已校验的离线目录。不要关闭 TLS 或跳过校验。
- 文件校验失败：文件已损坏或被替换，重新准备模型；不要编辑清单去迁就损坏文件。
- 模型加载失败：查看设置中的原因。发布包需要包含 worker、Transformers.js 及 unpack 后的 ONNX native 依赖；不同平台必须单独验证。
- 跨系统打包：Sharp 的可选运行库跟随安装系统，Linux 的 npm ci 不会安装 Windows 原生库。优先在目标系统构建；打包前会检查目标架构的 Sharp、libvips 和 ONNX 文件，缺失即停止。跨系统构建须安装 lockfile 中目标平台的可选依赖，不能用 Linux 运行库替代 Windows DLL。
- 向量索引未就绪：等待导入后的后台处理。不存在模型时不会触发自动下载，基础检索立即可用。

本地模型和向量不离开设备。最终回答仍会把选中的原始证据发给用户配置的 LLM；导入代码和资料前应自行排除不愿发送的内容。清空项目使其检索失效；模型作为可复用工具保留。要彻底删除模型与向量，可退出 Cue 后删除 `project-semantic` 目录。

技术依据：官方 [Node/CommonJS 教程](https://github.com/huggingface/transformers.js/blob/3.8.1/docs/source/tutorials/node.md)、[dtype 说明](https://github.com/huggingface/transformers.js/blob/3.8.1/docs/source/guides/dtypes.md)、[Electron 示例](https://github.com/huggingface/transformers.js/tree/3.8.1/examples/electron)及 [E5 模型说明](https://huggingface.co/intfloat/multilingual-e5-small)。
