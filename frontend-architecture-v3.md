# Windup 前端粗架构

## 本 PR 的目标

本 PR 只确定粗粒度模块、公开接口和必要类型。具体目录细分、服务端调用、流程状态转换、生成处理、页面交互、测试和工程配置分别由后续小 PR 实现。

## 依赖方向

```text
app -> pages -> features -> workflow-controller / entities -> shared
```

- `app`：启动、路由、布局。
- `pages`：路由页面和模块组合。
- `features`：角色设置、生成、审核、导出。
- `workflow-controller`：Quick Start 与 Workflow Editor 共享的整体流程接口。
- `entities`：业务数据及其服务端 APIs。
- `shared`：不理解 Windup 业务语义的通用 UI、Hooks、工具与配置边界。

`shared` 只能被上层依赖，不能反向导入任何 Entity 或业务模块。当前没有需要沉淀的
公共实现，因此只保留职责说明，不为了目录完整度制造空工具代码。

## 两种制作方式

Quick Start 使用自然语言和参考图直接表达目标，自动流程隐藏内部步骤；Workflow Editor 让用户逐步操作。两者页面和显示内容完全不同，但共享 WorkflowRun、WorkflowStep 和 Workflow Controller 接口。

## Workflow 边界

Workflow Controller 负责维护步骤数据、当前步骤、历史 Revision 和流程推进。每个 Revision 通过 `currentStepId` 明确指向当前步骤；服务端异步结果携带发起请求时的 `revisionId`，防止重启后的旧结果串入新版本。需要服务端结果的步骤由 Controller 调用相应业务 APIs，并把返回结果更新到 WorkflowStep。WorkflowRun 作为业务资源由服务端持久化。

Controller 是一个整体，不把推进、重启、中断、恢复或服务端结果处理拆成独立模块。

## 多方向资产

Project 通过 `DirectionMode` 决定单方向、四方向或八方向。`BaseFrame` 使用
`SpriteDirection` 标注方向，Action 使用 `ActionSequence[]` 保存各方向的帧序列，
不依赖隐含的数组顺序猜测方向。

## Generation 边界

前端接触的是 Generation 和 Task 业务记录：创建记录、查询状态、展示结果，并据此更新 WorkflowStep。真正的模型调用发生在后端，前端不表达模型能力层。

## 当前未冻结

- 服务端 URL、DTO 外壳、认证和错误格式。
- 图片上传方法和媒体引用形式。
- 审核、导出和事件传输方法。
- Workflow Controller 的具体状态转换实现。
