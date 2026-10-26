# Arclight长期记忆存什么，何时更新？

1. 内容：MemoryManager从新增对话提取用户编码偏好、纠正反馈、项目知识和参考资料，去重后分别写用户级和项目级memories.md。
2. 时机：主Agent每5轮触发后台提取，也有手动入口；不是按固定秒数更新，不是购物地址或电商偏好数据库。读取时还存在按需召回独立memory目录Markdown的路径。

- 固定源码版本核查，不证明个人独立开发或本次运行过该项目。
- 当前核查的是文件记忆与召回，不证明已建知识图谱、向量数据库或长期用户画像。

- [mewcode/memory/auto_memory.py#class MemoryManager](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/memory/auto_memory.py) · SHA256 30120032b0030d1eda03489623e9ec4266706d1584d15845f615872bf6dbdde8
- [mewcode/agent.py#MEMORY_EXTRACTION_INTERVAL](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/agent.py) · SHA256 f10b4d1cc2911462d0f11f571973e650a5c92291aac447f56ce0f2d8470a4968
- [mewcode/memory/recall.py#find_relevant_memories](https://github.com/Astrea-296111/Arclight/blob/528704eb373f637830640b3fefcc5cbc95f23a78/mewcode/memory/recall.py) · SHA256 4830e291e0aed2ffadfd4ec7d54198975044ae86041d62eee0ee996b12fdb7bd
