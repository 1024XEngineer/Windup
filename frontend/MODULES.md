# Windup 前端模块契约

完整架构以根目录 frontend-architecture-v3.md 为准；本文只记录代码模块的公开边界。

## 分层

~~~text
app -> pages -> features -> entities -> shared
~~~

代码只能向下依赖。Page、Feature、Entity 不直接调用 fetch，所有网络能力经
shared/api 的 request、upload 或 stream 边界访问。

## entities

entities 是对外统一的数据门面，调用方使用：

~~~ts
import { createWorkflowRun, getCurrentRevision } from '@/entities'
~~~

Project、Character、ActionTemplate、Wearable 和 WorkflowRun 是内部业务分区。外部不得绕过
@/entities 访问内部文件；Entity 之间默认不产生运行时依赖，关系通过 ID、类型契约或输入对象表达。

WorkflowRun 的领域模型包含：

- 一个 runId。
- 多个只读/当前 Revision。
- 当前先固定五个有序节点：asset、generation、candidate、review、export。
- 节点门禁、Revision 重启、历史查看和质量门禁 selector/command。

## 页面内模块

### Workflow Editor

入口：pages/workflow-editor/editor/index.tsx。

它只接收已解析的 run、revision 和节点类型，不读取 Router。外层 Page 负责：

- 读取 runId、节点路径和 revision query。
- 未解锁节点的重定向。
- 当前/历史只读模式。
- 跨页跳转到 Playtest。

### Playtest

入口：pages/playtest/inspection-preview/index.tsx。

Playtest 是独立核验台 Page，不是通用 Feature。它接收完整生成 Revision，保存独立核验结论，
问题可以回流 Review，但不会阻断导出。

## Features

Feature 表示用户操作，Feature 之间不互相 import。当前真实实现仍按功能增量推进；规划子目录使用
README 说明职责，未实现能力不得返回假成功。

## Shared

- shared/api：传输、响应壳、错误、上传和流式任务。
- shared/api/generated：未来 OpenAPI 生成代码的接入位置，当前不放伪代码。
- shared/ui：业务无关 UI；只维护已经存在的组件。
- shared/lib：通用工具和异步状态抽象。
- shared/testing：仅测试代码使用，生产代码不得导入。

## 测试

架构测试检查分层、公开入口、Router 隔离、直接网络请求、测试依赖和循环依赖；
WorkflowRun 单元/集成测试检查 Revision、节点重启、质量门禁、历史和 Playtest 导入规则。
