# ToolSearch怎么按需加载？

1. 入口：ToolSearch常驻，支持关键词，也支持select:加工具名；命中后返回完整Schema并标记discovered。
2. 匹配：search_deferred将查询、名称和描述转小写，按整串子串与空白拆词命中加权排序，截取max_results。不是向量/BM25，也不是只做完全相等匹配；没有中文语义分词。

核查：mewcode/tools/__init__.py#def search_deferred( @ 528704eb373f637830640b3fefcc5cbc95f23a78
SHA256 d7a21e3a5d4f725f6b225316bba90b883393832f2f72180465476a863e5acb7b
