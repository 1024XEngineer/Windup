# 前端模块归属修正设计

## 目标

Windup 前端按职责组织代码，而不是照搬后端模块名称。此次修正新增明确的前端 `capabilities`
层，并根据对 `frontend/src` 全目录的审计，修正调用能力、实体、关联数据、组合入口和通用传输的
错误归属。

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

1. 有独立 ID、状态、可查询快照或生命周期的数据，属于 Entity；围绕其生命周期的 CRUD、查询和
   Repository 仍可由该 Entity 拥有。
2. 主要产物是一次计算、上传、审核或导出结果，且不能归约为某个 Entity 生命周期的可调用边界，
   属于 Capability。
3. 用户操作、页面交互和流程控制，属于 Feature。
4. Real/Mock 的最终选择，属于 app 组合入口。
5. HTTP、multipart、SSE 等通用协议处理，属于 shared。

因此，未来若后端返回拥有 ID 和状态的 `GenerationJob`，它可以成为 Entity；但
`generateImages()` 始终是 Capability。后端模块名本身不能决定前端目录。

## 全局审计结论

对 app、pages、features、entities 和 shared 的全部源文件、公开导出及引用关系复核后，确定修正：

- 原四项：图片生成、图片上传、Task/WorkflowTaskLink、Provider Session。
- Project 业务 Mock 当前位于 `shared/api`，导致通用传输认识 Project，并用一个总开关决定所有请求；
  改为 Project Repository，由 app 组合 HTTP 或开发内存实现。
- `Action.sourceWorkflowRunId` 把前端 WorkflowRun 关联嵌进 Character 资产形状，但当前导航已经由
  runId/revisionId 路由上下文完成，且代码没有任何消费者；删除该字段，不创建未使用的新关联类型。
- `WorkflowLocation` 是未使用的完整定位形状，与“子模块只上报 action/frame，页面解析路由”的既定
  边界重复；删除。
- `PageQuery` 与 `Paged` 是业务无关分页值，不属于 API 响应 mapper；迁移到 `shared/pagination`。
- 删除没有消费者或内容已过期的入口：空 `shared/api/request.ts`、空 `shared/api/stream.ts`、
  `workflow-run/model/revision.ts` 兼容转发、未使用的 `workflowRunKeys`、未使用的
  `shared/testing/flush`，以及已经与 Home 实现不符的占位 README。

以下模块经审计保持原位：

- WorkflowRun 有前端 ID、Revision 和本地生命周期，继续作为 Entity。
- Character 下的 Outfit、Action、Frame 是当前聚合结构；ActionTemplate 与 Wearable 是独立 Entity。
- Generation、Review、Export 和 CharacterSetup 是用户操作/UI Feature。
- Workflow Editor 与 Playtest 的子目录只服务各自 Page，不提升为可复用 Feature。
- Feature/Page 的规划 README 和 `shared/api/generated` 仍表达已确认的目录边界，不作为重复文件删除。

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

### Project Repository 与开发数据

Project 的类型、枚举、CRUD Repository 和 HTTP DTO 映射仍属于 `entities/project`。将当前
`fetchProjects`、`fetchProject`、`createProject`、`deleteProject` 收敛为 `ProjectRepository`，
HTTP 实现只使用通用 `shared/api`。

开发内存实现放在 `app/composition/mocks/project.ts`，只由
`app/composition/development.ts` 引入；生产组合只引入 HTTP Repository。`App` 显式接收组合后的
服务并传给需要 Project 的页面，Quick Start 继续通过已经存在的依赖注入使用 `repository.create`。

删除 `shared/api/client/mock` 及全局 `VITE_USE_MOCK`。开发默认使用 Project 内存 Repository；设置
`VITE_PROJECT_ADAPTER=http` 时使用真实 HTTP，生产构建无条件使用 HTTP。通用 shared transport
不再保存业务假数据，也不负责按能力选择实现。

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
`ProviderSessionStatus`，不再拥有后端会话形状。原规划子目录改名为 `provider-connection`，只描述
连接验证和模型选择 UI，避免把 UI 与 Session Entity 再次混为同一个模块。

### 前端关联与冗余入口

`Action` 删除 `sourceWorkflowRunId`，不让 Character 资产反向认识前端 WorkflowRun。当前
Workflow Editor 和 Playtest 已通过路由中的 runId、revisionId 与 characterId 保持上下文，没有
行为依赖该字段。

删除未使用的 `WorkflowLocation`，页面内模块继续只上报自己知道的 action/frame 信息，外层页面
负责将其解析为路由或工作流节点。没有实际消费者前，不建立新的 Action/Workflow 关联模型。

删除审计中确认无引用的兼容转发、查询键、空 transport 占位和测试辅助；未来出现真实消费者时，
从当时的契约重新建立入口，而不是保留无法验证的预设 API。

## 组合与 Mock 保护

- Capability 服务通过构造参数接收 Adapter，测试不读取 `import.meta.env`。
- 生产 runtime 在服务构造阶段拒绝 Mock Adapter。
- 只有 `app/composition/development.ts` 可以静态导入 Mock；生产组合不得通过聚合出口间接引入。
- 真实调用失败必须向上抛出，生产环境不得运行时回退 Mock。
- 现有 Project 假 HTTP 随全局 transport 开关一起删除；开发数据只作为 Project Repository 的
  app 级内存实现存在。

## 架构守卫

集成测试维护已声明的 Slice 清单：

- Entity：`action-template`、`character`、`project`、`provider-session`、`task`、
  `wearable`、`workflow-run`。
- Capability：`image-generation`、`image-upload`。

同时锁定 Page、Feature 和 Shared 的顶层 Slice，新增目录必须先更新模块契约。`shared` 只保留
`api`、`hooks`、`pagination` 和 `ui`；业务 Mock 不得回到 shared。

测试同时加入 `capabilities` 层的依赖方向、Slice 隔离、公开入口和 Mock 导入规则。新增模块时必须
先明确它是 Entity、Capability 还是 Feature，再更新契约清单；不能通过创建一个模糊目录绕开判断。

## 保持不动

- `features/generation`、`features/review`、`features/export` 仍是用户操作和 UI Feature。
- `entities/workflow-run` 仍拥有前端 WorkflowRun、Revision、节点、命令和本地 Repository。
- Character 下的 Outfit、Action 和 Frame 仍按当前聚合关系组织，但 Action 不携带前端
  WorkflowRun 关联。
- 不实现完整 Quick Start Agent、Review、Export 或 Playtest 后端调用。
- 不修改任何后端文件。

## 验收

- `entities` 中不再存在 `generation`，Project Entity 不再导出图片上传。
- 图片生成和图片上传只能从各自 Capability 公开入口使用。
- Task 与 WorkflowTaskLink 位于各自正确边界，公开类型保持兼容。
- Provider Session 数据形状只由 Entity 提供，生成 Feature 只负责 UI。
- Project Mock 不再位于 shared；开发与生产 Project Repository 由 app 显式组合。
- Character 不再依赖 WorkflowRun，未使用的定位和兼容入口已清除。
- 架构测试能阻止未声明 Slice、错误层级依赖和生产代码直接选择 Mock。
- 格式、Lint、类型检查、全部测试和生产构建通过。
