# 前端模块

## app

只负责启动、路由和全局布局。它不构造业务服务，也不决定 Workflow 如何推进。本 PR 保留 `src/app/README.md` 固定边界，不提交 app 运行实现。

## pages

页面是路由入口，负责组合粗粒度 Feature。Quick Start 与 Workflow Editor 是两个独立页面；Playtest 是只读核验入口。本 PR 保留 `src/pages/README.md` 固定边界，不提交页面运行实现。

## features

- `character-setup`：角色资料、造型、动作定义与参考素材。
- `generation`：创建和展示 Generation 业务记录。
- `review`：查看生成结果并形成审核结论。
- `export`：展示导出条件、配置与结果。

当前不继续拆分 Feature 内部目录。
本 PR 保留 `src/features/README.md` 固定边界，不提交 Feature 实现或占位组件。

## workflow-controller

维护同一份 WorkflowRun/WorkflowStep 数据，对外提供创建、推进、更新、重启、中断、恢复和接收服务端结果的方法。当前只声明整体接口，不提交状态转换和服务端调用实现。

## entities

业务实体按规模就近维护，通常使用：

- `types.ts`：数据结构。
- `apis.ts`：该业务资源对应的服务端方法集合。
- `index.ts`：唯一公开入口。

内容较少的实体可以直接在 `index.ts` 中声明类型和 APIs，避免为了形式增加空文件。

Generation 和 Task 是前端可见的业务数据。后端如何调用图像模型不属于前端模块。

## shared

`shared` 是无业务含义的公共基础层，可以在出现真实需求后承载通用 UI、Hooks、纯
工具和配置读取。它不能依赖任何上层模块，也不能保存 Entity、业务 APIs 或
Workflow 规则。当前用 `shared/README.md` 固定边界，不提前创建空子目录和占位实现。
