---
schema_version: 1
project_id: synthetic-tide
doc_type: environment
truth_scope: implemented
status: confirmed
topics:
  - 环境
  - 版本
  - 进程
  - 部署
---

# 潮汐预约可运行环境

演示使用 Java 17、MySQL 8、Redis 7、RabbitMQ 3；Compose 启动一个 Java 进程，所有组件位于同一台开发机。

## 进程边界

RabbitMQ 消费者在 Java 中运行，Java 调用通知适配器；没有 Python 直接消费消息的实现。三个容器不能称为三台物理服务器。
