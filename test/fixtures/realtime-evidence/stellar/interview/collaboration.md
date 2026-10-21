---
schema_version: 1
project_id: synthetic-stellar
doc_type: collaboration
truth_scope: implemented
status: confirmed
topics: ["缓存", "协作"]
---
# 星桥调度协作与联调

STELLAR_COLLABORATION：团队分工中我负责 Java 缓存接口，另一位合成成员负责 Python 数据处理。双方用 JSON 契约约定 requestId、version 和 errorCode，协议变更先更新契约，再通过双方联调测试验证超时与错误码。
