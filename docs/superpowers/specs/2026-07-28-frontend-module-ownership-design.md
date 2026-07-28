# 前端模块归属修正设计

## 目标

Windup 前端按职责组织代码，而不是照搬后端模块名称。此次修正新增明确的前端 `capabilities`
层，并迁移当前四处错误归属：图片生成、图片上传、异步任务和 Provider Session。

此次只调整前端代码、前端测试和前端文档。后端仅作为外部契约来源，不修改后端代码，不描述
后端内部实现，也不猜测尚未冻结的端点或 DTO。

## 分层

修正后的依赖方向为：

```text
app -> pages -> features -> capabilities -> entities -> shared
```

各层职责：

- `app`：路由、全局错误边界，以及 Real/Mock Adapter 的最终组合。
- `pages`：路由页面和页面级协调。
- `features`：用户可触发的操作与 UI 流程，如 Quick Start、生成面板、审核和导出。
- `capabilities`：前端调用外部能力的稳定业务 Port、服务和 Adapter，不包含页面 UI。
- `entities`：拥有独立身份、状态或生命周期的前端领域对象及其查询、命令和 Repository。
- `shared`：无业务归属的 HTTP、上传、流式传输、通用 Hook、UI 和测试辅助。

代码只能向右依赖。`features` 可以同时使用 Capability 和 Entity；Capability 可以使用 Entity 类型
与 shared transport；Entity 不得反向依赖 Capability。

Capability 之间与 Feature 之间一样保持 Slice 隔离。跨层调用只能进入目标 Slice 的公开
`index.ts`，例如 `@/capabilities/image-generation`，不能直接导入其内部 Adapter。

## 归属判断

判断一个概念放在哪里时使用以下顺序：

1. 有独立 ID、状态、可查询快照或生命周期的数据，属于 Entity。
2. “执行某件事并等待结果”的可调用边界，属于 Capability。
3. 用户操作、页面交互和流程控制，属于 Feature。
4. Real/Mock 的最终选择，属于 app 组合入口。
5. HTTP、multipart、SSE 等通用协议处理，属于 shared。

因此，未来若后端返回拥有 ID 和状态的 `GenerationJob`，它可以成为 Entity；但
`generateImages()` 始终是 Capability。后端模块名本身不能决定前端目录。

## 四处迁移

### 图片生成

将 `entities/generation` 迁移为 `capabilities/image-generation`。保留现有 Promise 形式的
`ImageGenerationPort`、业务输入/输出和服务工厂，但不再从 `@/entities` 导出。

后端 Generation 路径和 DTO 尚未冻结，因此本次仍不创建虚假的 Real Adapter。调用方以后只从
`@/capabilities/image-generation` 使用公开接口。

### 图片上传

将 `entities/project/api.ts` 中的 `uploadImage` 迁移为
`capabilities/image-upload`。Project Entity 只保留 Project CRUD 和 Project DTO 映射。

图片上传已有确定的 `/upload/image` 契约，因此该 Capability 包含：

- `ImageUploadPort`：接收 `File`，异步返回图片 URL。
- `createImageUploadService`：显式注入 Adapter，并在生产 runtime 拒绝 Mock。
- HTTP Adapter：复用 `shared/api/uploadFile`，保留文件类型与 10 MiB 大小校验。

当前没有页面调用图片上传，因此不创建默认全局实例，也不新增 Mock。未来页面由 app 组合并注入
服务；测试直接注入 Fake，不依赖环境变量。

### 异步任务

将 `Task`、`TaskStatus`、`TaskEvent` 和尚未可用的 `subscribeTask` 从
`entities/workflow-run` 迁移到独立的 `entities/task`。Task 有后端 ID、状态、进度和结果快照，
其生命周期不属于 WorkflowRun。

`WorkflowTaskLink` 留在 `entities/workflow-run/model/task-link.ts`。它是前端编排关联，只保存
task、run、revision 和 node 四个 ID；通过 type-only import 引用 `Task`，不让后端 Task 认识
前端 WorkflowRun。

聚合门面 `@/entities` 继续导出这些公开类型和 `subscribeTask`，所以上层调用方式不变。

### Provider Session

将 `ProviderDescriptor`、`ProviderSession`、`ProviderCredentialMode` 和
`ProviderSessionStatus` 从 `features/generation/provider-session` 迁移到
`entities/provider-session`。它们描述有独立 ID、连接状态和过期时间的数据。

`features/generation` 继续作为用户可见的生成面板，只从 `@/entities` 读取
`ProviderSessionStatus`，不再拥有后端会话形状。

## 组合与 Mock 保护

- Capability 服务通过构造参数接收 Adapter，测试不读取 `import.meta.env`。
- 生产 runtime 在服务构造阶段拒绝 Mock Adapter。
- 只有 `app/capabilities/development.ts` 可以静态导入 Capability Mock。
- 真实调用失败必须向上抛出，生产环境不得运行时回退 Mock。
- 现有 Project 假 HTTP 是明确标注的过渡实现，本次不扩大其范围。

## 架构守卫

集成测试维护已声明的 Slice 清单：

- Entity：`action-template`、`character`、`project`、`provider-session`、`task`、
  `wearable`、`workflow-run`。
- Capability：`image-generation`、`image-upload`。

测试同时加入 `capabilities` 层的依赖方向、Slice 隔离、公开入口和 Mock 导入规则。新增模块时必须
先明确它是 Entity、Capability 还是 Feature，再更新契约清单；不能通过创建一个模糊目录绕开判断。

## 保持不动

- `features/generation`、`features/review`、`features/export` 仍是用户操作和 UI Feature。
- `entities/workflow-run` 仍拥有前端 WorkflowRun、Revision、节点、命令和本地 Repository。
- Character 下的 Outfit、Action 和 Frame 仍按当前聚合关系组织。
- 不实现完整 Quick Start Agent、Review、Export 或 Playtest 后端调用。
- 不修改任何后端文件。

## 验收

- `entities` 中不再存在 `generation`，Project Entity 不再导出图片上传。
- 图片生成和图片上传只能从各自 Capability 公开入口使用。
- Task 与 WorkflowTaskLink 位于各自正确边界，公开类型保持兼容。
- Provider Session 数据形状只由 Entity 提供，生成 Feature 只负责 UI。
- 架构测试能阻止未声明 Slice、错误层级依赖和生产代码直接选择 Mock。
- 格式、Lint、类型检查、全部测试和生产构建通过。
