# Arclight校验错误和工具异常放在哪里，谁决定下一步？

1. 返回：Agent在执行路径捕获Pydantic ValidationError和工具异常，包装成ToolResult(output,is_error=True)；MCP调用也把连接、调用失败转成错误结果。
2. 后续：工具结果回到对话，模型再决定修参或换工具，运行时另有未知工具连续失败保护。当前源码未提供统一业务错误码枚举中心，不能编造USER_NOT_FOUND映射和错误审计库。

- 固定源码版本核查，不证明个人独立开发或本次运行过该项目。
- ToolResult不是统一持久化错误码数据库；新增错误分类、纠错策略或审计中心只能说建议设计。

- [mewcode/agent.py#params_model.model_validate](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/agent.py) · SHA256 f10b4d1cc2911462d0f11f571973e650a5c92291aac447f56ce0f2d8470a4968
- [mewcode/tools/base.py#class ToolResult](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/tools/base.py) · SHA256 96348ceeec7b9a641f8077197853a59aeba13b83a961a4e949f4fbd64f0f18e9
- [mewcode/mcp/tool_wrapper.py#async def execute](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/mcp/tool_wrapper.py) · SHA256 10013fbe64ba819e3f8049c59ab9ec338a413544c2ac20bbcbd99960b7fafaac
