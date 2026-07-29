# 前端 API 契约状态

## 口径与实现状态

本文以导师 2026-07-28 会议口径为业务目标，以 PR #64 head `975c594` 为当前后端代码事实。
仓库根目录的 `project-api.md` 已确认错误，不再作为契约来源。

- WorkflowRun 是后端持久化的业务资源，但制作顺序和页面状态由前端推进。
- Character 由后端以 `character_data` JSONB 保存整棵数据树；前端更新造型、动作或帧后，通过
  `CharacterRepository.update(character)` 提交完整 Character，不再定义局部确认母版或加动作写接口。
- Task 按前端可见的异步步骤划分，不按底层模型调用划分，固定为
  `character_template | first_frame | complete_animation`。
- 当前 PR #64 中唯一已注册、可直接接入的业务 HTTP 路由仍是
  `POST /media/upload?category=reference-image`。WorkflowRun、Character、Generation、Task、SSE 等
  目标契约不等于 PR #64 已经提供了对应路由；真实 Adapter 必须等待正式接口。
- Preview/开发通过 app 组合注入与正式 Port 同形的异步内存 Mock，使核心页面流程可开发和验证；
  Production 对未配置能力明确失败，真实请求失败时不会回退 Mock。

`VITE_API_BASE_URL` 为空时使用同源地址，不自动追加 `/api`，也不猜后端端口或 Vite 代理。PR #64
当前未注册 CORS middleware；分端口直连必须由后端启用 CORS 或由外部反向代理提供同源入口。

## 应用装配边界

`AppServices` 是页面和用例获取外部实现的唯一入口，包含：

```ts
interface AppServices {
  projects: ProjectRepository
  characters: CharacterRepository
  workflowRuns: WorkflowRunRepository
  imageGeneration: ImageGenerationPort
  tasks: TaskRepository
  taskEvents: TaskEventSource
  imageUpload: ImageUploadPort
  quickStart: QuickStartService
  productionEngine: ProductionEnginePort
  workflowRestart: WorkflowRestartPort
  workflowController: WorkflowControllerPort
  playtestInspections: PlaytestInspectionRepository
}
```

Mock 只从 `app/composition/development` 动态装配；Production 不导入开发 Mock。Port 不公开
`adapterKind` 等实现选择字段，页面也不直接调用 `fetch` 或拼接 URL。

## WorkflowRun

Quick Start 和手动 Workflow 使用同一种 WorkflowRun 与 Revision，区别只在驱动方式和界面：

- 手动编辑器一次调用 `WorkflowControllerPort.advance` 推进一步。
- Quick Start 由 Agent 连续调用同一个 UI 无关的 `WorkflowControllerPort`，并隐藏节点、Revision 等术语。
- 两个入口拥有独立页面，不复用对方的 UI 组件或路由状态。

WorkflowRun 通过异步 Repository 存取：

```ts
interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  get(runId: string): Promise<WorkflowRun | null>
  save(run: WorkflowRun): Promise<void>
}
```

`create_character` 从角色资料阶段开始。为已有角色加动作时使用 `purpose: 'add_action'`，并在创建时
强制预填以下四项：

```ts
type AddActionWorkflowInput = {
  purpose: 'add_action'
  characterId: string
  outfitId: string
  characterTemplateUrl: string
  baseFrameUrls: readonly string[]
}
```

它从 `action-setup` 开始，不重复走角色母版步骤。标准节点顺序由 `WORKFLOW_NODE_ORDER` 唯一定义：

```text
character-setup -> character-template -> template-candidate -> action-setup
-> first-frame -> complete-animation -> review -> export
```

Repository 只负责存取，不执行推进、中断或重启。`WorkflowRunStatus` 为
`active | interrupted | completed | failed`；`interrupted` 表示前端停止自动推进并保留历史，不证明后端
Task 已终止。真实 WorkflowRun HTTP 路由尚未在 PR #64 落地，当前 Preview/开发使用同契约 Mock。

## Character 整树合同

Character 的读取和更新边界为：

```ts
interface CharacterReader {
  get(id: string): Promise<Character>
  listByProject(projectId: string): Promise<Character[]>
}

interface CharacterRepository extends CharacterReader {
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
}
```

`Outfit -> Action -> Frame` 属于 Character 整树。更新任何子级后都提交完整 Character；前端不同时维护
`confirmTemplate`、`addAction` 等另一套局部写合同。动作必须归属具体 Outfit。动作模板使用
`ActionTemplate/actionTemplateId`；角色母版使用 `candidateCharacterTemplates/characterTemplateUrl`；
多方向基准帧保持 `baseFrames` 命名。

PR #64 当前的 Character 模型确实使用 `character_data` JSONB，但可调用路由和与前端字段完全一致的 DTO
仍未完成。因此这里冻结的是 Repository 形状和整树更新原则，不声称真实 HTTP Adapter 已接通。

## Generation 与 Task

图片生成提交后返回独立 Task，不伪装成立即拿到最终图片：

```ts
type TaskType = 'character_template' | 'first_frame' | 'complete_animation'

interface ImageGenerationPort {
  submit<T extends GenerationInput>(
    input: T,
    options?: { signal?: AbortSignal },
  ): Promise<Task<T['type']>>
}

interface TaskRepository {
  get(taskId: string): Promise<Task>
  cancel(taskId: string): Promise<void>
}
```

完整动画内部可以包含视频生成、截帧或多次模型调用，但对前端仍是一个
`complete_animation` Task。`Task` 不携带 run、revision 或 node；二者的关联由
`WorkflowTaskLink` 单独表达。`TaskRepository.get` 必须运行时校验封闭的 `TaskType`，不能放行任意
`string`。

PR #64 当前 Generation/Task 的实现和命名仍未达到上述导师口径，也没有可调用的查询、取消或 SSE 路由，
因此这里只保留 Port 和 Preview/开发 Mock，不新增猜测 HTTP Adapter。

## 图片上传

```ts
interface ImageUploadPort {
  upload(file: File): Promise<MediaReference>
}
```

真实 Adapter 调用 `POST /media/upload?category=reference-image`，以 multipart 的 `file` 字段上传
`image/*`。后端成功响应 `data` 包含 `url`、`object_key`、`filename`、`content_type`、`size`，但 Adapter
只将 `data.url` 转成不透明 `MediaReference`，消费者不能依赖后端存储结构。失败直接报错，不回退 Mock。

## Playtest

Playtest 是独立核验入口，不是 Workflow Editor 的修改步骤：

```text
/playtest/:characterId/:outfitId?actionId=:actionId&runId=:runId&revision=:revisionId
```

- `characterId + outfitId` 是必填播放目标，`actionId` 仅用于可选动作定位。
- `runId + revision` 仅表示从某次 Workflow 进入时的可选来源；独立进入 Playtest 不需要它们。
- Playtest 通过 `CharacterReader` 只读 Character→Outfit→Action→Frame，不修改 Character、WorkflowRun、
  Revision 或产物。
- “通过 / 发现问题”通过独立 `PlaytestInspectionRepository` 保存，不反写制作状态。
- PR #64 尚未提供该记录的正式 HTTP 接口，当前只有领域 Port 与 Preview/开发 Mock。

## 控制边界

- `QuickStartService.getSession`：只返回会话状态和当前公开阶段，不把完整 Revision/节点树泄漏给 Quick Start UI。
- `QuickStartService.interrupt`：只允许中断 `active` 会话；立即停止 Agent 后续自动决策，并使当前精确 attempt 失效。
- `ProductionEnginePort.cancelAttempt`：丢弃该 attempt 的迟到结果，并尽力请求远端取消。
- `WorkflowControllerPort`：手动和自动入口共用的流程推进用例。
- `WorkflowRestartPort.restart`：从历史节点建立新的 Revision。
- `WorkflowRunRepository`：仅存取后端持久化的 WorkflowRun 快照。

远端取消尚无可调用接口，但不能因此删除上层“本地失效 + 远端 best-effort cancel”语义。

## 仍待后端冻结或落地

- Project、Character、WorkflowRun 的正式 HTTP 路径、DTO、认证、分页和错误响应。
- 三类 Generation/Task 的提交、查询、取消、结果 DTO 与 SSE 断线恢复。
- Review、Export、ActionTemplate 和 PlaytestInspection 的正式接口。
- Character 当前缺失字段、Action 来源字段、`outfit_id`、候选数量与结果形状等前后端映射缺口。

只有后端提供并确认 OpenAPI 或等价正式契约后，才新增真实 Adapter；页面与 Feature 无需因此改签名。
