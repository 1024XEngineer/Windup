# 前端 WorkflowRun 编排边界设计

## 背景与决策

PR #62 的 `docs/architecture.md` 是后端目标架构的唯一依据。MS2 阶段的
`WorkflowRun`、`WorkflowRevision` 和页面节点属于前端编排模型；后端不提供
`/workflows` 或 `/workflow-runs` 资源，而是分别提供 Project、Media、Character、
Generation、Asset、Review、Playtest 和 Export 等独立业务能力。

当前前端已经通过 `createWorkflowRun`、`fetchWorkflowRun` 和
`submitWorkflowCommand` 隔离了页面调用，但它们仍经过通用 HTTP transport，并把
`/workflows/*` 描述成未来真实后端接口。开发环境的 Mock handler 会拦截这些路径，生产
环境则会把请求发给不存在的后端路由。这是本次需要消除的错误边界。

本次采用“前端编排服务 + 本地仓库 Port/Adapter”的方案。保留已经被页面依赖的公开函数和
领域模型，不把后端业务逻辑写进页面；后续 OpenAPI 落地时，在编排服务内部增加独立能力
Adapter，而不是重写页面。

## 目标

- 保持 Quick Start、Workflow Editor、Playtest 等页面的公开调用方式不变。
- 明确 WorkflowRun 是前端模型，任何环境都不会向后端发送 `/workflows/*`。
- 保留当前 MS2 的节点、Revision、命令和浏览器持久化行为。
- 将临时状态机和 localStorage 实现从通用 HTTP Mock 中移到 WorkflowRun Entity 内部。
- 将后端 Task 与前端 run/revision 关联拆成两个类型。
- 为未来 Generation、Asset、Review、Export 的 OpenAPI Adapter 保留单一接入点，但不提前猜测
  路径、字段或状态机。
- 同步 API、模块和架构文档，删除“未来 Python WorkflowRun API”的表述。

## 非目标

- 不实现或猜测 Generation、Asset、Review、Playtest、Export 的真实 URL 和 DTO。
- 不改变当前页面布局、路由或交互。
- 不把前端 WorkflowRun 变成后端 `workflow` 或 `execution` 的数据模型。
- 不将 Mock 的质量门禁或生成结果描述为真实后端能力。
- 不修改 PR #62 的后端架构文档。

## 架构

```text
Pages / Features
       |
       v
entities/workflow-run public API
  createWorkflowRun()
  fetchWorkflowRun()
  submitWorkflowCommand()
       |
       v
WorkflowOrchestrator
  - 维护前端页面推进语义
  - 调用 WorkflowRunRepository
  - 未来组合独立后端能力 Adapter
       |
       v
WorkflowRunRepository (Port)
       |
       v
LocalWorkflowRunRepository (当前 Adapter)
  - localStorage，失败时退回内存
  - MS2 Mock 状态转换

未来：
WorkflowOrchestrator
  -> GenerationClient / AssetClient / ReviewClient / ExportClient
  -> OpenAPI 生成的真实 Adapter
```

`shared/api` 继续只负责真实后端能力的 HTTP、上传、响应壳和 Mock/Real 切换，不再注册或认识
WorkflowRun 路由。

## 组件与文件职责

### WorkflowOrchestrator

位于 `entities/workflow-run` 内部，承接现有三个公开函数。调用方继续从 Entity 公共入口导入，
不感知本地仓库或未来后端能力 Adapter。

公开签名保持不变：

```ts
createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun>
fetchWorkflowRun(runId: string): Promise<WorkflowRun>
submitWorkflowCommand(runId: string, command: WorkflowCommand): Promise<WorkflowRun>
```

### WorkflowRunRepository

Repository Port 只表达前端编排需要的持久化和命令操作，不表达 HTTP：

```ts
interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): WorkflowRun
  get(runId: string): WorkflowRun | null
  submit(runId: string, command: WorkflowCommand): WorkflowRun
}
```

当前 Adapter 复用已有状态机、ID 生成和 localStorage 回退行为。原先的 snake_case
`WorkflowRunDto` 只服务于伪 HTTP 协议；移除该协议后，本地仓库直接保存前端领域形状，避免
继续伪装成后端 DTO。

### 后端能力 Adapter

本次不创建空的 Generation/Asset/Review/Export 实现。后端 OpenAPI 冻结后，按照真实 Schema
逐个增加 Client 和 Adapter，并由 WorkflowOrchestrator 组合。这样不会因为提前猜测接口而再次
返工。

## Task 与关联数据

后端 Task 不依赖前端 WorkflowRun：

```ts
interface Task {
  id: string
  status: TaskStatus
  progress: number | null
  error: string | null
  result: unknown
}
```

前端单独保存关联：

```ts
interface WorkflowTaskLink {
  taskId: Task['id']
  runId: WorkflowRun['id']
  revisionId: WorkflowRevision['id']
  nodeId: WorkflowNode['id']
}
```

Task SSE 事件也只携带后端 Task 字段。断线恢复、事件名和 payload 在 OpenAPI/SSE 契约冻结前
继续明确失败，不返回假成功。

## 数据流

### 当前 MS2

1. 页面调用 `createWorkflowRun`。
2. WorkflowOrchestrator 在本地仓库创建 run 和初始 revision。
3. 页面提交命令时，Orchestrator 调用本地 MS2 状态转换并保存结果。
4. 页面通过 `fetchWorkflowRun` 或现有 hook 读取最新前端状态。
5. 全流程不经过通用 HTTP transport，也不产生 `/workflows/*` 网络请求。

### 后端能力接入后

1. Orchestrator 调用真实 Generation Client 创建 Task。
2. 前端保存 `WorkflowTaskLink`，把 `taskId` 关联到当前节点。
3. 查询或 SSE 返回 Task 更新，Orchestrator 据此更新前端 WorkflowRun。
4. Generation 返回 `assetId` 后，后续 Review、Playtest、Export 只使用后端 Asset 引用。
5. 页面仍使用原有 WorkflowRun 公共接口，不感知后端模块拆分。

## 错误处理

- 本地 run 不存在时，公开函数继续显式抛错，不返回空对象或假成功。
- localStorage 不可用时退回进程内存，维持当前会话可用。
- 非法命令由本地 MS2 状态转换拒绝。
- 真实后端能力未接入时，对应功能必须明确显示未实现或失败；生产环境不得用 Mock 伪造生成、
  审核或导出成功。
- 后端 Task 失败只更新关联节点的展示状态，不篡改其他 Revision。

## 测试设计

实施遵循测试先行：

1. 新增边界测试，证明调用三个 WorkflowRun 公开函数不会触发通用 HTTP `fetch`，也不依赖
   `VITE_USE_MOCK`。
2. 新增/调整 Repository 测试，覆盖创建、读取、命令推进和未知 run。
3. 先增加类型测试，要求 `Task` 不再包含 `runId/revisionId`，并要求
   `WorkflowTaskLink` 精确包含 task/run/revision/node 四个 ID。
4. 更新架构测试，禁止 WorkflowRun 编排实现导入 `shared/api` 请求函数，并确认
   `shared/api/client/mock` 不再包含 WorkflowRun 路由。
5. 保留现有 Quick Start、Workflow Editor、Revision、门禁和 Playtest 测试，确保页面行为不回归。
6. 最后运行 format check、lint、全部测试、typecheck、build 和 `git diff --check`。

## 文档同步

- `frontend/API_CONTRACT.md`：删除 `/workflows/*` 待后端实现列表，说明它们不是后端契约；记录
  Task/WorkflowTaskLink 分离。
- `frontend/MODULES.md`：将 WorkflowRun 描述为前端编排 Entity，真实后端能力按独立域接入。
- `frontend-architecture-v3.md`：删除“后端最终保存 WorkflowRun”和“Python WorkflowRun API
  adapter”，与 PR #62 的 workflow/execution 分层一致。
- `frontend/README.md`：说明开发 Mock 与真实独立能力 Adapter 的切换边界。

## 验收条件

- 仓库中不存在运行时 `/workflows` 或 `/workflow-runs` 请求与 Mock route。
- 页面和 Feature 不需要修改其 WorkflowRun 公共调用签名。
- `Task` 与 `WorkflowTaskLink` 类型边界通过编译期测试。
- WorkflowRun 的本地编排测试和原有前端测试全部通过。
- 文档不再暗示后端需要实现 WorkflowRun 资源。
- 未冻结的独立后端接口没有被凭空添加。
