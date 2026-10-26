# MCP工具怎么进入Arclight？

1. 包装：MCP工具加服务名前缀并延迟加载，对模型保留服务端完整inputSchema；本地工具的Schema才由其Pydantic模型生成。
2. 执行：包装器按顶层属性构造Pydantic参数模型，再交给MCP客户端；默认可能类型转换，没有完整实现所有嵌套JSON Schema约束。连接或调用异常返回is_error错误结果。

- 固定源码版本核查，不证明个人独立开发或本次运行过该项目。
- 不可说MCP原始Schema全部由Pydantic重新生成。
- 未设置strict，不能声称完全严格校验、拒绝所有隐式类型转换。

- [mewcode/mcp/tool_wrapper.py#class MCPToolWrapper](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/mcp/tool_wrapper.py) · SHA256 10013fbe64ba819e3f8049c59ab9ec338a413544c2ac20bbcbd99960b7fafaac
- [mewcode/tools/base.py#class Tool](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/tools/base.py) · SHA256 96348ceeec7b9a641f8077197853a59aeba13b83a961a4e949f4fbd64f0f18e9
